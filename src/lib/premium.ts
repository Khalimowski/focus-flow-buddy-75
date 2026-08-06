// Premium entitlement ("Focus Flow Premium").
//
// What it unlocks:
//   - the browser version of the app (see PremiumGate; native is never gated)
//   - no AdMob banner on Android (see ads.ts)
//
// How it travels between devices: the entitlement is a normal localStorage key
// listed in sync.ts SYNC_KEYS, so a purchase made on the phone is pushed to the
// user's `user_data` row and pulled by the browser on the next sync tick. That
// is the whole cross-device story — no extra endpoint needed for it.
//
// Two rules keep that safe:
//   1. Never write a "not premium" record. Sync is last-writer-wins per key, so
//      a browser saving `{active:false}` would overwrite a real purchase in the
//      cloud. Absence of the key means "not premium"; only grants are written.
//   2. Only clear the entitlement on an explicit Play refund/revoke signal
//      (revokePremium), never because a query came back empty — an offline or
//      rate-limited Play query looks exactly like "no purchase".
import { useEffect, useState } from "react";
import { loadJSON, saveJSON, STORAGE_KEYS } from "./storage";
import { getSyncUser, REMOTE_UPDATE_EVENT } from "./sync";

/** Play in-app product id (one-time purchase, non-consumable). */
export const PREMIUM_PRODUCT_ID = "focus_flow_premium";

/** Fired whenever the entitlement changes locally. */
export const PREMIUM_CHANGED_EVENT = "ff.premium-changed";

/**
 * Where the browser build lives — the link mailed to the customer after
 * purchase. Override per deployment with VITE_WEB_APP_URL.
 */
export const WEB_APP_URL =
  (import.meta.env.VITE_WEB_APP_URL as string | undefined) ||
  "https://focus-flow-buddy-75.kacper-szymanski1990.workers.dev";

/**
 * Optional unlock service (see workers/premium-unlock/). It does the two things
 * a client genuinely cannot do for itself: check the purchase token against the
 * Play Developer API, and send the welcome email carrying WEB_APP_URL.
 * Unset = purchases are trusted locally and no email goes out.
 */
const UNLOCK_ENDPOINT = (import.meta.env.VITE_PREMIUM_UNLOCK_URL as string | undefined) || "";

/**
 * Whether the browser build refuses to run without premium. On by default —
 * browser access *is* the paid feature. Set VITE_PREMIUM_WEB_GATE=false to ship
 * an open web build (e.g. a demo deployment).
 */
export const WEB_GATE_ENABLED =
  (import.meta.env.VITE_PREMIUM_WEB_GATE as string | undefined) !== "false";

export function isUnlockServiceConfigured(): boolean {
  return UNLOCK_ENDPOINT.length > 0;
}

export type PremiumSource = "play" | "manual";

export type Entitlement = {
  active: true;
  source: PremiumSource;
  productId: string;
  /** Play purchase token — the unlock service re-checks this. */
  purchaseToken?: string;
  orderId?: string | null;
  /** ISO timestamp of the purchase (or of the restore that found it). */
  purchasedAt: string;
  /** True once the unlock service confirmed the token with Google Play. */
  verified: boolean;
  /** True once the welcome email with the browser link has been sent. */
  emailSent: boolean;
};

/**
 * Written only by revokePremium. It exists so a refund propagates through sync:
 * deleting the key locally would just be re-filled by the next pull, since sync
 * mirrors values and has no delete channel.
 */
type RevokedRecord = { active: false; revokedAt: string; reason: string };

type PremiumRecord = Entitlement | RevokedRecord;

export function getEntitlement(): Entitlement | null {
  const stored = loadJSON<PremiumRecord | null>(STORAGE_KEYS.premium, null);
  // Defensive: a half-written or hand-edited record shouldn't unlock anything.
  if (!stored || stored.active !== true || typeof stored.productId !== "string") return null;
  return stored;
}

export function isPremium(): boolean {
  return getEntitlement() !== null;
}

function writeEntitlement(next: Entitlement) {
  saveJSON(STORAGE_KEYS.premium, next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PREMIUM_CHANGED_EVENT));
  }
}

/**
 * Record a purchase and unlock the app. Idempotent: re-granting the same
 * purchase keeps the original timestamp and the verified/emailSent flags, so a
 * restore on a second device doesn't re-send the welcome email.
 */
