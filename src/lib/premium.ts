// Premium entitlement ("FlowDay Premium").
//
// What it unlocks:
//   - the browser version of the app (see PremiumGate; native is never gated)
//   - no AdMob banner on Android (see ads.ts)
//
// There are two ways to pay for it, and they unlock exactly the same things:
// a monthly subscription and a one-time purchase. The plan is recorded on the
// entitlement so the UI can say which one is running, but no feature anywhere
// asks about it — every gate goes through isPremium()/usePremium().
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
import { Capacitor } from "@capacitor/core";
import { loadJSON, saveJSON, STORAGE_KEYS } from "./storage";
import { getSyncUser, REMOTE_UPDATE_EVENT } from "./sync";

/** Play in-app product id (one-time purchase, non-consumable). */
export const PREMIUM_PRODUCT_ID = "focus_flow_premium";

/** Play subscription id (auto-renewing, monthly base plan). */
export const PREMIUM_SUBSCRIPTION_ID = "focus_flow_premium_monthly";

/**
 * Base plan id inside the subscription above. Play needs the *offer* token to
 * launch checkout, which the plugin resolves from the base plan; this constant
 * is only here so Play Console and the code name the same thing.
 */
export const PREMIUM_BASE_PLAN_ID = "monthly";

/** The two ways to pay. Same entitlement either way — only the billing differs. */
export type PremiumPlan = "monthly" | "lifetime";

/**
 * List prices, shown when Play hasn't answered yet (or can't — the browser
 * build has no Play Billing). Play's own localized price wins whenever it is
 * available; these are the zloty figures the products are configured with, so
 * the two agree for the Polish store and nobody is quoted a price we then
 * change at checkout.
 */
export const PLAN_LIST_PRICE: Record<PremiumPlan, string> = {
  monthly: "14,99 zł",
  lifetime: "150 zł",
};

/** Which product id backs each plan. */
export const PLAN_PRODUCT_ID: Record<PremiumPlan, string> = {
  monthly: PREMIUM_SUBSCRIPTION_ID,
  lifetime: PREMIUM_PRODUCT_ID,
};

/**
 * The plan a product id belongs to. Anything that isn't the subscription is
 * read as the one-time unlock — that includes entitlements written before
 * subscriptions existed, which is exactly the right answer for them.
 */
export function planForProduct(productId: string | undefined): PremiumPlan {
  return productId === PREMIUM_SUBSCRIPTION_ID ? "monthly" : "lifetime";
}

/**
 * Where a subscriber cancels or changes their plan. Play policy requires an app
 * that sells subscriptions to link here, and only Play can actually make the
 * change — we never cancel on a customer's behalf.
 *
 * The package name is the applicationId from android/app/build.gradle (and
 * capacitor.config.ts); it is part of the URL Play expects, not something the
 * bundle can read at runtime.
 */
export const PLAY_SUBSCRIPTIONS_URL =
  "https://play.google.com/store/account/subscriptions" +
  `?sku=${PREMIUM_SUBSCRIPTION_ID}&package=com.khalimowski.focusflow`;

/** Fired whenever the entitlement changes locally. */
export const PREMIUM_CHANGED_EVENT = "ff.premium-changed";

/**
 * Where the browser build lives — the link mailed to the customer after
 * purchase. Override per deployment with VITE_WEB_APP_URL.
 */
export const WEB_APP_URL =
  (import.meta.env.VITE_WEB_APP_URL as string | undefined) ||
  "https://flowday.day/";

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

/**
 * Early-access switch: treat everyone as Premium, with no purchase.
 *
 * **Now off by default — early access is over.** It stays here because it is
 * still the right switch for a demo build or a test track where nobody can
 * reach Play checkout; set VITE_PREMIUM_FREE_FOR_ALL=true to turn it back on.
 *
 * Nothing is written to storage for this — no synthetic entitlement reaches
 * sync — which is exactly why it could not grandfather anyone on its own: when
 * it went off, every account would have gone back to "never paid". The people
 * who were here during early access keep their access through real rows
 * written by scripts/grandfather-premium.mjs instead, and guests through
 * isGrandfatheredInstall() below.
 */
export const PREMIUM_FREE_FOR_ALL =
  (import.meta.env.VITE_PREMIUM_FREE_FOR_ALL as string | undefined) === "true";

export function isUnlockServiceConfigured(): boolean {
  return UNLOCK_ENDPOINT.length > 0;
}

/**
 * Keys that only a *previous run of the app on this device* can have written.
 * Every one of them is device-local and absent from SYNC_KEYS, which is the
 * whole point: a fresh install that signs into an old account pulls tasks,
 * habits and stats down from the server, so none of those prove anything about
 * this install's age. These cannot arrive over the wire.
 */
