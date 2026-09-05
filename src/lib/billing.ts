// Google Play Billing bridge.
//
// Talks to the `Billing` Capacitor plugin implemented in
// android/app/src/main/java/app/lovable/focusflow/BillingPlugin.java. Every
// entry point no-ops on web (where Play Billing does not exist), same guard
// style as native.ts — so callers don't have to branch.
//
// The plugin owns the Play conversation; this file owns turning its results
// into an entitlement (premium.ts) and kicking off the unlock service call
// that verifies the token and mails the browser link.
//
// Premium is sold two ways — a monthly subscription and a one-time purchase —
// which Play models as two different product *types*. That distinction lives
// here and in the plugin; nothing above this layer sees it, because both grant
// the identical entitlement.
import { registerPlugin } from "@capacitor/core";
import { isNative } from "./native";
import {
  PLAN_PRODUCT_ID,
  PREMIUM_BASE_PLAN_ID,
  PREMIUM_PRODUCT_ID,
  PREMIUM_SUBSCRIPTION_ID,
  grantPremium,
  planForProduct,
  redeemWithUnlockService,
  type Entitlement,
  type PremiumPlan,
} from "./premium";

/** Play's own product-type strings, as BillingClient.ProductType spells them. */
type PlayProductType = "inapp" | "subs";

const PLAN_PRODUCT_TYPE: Record<PremiumPlan, PlayProductType> = {
  lifetime: "inapp",
  monthly: "subs",
};

type PlayPurchase = {
  productId: string;
  productType?: PlayProductType;
  purchaseToken: string;
  orderId?: string | null;
  /** Play's PurchaseState: 1 = purchased, 2 = pending. */
  state: number;
  acknowledged: boolean;
};

type BillingPlugin = {
  /** Whether Play Billing is usable on this device (Play Store present, service connected). */
  isAvailable(): Promise<{ available: boolean }>;
  /** Localized store price for one product, for display only. */
  getProduct(options: {
    productId: string;
    productType: PlayProductType;
    basePlanId?: string;
  }): Promise<{
    productId: string;
    productType: PlayProductType;
    title: string;
    description: string;
    price: string;
    billingPeriod: string;
  }>;
  /** Launches the Play purchase sheet; resolves once Play reports a result. */
  purchase(options: {
    productId: string;
    productType: PlayProductType;
    basePlanId?: string;
  }): Promise<{
    purchases: PlayPurchase[];
    userCancelled: boolean;
  }>;
  /** Re-reads purchases Play already knows about, across both product types. */
  restore(): Promise<{ purchases: PlayPurchase[] }>;
};

const Billing = registerPlugin<BillingPlugin>("Billing");

export type PremiumProduct = {
  plan: PremiumPlan;
  productId: string;
  title: string;
  description: string;
  /** Play's localized price string, e.g. "14,99 zł". */
  price: string;
  /** ISO-8601 billing period for the subscription ("P1M"); empty for the one-off. */
  billingPeriod: string;
};

/** Play purchases can only happen in the Android build. */
export function isBillingSupported(): boolean {
  return isNative();
}

export async function isBillingAvailable(): Promise<boolean> {
  if (!isBillingSupported()) return false;
  try {
    const { available } = await Billing.isAvailable();
    return available;
  } catch (e) {
    console.warn("[Billing] Availability check failed", e);
    return false;
  }
}

/** Store listing for one plan, or null if Play didn't return one. */
export async function getPremiumProduct(plan: PremiumPlan): Promise<PremiumProduct | null> {
  if (!isBillingSupported()) return null;
  try {
    const details = await Billing.getProduct({
      productId: PLAN_PRODUCT_ID[plan],
      productType: PLAN_PRODUCT_TYPE[plan],
      ...(plan === "monthly" ? { basePlanId: PREMIUM_BASE_PLAN_ID } : {}),
    });
    return {
      plan,
      productId: details.productId,
      title: details.title,
      description: details.description,
      price: details.price,
      billingPeriod: details.billingPeriod ?? "",
    };
  } catch (e) {
    console.warn(`[Billing] Product lookup failed for ${plan}`, e);
    return null;
  }
}

/**
 * Both store listings at once. Deliberately tolerant of a partial answer: if
 * one product isn't live in Play Console yet the other still gets a real price,
 * and the caller falls back to the configured list price for the missing one
 * rather than showing an empty button.
 */