export function grantPremium(grant: {
  source: PremiumSource;
  productId?: string;
  purchaseToken?: string;
  orderId?: string | null;
}): Entitlement {
  const existing = getEntitlement();
  const same = existing && existing.purchaseToken === grant.purchaseToken;
  const next: Entitlement = {
    active: true,
    source: grant.source,
    productId: grant.productId || PREMIUM_PRODUCT_ID,
    purchaseToken: grant.purchaseToken,
    orderId: grant.orderId ?? null,
    purchasedAt: same ? existing!.purchasedAt : new Date().toISOString(),
    verified: same ? existing!.verified : false,
    emailSent: same ? existing!.emailSent : false,
  };
  writeEntitlement(next);
  console.log("[Premium] Entitlement granted", { source: next.source, verified: next.verified });
  return next;
}

/**
 * Drop the entitlement. Only for an explicit revocation (Play refund, or the
 * unlock service reporting the token as invalid) — never for "the query
 * returned nothing", which is indistinguishable from being offline.
 */
export function revokePremium(reason: string) {
  if (!getEntitlement()) return;
  const tombstone: RevokedRecord = { active: false, revokedAt: new Date().toISOString(), reason };
  saveJSON(STORAGE_KEYS.premium, tombstone);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PREMIUM_CHANGED_EVENT));
  }
  console.log("[Premium] Entitlement revoked:", reason);
}

type UnlockResponse = {
  verified?: boolean;
  emailSent?: boolean;
  revoked?: boolean;
  error?: string;
};

/**
 * Ask the unlock service to verify the purchase with Google Play and email the
 * browser link to the signed-in address.
 *
 * Deliberately forgiving: if the service is unreachable the entitlement stays
 * active but unverified, and boot retries it (see syncEntitlementWithService).
 * A paid customer must never be locked out because our endpoint had a bad day.
 * The one case that does revoke is the service explicitly answering that Play
 * does not recognise the token.
 */
export async function redeemWithUnlockService(
  options: { force?: boolean } = {},
): Promise<{ verified: boolean; emailSent: boolean; contacted: boolean }> {
  const ent = getEntitlement();
  if (!ent) return { verified: false, emailSent: false, contacted: false };
  if (!UNLOCK_ENDPOINT)
    return { verified: ent.verified, emailSent: ent.emailSent, contacted: false };
  if (!options.force && ent.verified && ent.emailSent) {
    return { verified: true, emailSent: true, contacted: false };
  }

  const email = getSyncUser()?.email;
  try {
    const res = await fetch(UNLOCK_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        productId: ent.productId,
        purchaseToken: ent.purchaseToken,
        orderId: ent.orderId,
        appUrl: WEB_APP_URL,
        // Skip the email when we've already sent it, unless the user asked again.
        sendEmail: options.force || !ent.emailSent,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as UnlockResponse;

    if (body.revoked) {
      revokePremium("unlock service reported the purchase as invalid");
      return { verified: false, emailSent: false, contacted: true };
    }
    if (!res.ok) {
      console.warn("[Premium] Unlock service returned", res.status, body.error);
      return { verified: ent.verified, emailSent: ent.emailSent, contacted: true };
    }

    const fresh = getEntitlement();
    if (fresh) {
      writeEntitlement({
        ...fresh,
        verified: body.verified ?? fresh.verified,
        emailSent: body.emailSent ? true : fresh.emailSent,
      });
    }
    return {
      verified: body.verified ?? false,
      emailSent: body.emailSent ?? ent.emailSent,
      contacted: true,
    };
  } catch (e) {
    // Offline / DNS / CORS — keep the entitlement, retry later.
    console.warn("[Premium] Unlock service unreachable", e);
    return { verified: ent.verified, emailSent: ent.emailSent, contacted: false };
  }
}

/**
 * Boot hook: finish any unlock work left over from a purchase that completed
 * while the device was offline (unverified token, or unsent welcome email).
 */
export async function syncEntitlementWithService(): Promise<void> {
  const ent = getEntitlement();
  if (!ent || !UNLOCK_ENDPOINT) return;
  if (ent.verified && ent.emailSent) return;
  await redeemWithUnlockService();
}

/**
 * Current entitlement, re-read on local purchases and on sync pulls — the
 * latter is how a browser tab notices a purchase made on the phone.
 */
export function usePremium(): Entitlement | null {
  // Seeded synchronously so an existing customer never sees a frame of the
  // locked screen. getEntitlement is SSR-safe (loadJSON returns the fallback
  // without a window), so prerender still yields null.
  const [entitlement, setEntitlement] = useState<Entitlement | null>(getEntitlement);

  useEffect(() => {
    const read = () => setEntitlement(getEntitlement());
    read();
    window.addEventListener(PREMIUM_CHANGED_EVENT, read);
    window.addEventListener(REMOTE_UPDATE_EVENT, read);
    return () => {
      window.removeEventListener(PREMIUM_CHANGED_EVENT, read);
      window.removeEventListener(REMOTE_UPDATE_EVENT, read);
    };
  }, []);

  return entitlement;
}