const EARLY_ACCESS_EVIDENCE_KEYS = [
  STORAGE_KEYS.whatsNew,
  STORAGE_KEYS.deviceId,
  STORAGE_KEYS.endOfDay,
  STORAGE_KEYS.widgetPrompt,
];

/**
 * Whether this install was already running FlowDay when early access ended.
 *
 * Android guest mode has no account, so there is nowhere to put a real
 * entitlement for someone who never signed up — the backfill can only reach
 * rows in `user_data`. This is the local stand-in that keeps voice input
 * working for a guest who has been using the app all along.
 *
 * Decided **once**, at module load, and then frozen. Timing is the whole
 * design: premium.ts is imported before the app mounts, so the evidence keys
 * present at this moment are necessarily leftovers from an earlier build —
 * later in the same boot this build would start writing them itself and every
 * install would look old.
 */
function resolveGrandfatheredInstall(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const decided = window.localStorage.getItem(STORAGE_KEYS.grandfathered);
    if (decided !== null) return decided === "true";
    const wasHere = EARLY_ACCESS_EVIDENCE_KEYS.some(
      (key) => window.localStorage.getItem(key) !== null,
    );
    window.localStorage.setItem(STORAGE_KEYS.grandfathered, String(wasHere));
    return wasHere;
  } catch {
    // Private mode, or storage disabled. Nothing to grandfather from.
    return false;
  }
}

const GRANDFATHERED_INSTALL = resolveGrandfatheredInstall();

/**
 * The local grandfather, honoured on Android only.
 *
 * The web check is not belt-and-braces, it is the security boundary: this flag
 * lives in localStorage, where anyone can set it. On the phone the most it
 * unlocks is dictation on a free, ad-supported install. In the browser it would
 * hand over the paid product itself, so the browser never asks.
 */
