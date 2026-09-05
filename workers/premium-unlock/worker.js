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
 * Premium sells two ways, and Play checks them at different endpoints: the
 * one-time unlock through purchases.products, the monthly plan through
 * purchases.subscriptionsv2. The client says which it holds; the id is used as
 * a fallback so an older client still verifies correctly.
 *
 * Request:  POST { email, productId, plan?, purchaseToken, orderId, appUrl, sendEmail }
 * Response: 200 { verified, emailSent, expiresAt?, autoRenewing? }
 *         | 200 { revoked: true }
 *         | 4xx { error }
 */

const PLAY_SCOPE = "https://www.googleapis.com/auth/androidpublisher";

/** Must match PREMIUM_SUBSCRIPTION_ID in src/lib/premium.ts. */
const SUBSCRIPTION_PRODUCT_ID = "focus_flow_premium_monthly";

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);
    if (!originAllowed(request, env)) return json({ error: "Forbidden origin" }, 403, cors);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400, cors);
    }

    const { email, productId, plan, purchaseToken, appUrl, sendEmail } = body ?? {};
    if (!purchaseToken || !productId) {
      return json({ error: "productId and purchaseToken are required" }, 400, cors);
    }

    const isSubscription = plan === "monthly" || productId === SUBSCRIPTION_PRODUCT_ID;

    // --- 1. Verify with Google Play ---
    let verified = false;
    let period = {};
    try {
      const result = isSubscription
        ? await verifyPlaySubscription(env, productId, purchaseToken)
        : await verifyPlayPurchase(env, productId, purchaseToken);
      if (result.status === "revoked") {
        // Play is certain this token is not a live purchase (cancelled,
        // refunded, expired, or never existed). This is the only answer that
        // takes premium away from someone.
        return json({ revoked: true }, 200, cors);
      }
      verified = result.status === "purchased";
      // Only present for subscriptions; the client stores it to know when the
      // period is up and it is worth asking again.
      if (result.expiresAt !== undefined) period = {
        expiresAt: result.expiresAt,
        autoRenewing: result.autoRenewing,
      };
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

    return json({ verified, emailSent, ...period }, 200, cors);
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

/**
 * Subscriptions live at a different endpoint, and "is this person entitled?"
 * is a different question for them: a cancelled subscription is still paid up
 * until its expiry, while one on hold or paused is not entitled even though it
 * still exists. Play's subscriptionState says which, so it is mapped rather
 * than guessed at.
 *
 * Anything that answers "revoked" here withdraws access on every device the
 * customer signs in on, so only states Google defines as not-entitled do.
 * Anything unrecognised is reported as pending, which changes nothing.
 */
async function verifyPlaySubscription(env, productId, purchaseToken) {
  const accessToken = await getPlayAccessToken(env);
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${encodeURIComponent(env.PLAY_PACKAGE_NAME)}/purchases/subscriptionsv2/tokens/` +
    `${encodeURIComponent(purchaseToken)}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });

  // 404/410 = Play has no such subscription for this app.
  if (res.status === 404 || res.status === 410) return { status: "revoked" };
  if (!res.ok) throw new Error(`Play API ${res.status}: ${await res.text()}`);

  const subscription = await res.json();
  const lineItems = subscription.lineItems || [];
  const item = lineItems.find((line) => line.productId === productId) || lineItems[0] || {};
  const period = {
    expiresAt: item.expiryTime ?? null,
    // A cancelled-but-not-yet-expired plan reports auto-renew off, which is
    // what lets the app say "ends on" instead of "renews on".
    autoRenewing: !!item.autoRenewingPlan?.autoRenewEnabled,
  };

  switch (subscription.subscriptionState) {
    // Paid up. CANCELED means auto-renew is switched off, not that the current
    // period has ended — access runs to expiryTime, and Play moves it to
    // EXPIRED when it really finishes.
    case "SUBSCRIPTION_STATE_ACTIVE":
    case "SUBSCRIPTION_STATE_IN_GRACE_PERIOD":
    case "SUBSCRIPTION_STATE_CANCELED":
      return { status: "purchased", ...period };

    // Not entitled. Both are recoverable: when the customer fixes payment or
    // un-pauses, Play lists the subscription again and the Android app's
    // restore re-grants it, which syncs back out to their other devices.
    case "SUBSCRIPTION_STATE_ON_HOLD":
    case "SUBSCRIPTION_STATE_PAUSED":
    case "SUBSCRIPTION_STATE_EXPIRED":
    case "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED":
      return { status: "revoked" };

    // First payment hasn't settled yet, or a state this code doesn't know.
    // Neither is grounds for taking anything away.
    default:
      return { status: "pending", ...period };
  }
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
  const allowed = allowedOrigins(env);
  // Echo only an origin we actually allow. Falling back to allowed[0] for an
  // unknown origin advertised a header that was never true for that caller.
  const allow = allowed.includes(origin) ? origin : "";
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
  if (allow) headers["Access-Control-Allow-Origin"] = allow;
  return headers;
}

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Whether this caller may use the endpoint at all. CORS only constrains
 * browsers; this refuses the request outright, which is what keeps a scripted
 * caller from driving the Play API and the mail sender on our budget.
 * An empty ALLOWED_ORIGINS means "unconfigured" and stays permissive, matching
 * the rest of the service's opt-in design.
 */
function originAllowed(request, env) {
  const allowed = allowedOrigins(env);
  if (allowed.length === 0) return true;
  const origin = request.headers.get("Origin");
  // Non-browser callers (no Origin header) are the ones worth stopping here.
  return !!origin && allowed.includes(origin);
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