export async function getPremiumProducts(): Promise<Partial<Record<PremiumPlan, PremiumProduct>>> {
  if (!isBillingSupported()) return {};
  const [monthly, lifetime] = await Promise.all([
    getPremiumProduct("monthly"),
    getPremiumProduct("lifetime"),
  ]);
  const products: Partial<Record<PremiumPlan, PremiumProduct>> = {};
  if (monthly) products.monthly = monthly;
  if (lifetime) products.lifetime = lifetime;
  return products;
}

export class BillingUnavailableError extends Error {
  constructor() {
    super("Play Billing is not available on this device");
  }
}

export type PurchaseOutcome =
  { status: "granted"; entitlement: Entitlement } | { status: "pending" } | { status: "cancelled" };

/**
 * Buy premium on the given plan. Resolves "pending" for slow payment methods
 * (Play calls back later — restorePremium() at next launch picks it up),
 * "cancelled" when the user backs out, and throws on a real billing error.
 */
export async function purchasePremium(plan: PremiumPlan): Promise<PurchaseOutcome> {
  if (!isBillingSupported()) throw new BillingUnavailableError();

  const { purchases, userCancelled } = await Billing.purchase({
    productId: PLAN_PRODUCT_ID[plan],
    productType: PLAN_PRODUCT_TYPE[plan],
    ...(plan === "monthly" ? { basePlanId: PREMIUM_BASE_PLAN_ID } : {}),
  });
  if (userCancelled) return { status: "cancelled" };

  // Play's result can carry other products the account already holds, so match
  // the one this call actually asked for rather than taking the first paid
  // entry — otherwise buying the subscription while holding the one-time
  // unlock would report the wrong plan back.
  const wanted = PLAN_PRODUCT_ID[plan];
  const forThisPlan = purchases.filter((p) => p.productId === wanted);
  const purchased = forThisPlan.find((p) => p.state === 1);
  if (!purchased) {
    // state 2 = PENDING: the user chose a payment method that settles offline.
    return forThisPlan.some((p) => p.state === 2) ? { status: "pending" } : { status: "cancelled" };
  }

  const entitlement = grantPremium({
    source: "play",
    productId: purchased.productId,
    plan: planForProduct(purchased.productId),
    purchaseToken: purchased.purchaseToken,
    orderId: purchased.orderId,
  });

  // Verify with Play and email the browser link. Deliberately not awaited into
  // the caller's success path — the user is already premium locally, and this
  // retries on next launch if it fails (syncEntitlementWithService).
  void redeemWithUnlockService();

  return { status: "granted", entitlement };
}

/** Ours, and actually paid for — Play may also report unrelated products. */
function isPremiumPurchase(p: PlayPurchase): boolean {
  return (
    p.state === 1 && (p.productId === PREMIUM_PRODUCT_ID || p.productId === PREMIUM_SUBSCRIPTION_ID)
  );
}

/**
 * Re-apply a purchase Play already knows about: new phone, reinstall, or a
 * pending purchase that settled since last launch. Returns true if premium is
 * active afterwards.
 *
 * An empty result is NOT treated as a revocation — see the note in premium.ts.
 */
export async function restorePremium(): Promise<boolean> {
  if (!isBillingSupported()) return false;
  try {
    const { purchases } = await Billing.restore();
    const mine = purchases.filter(isPremiumPurchase);
    // Someone who subscribed and later bought the one-time unlock holds both.
    // Record the one-time purchase: it is the one that never lapses, so the
    // entitlement it writes doesn't need re-checking against Play.
    const purchased = mine.find((p) => p.productId === PREMIUM_PRODUCT_ID) ?? mine[0];
    if (!purchased) return false;

    grantPremium({
      source: "play",
      productId: purchased.productId,
      plan: planForProduct(purchased.productId),
      purchaseToken: purchased.purchaseToken,
      orderId: purchased.orderId,
    });
    void redeemWithUnlockService();
    return true;
  } catch (e) {
    console.warn("[Billing] Restore failed", e);
    return false;
  }
}

/**
 * Boot path (Android): pick up purchases made elsewhere — another device, the
 * Play website, or a pending purchase that has since settled. Quiet by design;
 * it must never surface an error to a user who simply isn't a customer.
 */
export async function reconcilePurchases(): Promise<void> {
  if (!isBillingSupported()) return;
  try {
    await restorePremium();
  } catch (e) {
    console.warn("[Billing] Purchase reconcile failed", e);
  }
}