export function isGrandfatheredInstall(): boolean {
  if (!GRANDFATHERED_INSTALL) return false;
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * Where an entitlement came from.
 *   play          — a real purchase, either plan
 *   manual        — an admin grant (comp, tester, refund handled out of band)
 *   grandfathered — was already using FlowDay when early access ended
 *   free          — the PREMIUM_FREE_FOR_ALL stand-in; never stored
 */
export type PremiumSource = "play" | "manual" | "grandfathered" | "free";

export type Entitlement = {
  active: true;
  source: PremiumSource;
  productId: string;
  /**
   * Which of the two ways the customer paid. Absent on records written
   * before subscriptions existed — read those through entitlementPlan(), which
   * falls back to the product id and so answers "lifetime" for them.
   */
  plan?: PremiumPlan;
  /** Play purchase token — the unlock service re-checks this. */
  purchaseToken?: string;
  orderId?: string | null;
  /** ISO timestamp of the purchase (or of the restore that found it). */
  purchasedAt: string;
  /**
   * Subscriptions only: the end of the paid period, as reported by the unlock
   * service. Informational, and it decides when to re-ask Play — it is
   * deliberately NOT a gate. A stale date must never lock out a customer whose
   * renewal we simply haven't heard about yet; a subscription that has really
   * ended comes back from the service as `revoked`, the same authoritative
   * answer a refund gives.
   */
  expiresAt?: string | null;
  /** Subscriptions only: whether Play says the plan will renew again. */
  autoRenewing?: boolean;
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

/**
 * Stands in for a purchase while PREMIUM_FREE_FOR_ALL is on. `source: "free"`
 * is how the UI tells it apart from a real one; verified/emailSent are true so
 * no unlock-service call is ever made on its behalf.
 */
const FREE_ENTITLEMENT: Entitlement = Object.freeze({
  active: true,
  source: "free",
  productId: PREMIUM_PRODUCT_ID,
  plan: "lifetime",
  orderId: null,
  purchasedAt: new Date(0).toISOString(),
  verified: true,
  emailSent: true,
});

/** The real, purchased entitlement — never the free-for-all stand-in. */
export function getEntitlement(): Entitlement | null {
  const stored = loadJSON<PremiumRecord | null>(STORAGE_KEYS.premium, null);
  // Defensive: a half-written or hand-edited record shouldn't unlock anything.
  if (!stored || stored.active !== true || typeof stored.productId !== "string") return null;
  return stored;
}

/**
 * Stands in for an entitlement on an Android install that predates the end of
 * early access but has no account to carry a real one. Never written to
 * storage, so it cannot reach sync — see isGrandfatheredInstall().
 */
const GRANDFATHERED_ENTITLEMENT: Entitlement = Object.freeze({
  active: true,
  source: "grandfathered",
  productId: PREMIUM_PRODUCT_ID,
  plan: "lifetime",
  orderId: null,
  purchasedAt: new Date(0).toISOString(),
  verified: true,
  emailSent: true,
});

/**
 * What the feature gates ask: a real entitlement, or one of the two stand-ins
 * (early access, or a grandfathered guest install) standing in for one.
 */
export function getEffectiveEntitlement(): Entitlement | null {
  if (PREMIUM_FREE_FOR_ALL) return getEntitlement() ?? FREE_ENTITLEMENT;
  return getEntitlement() ?? (isGrandfatheredInstall() ? GRANDFATHERED_ENTITLEMENT : null);
}

export function isPremium(): boolean {
  return getEffectiveEntitlement() !== null;
}

/**
 * True only for an entitlement someone actually paid for. Use this for perks
 * that early access deliberately doesn't hand out (ad removal), never for
 * feature gates — those go through isPremium/usePremium.
 */
export function hasPurchasedPremium(): boolean {
  return getEntitlement() !== null;
}

/** How this entitlement was paid for, tolerating records that predate plans. */
export function entitlementPlan(ent: Entitlement): PremiumPlan {
  return ent.plan ?? planForProduct(ent.productId);
}

/**
 * Whether it is worth asking the unlock service about this subscription again.
 * True once the recorded period is inside its last day (or already past), which
 * is when a renewal — or a cancellation — would have happened. One-time
 * purchases never need this: they don't change after they're verified.
 */
function subscriptionNeedsRecheck(ent: Entitlement): boolean {
  if (entitlementPlan(ent) !== "monthly") return false;
  if (!ent.expiresAt) return true;
  const expiry = Date.parse(ent.expiresAt);
  if (Number.isNaN(expiry)) return true;
  return Date.now() > expiry - 24 * 60 * 60 * 1000;
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
  plan?: PremiumPlan;
  purchaseToken?: string;
  orderId?: string | null;
}): Entitlement {
  const productId = grant.productId || PREMIUM_PRODUCT_ID;
  const plan = grant.plan ?? planForProduct(productId);
  const existing = getEntitlement();
  const same = existing && existing.purchaseToken === grant.purchaseToken;
  // A subscription keeps its token across renewals, so `same` stays true and
  // the recorded expiry would survive forever. Drop one that has already run
  // out: Play only hands back a subscription it still considers live, so being
  // re-granted with a past expiry means the period rolled over and the date we
  // hold is stale. Clearing `verified` alongside it queues the re-check that
  // fetches the new one.
  const staleExpiry = same && !!existing!.expiresAt && Date.parse(existing!.expiresAt) < Date.now();
  const next: Entitlement = {
    active: true,
    source: grant.source,
    productId,
    plan,
    purchaseToken: grant.purchaseToken,
    orderId: grant.orderId ?? null,
    purchasedAt: same ? existing!.purchasedAt : new Date().toISOString(),
    expiresAt: same && !staleExpiry ? (existing!.expiresAt ?? null) : null,
    autoRenewing: same && !staleExpiry ? existing!.autoRenewing : undefined,
    verified: same && !staleExpiry ? existing!.verified : false,
    emailSent: same ? existing!.emailSent : false,
  };
  writeEntitlement(next);
  console.log("[Premium] Entitlement granted", {
    source: next.source,
    plan: next.plan,
    verified: next.verified,
  });
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
  /** Subscriptions: end of the paid period Play currently reports. */
  expiresAt?: string | null;
  autoRenewing?: boolean;
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
  // Nothing left to ask about: verified, email sent, and either a one-time
  // purchase (which never changes) or a subscription whose period still has
  // time on it. The subscription clause matters — without it a renewal or a
  // cancellation would never be seen, because both flags stay true forever.
  if (!options.force && ent.verified && ent.emailSent && !subscriptionNeedsRecheck(ent)) {
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
        // Tells the service which Play endpoint to check the token against.
        // It can derive this from the id too, so an older service still works.
        plan: entitlementPlan(ent),
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
        // Only overwrite the subscription period when the service actually
        // reported one; an older service that answers without these fields
        // must not erase what we already know.
        expiresAt: body.expiresAt !== undefined ? body.expiresAt : fresh.expiresAt,
        autoRenewing: body.autoRenewing !== undefined ? body.autoRenewing : fresh.autoRenewing,
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
  // A subscription is also re-checked once its period is nearly up: that call
  // is what picks up a renewal (a fresh expiry) or an ending (the service
  // answers `revoked`, which is the only thing that withdraws access). Without
  // it a cancelled subscription would keep unlocking the browser forever,
  // because verified/emailSent are both long since true.
  if (ent.verified && ent.emailSent && !subscriptionNeedsRecheck(ent)) return;
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
  const [entitlement, setEntitlement] = useState<Entitlement | null>(getEffectiveEntitlement);

  useEffect(() => {
    const read = () => setEntitlement(getEffectiveEntitlement());
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
