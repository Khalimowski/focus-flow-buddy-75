/**
 * FlowDay — premium unlock service (Cloudflare Worker).
 *
 * Optional companion to src/lib/premium.ts. The app works without it (purchases
 * are then trusted client-side and no email goes out); deploying it adds the
 * two things a client genuinely cannot do for itself:
 *
 *   1. Verify a Play purchase token against the Play Developer API.
 *   2. Send the customer the link to the browser version.
 *
 * It is intentionally standalone — NOT part of the app's Vite/Nitro build,
 * which is fragile and must keep emitting a static SPA for Capacitor. Deploy it
 * separately with wrangler and point VITE_PREMIUM_UNLOCK_URL at the result.
 *
 * Request:  POST { email, productId, purchaseToken, orderId, appUrl, sendEmail }
 * Response: 200 { verified, emailSent } | 200 { revoked: true } | 4xx { error }
 */

const PLAY_SCOPE = "https://www.googleapis.com/auth/androidpublisher";

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400, cors);
    }

    const { email, productId, purchaseToken, appUrl, sendEmail } = body ?? {};
    if (!purchaseToken || !productId) {
      return json({ error: "productId and purchaseToken are required" }, 400, cors);
    }

    // --- 1. Verify with Google Play ---
    let verified = false;
    try {
      const result = await verifyPlayPurchase(env, productId, purchaseToken);
      if (result.status === "revoked") {
        // Play is certain this token is not a live purchase (cancelled,
        // refunded, or never existed). This is the only answer that takes
        // premium away from someone.
        return json({ revoked: true }, 200, cors);
      }
      verified = result.status === "purchased";
    } catch (e) {
      // Misconfiguration or a Play outage must not cost a paying customer
      // their access — report unverified and let the app retry later.
      console.error("[unlock] Play verification failed:", e.message);
      return json({ verified: false, emailSent: false, error: "verification_unavailable" }, 200, cors);
    }

    // --- 2. Email the browser link ---
    let emailSent = false;
    if (verified && sendEmail && email) {
      try {
        await sendWelcomeEmail(env, email, appUrl || env.APP_URL);
        emailSent = true;
      } catch (e) {
        // The app shows the link on screen regardless, and retries the send.
        console.error("[unlock] Email send failed:", e.message);
      }
    }

    return json({ verified, emailSent }, 200, cors);
  },
};

// --- Google Play Developer API ---

async function verifyPlayPurchase(env, productId, purchaseToken) {
  const accessToken = await getPlayAccessToken(env);
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${encodeURIComponent(env.PLAY_PACKAGE_NAME)}/purchases/products/` +
    `${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });

  // 404/410 = Play has no such purchase for this app.
  if (res.status === 404 || res.status === 410) return { status: "revoked" };
  if (!res.ok) throw new Error(`Play API ${res.status}: ${await res.text()}`);

  const purchase = await res.json();
  // purchaseState: 0 = purchased, 1 = cancelled, 2 = pending.
  if (purchase.purchaseState === 0) return { status: "purchased" };
  if (purchase.purchaseState === 1) return { status: "revoked" };
  return { status: "pending" };
}

/** Service-account JWT -> OAuth access token, cached for the token's lifetime. */
let cachedToken = null;

async function getPlayAccessToken(env) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: credentials.client_email,
    scope: PLAY_SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const header = { alg: "RS256", typ: "JWT" };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signature = await signRs256(unsigned, credentials.private_key);
  const assertion = `${unsigned}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);

  const token = await res.json();
  cachedToken = {
    value: token.access_token,
    expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}

async function signRs256(input, privateKeyPem) {
  const pem = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(input),
  );
  return base64urlBytes(new Uint8Array(signature));
}

// --- Email (Resend) ---

async function sendWelcomeEmail(env, to, appUrl) {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");

  const link = appUrl || "https://flowday.day/";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.MAIL_FROM || "FlowDay <noreply@focusflow.app>",
      to: [to],
      subject: "Your FlowDay Premium link",
      text: [
        "Thanks for going Premium!",
        "",
        "FlowDay now runs in your browser, and the ads in the Android app are gone.",
        "",
        `Open it here: ${link}`,
        "",
        "Sign in with this same email address and your tasks, nudges and streaks",
        "will be exactly as you left them on your phone.",
      ].join("\n"),
      html: welcomeHtml(link),
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

function welcomeHtml(link) {
  return `<!doctype html>
<html><body style="margin:0;padding:32px;background:#0F1115;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#E8EAF0">
  <div style="max-width:480px;margin:0 auto">
    <h1 style="font-size:20px;margin:0 0 16px">Thanks for going Premium ✨</h1>
    <p style="font-size:14px;line-height:1.6;color:#A8ADBD;margin:0 0 24px">
      FlowDay now runs in your browser, and the ads in the Android app are gone.
    </p>
    <a href="${escapeHtml(link)}"
       style="display:inline-block;background:#7C9CFF;color:#0F1115;text-decoration:none;
              padding:12px 20px;border-radius:12px;font-weight:600;font-size:14px">
      Open FlowDay in your browser
    </a>
    <p style="font-size:12px;line-height:1.6;color:#A8ADBD;margin:24px 0 0">
      Sign in with this same email address and your tasks, nudges and streaks will be
      exactly as you left them on your phone.
    </p>
    <p style="font-size:12px;color:#6B7185;margin:16px 0 0;word-break:break-all">${escapeHtml(link)}</p>
  </div>
</body></html>`;
}

// --- helpers ---

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

function corsHeaders(request, env) {
  // The app calls this from the browser build and from Capacitor
  // (https://localhost), so an explicit allow-list is required.
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const allow = allowed.includes(origin) ? origin : allowed[0] || "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function base64url(str) {
  return base64urlBytes(new TextEncoder().encode(str));
}

function base64urlBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
