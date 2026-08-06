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
import { registerPlugin } from "@capacitor/core";
import { isNative } from "./native";
import {
  PREMIUM_PRODUCT_ID,
  grantPremium,
  redeemWithUnlockService,
  type Entitlement,
} from "./premium";

type PlayPurchase = {
  productId: string;
  purchaseToken: string;
  orderId?: string | null;
  /** Play's PurchaseState: 1 = purchased, 2 = pending. */
  state: number;
  acknowledged: boolean;
};

type BillingPlugin = {
  /** Whether Play Billing is usable on this device (Play Store present, service connected). */
  isAvailable(): Promise<{ available: boolean }>;
  /** Localized store price for the premium product, for display only. */
  getProduct(options: { productId: string }): Promise<{
    productId: string;
    title: string;
    description: string;
    price: string;
  }>;
  /** Launches the Play purchase sheet; resolves once Play reports a result. */
  purchase(options: { productId: string }): Promise<{
    purchases: PlayPurchase[];
    userCancelled: boolean;
  }>;
  /** Re-reads purchases Play already knows about (new device, reinstall). */
  restore(): Promise<{ purchases: PlayPurchase[] }>;
};

const Billing = registerPlugin<BillingPlugin>("Billing");

export type PremiumProduct = {
  productId: string;
  title: string;
  description: string;
  price: string;
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

/** Store listing for the premium product, or null if Play didn't return one. */
export async function getPremiumProduct(): Promise<PremiumProduct | null> {
  if (!isBillingSupported()) return null;
  try {
    return await Billing.getProduct({ productId: PREMIUM_PRODUCT_ID });
  } catch (e) {
    console.warn("[Billing] Product lookup failed", e);
    return null;
  }
}

export class BillingUnavailableError extends Error {
  constructor() {
    super("Play Billing is not available on this device");
  }
}

export type PurchaseOutcome =
  { status: "granted"; entitlement: Entitlement } | { status: "pending" } | { status: "cancelled" };

/**
 * Buy premium. Resolves "pending" for slow payment methods (Play calls back
 * later — restorePremium() at next launch picks it up), "cancelled" when the
 * user backs out, and throws on a real billing error.
 */
export async function purchasePremium(): Promise<PurchaseOutcome> {
  if (!isBillingSupported()) throw new BillingUnavailableError();

  const { purchases, userCancelled } = await Billing.purchase({ productId: PREMIUM_PRODUCT_ID });
  if (userCancelled) return { status: "cancelled" };

  const purchased = purchases.find((p) => p.state === 1);
  if (!purchased) {
    // state 2 = PENDING: the user chose a payment method that settles offline.
    return purchases.some((p) => p.state === 2) ? { status: "pending" } : { status: "cancelled" };
  }

  const entitlement = grantPremium({
    source: "play",
    productId: purchased.productId,
    purchaseToken: purchased.purchaseToken,
    orderId: purchased.orderId,
  });

  // Verify with Play and email the browser link. Deliberately not awaited into
  // the caller's success path — the user is already premium locally, and this
  // retries on next launch if it fails (syncEntitlementWithService).
  void redeemWithUnlockService();

  return { status: "granted", entitlement };
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
    const purchased = purchases.find((p) => p.productId === PREMIUM_PRODUCT_ID && p.state === 1);
    if (!purchased) return false;

    grantPremium({
      source: "play",
      productId: purchased.productId,
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
