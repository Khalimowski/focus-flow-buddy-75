import { useEffect, useState } from "react";
import { Sparkles, Check, Mail, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";
import { notify } from "@/lib/notifications";
import { isUnlockServiceConfigured, redeemWithUnlockService, usePremium } from "@/lib/premium";
import {
  getPremiumProduct,
  isBillingSupported,
  purchasePremium,
  restorePremium,
  type PremiumProduct,
} from "@/lib/billing";

/**
 * Perk list, shared by the settings section and the web lock screen.
 * `withoutAds` drops the ad-free line for the early-access card, where the
 * features are open but the banner still runs.
 */
export function PremiumPerks({ withoutAds = false }: { withoutAds?: boolean } = {}) {
  const { t } = useTranslation();
  const perks = [
    t("premium_perk_web"),
    t("premium_perk_insights"),
    t("premium_perk_voice"),
    ...(withoutAds ? [] : [t("premium_perk_ads")]),
    t("premium_perk_sync"),
  ];
  return (
    <ul className="space-y-2">
      {perks.map((perk) => (
        <li key={perk} className="flex items-start gap-2 text-sm text-muted-foreground">
          <Check className="mt-0.5 size-4 shrink-0 text-mint" />
          <span>{perk}</span>
        </li>
      ))}
    </ul>
  );
}

/** The email-it-to-me action for the browser version. Shown once premium is on. */
export function PremiumWebLink() {
  const { t } = useTranslation();
  const [emailing, setEmailing] = useState(false);

  const sendEmail = async () => {
    if (!isUnlockServiceConfigured()) {
      notify({ title: t("premium"), body: t("premium_email_unavailable"), kind: "info" });
      return;
    }
    setEmailing(true);
    try {
      const { emailSent } = await redeemWithUnlockService({ force: true });
      notify({
        title: t("premium"),
        body: emailSent ? t("premium_email_sent") : t("premium_email_failed"),
        kind: "info",
      });
    } finally {
      setEmailing(false);
    }
  };

  return (
    <Button size="sm" variant="outline" className="w-full" disabled={emailing} onClick={sendEmail}>
      <Mail className="mr-1.5 size-3.5" /> {t("premium_email_link")}
    </Button>
  );
}

/** Premium block in the Settings sheet: buy, restore, or show the active state. */
export function PremiumSection() {
  const { t } = useTranslation();
  const entitlement = usePremium();
  const [product, setProduct] = useState<PremiumProduct | null>(null);
  const [busy, setBusy] = useState(false);

  // Price comes from Play, so it's only available in the Android build and only
  // once the product is live in Play Console.
  useEffect(() => {
    if (!isBillingSupported() || entitlement) return;
    let cancelled = false;
    void getPremiumProduct().then((p) => {
      if (!cancelled) setProduct(p);
    });
    return () => {
      cancelled = true;
    };
  }, [entitlement]);

  const handleBuy = async () => {
    setBusy(true);
    try {
      const outcome = await purchasePremium();
      if (outcome.status === "pending") {
        notify({ title: t("premium"), body: t("premium_purchase_pending"), kind: "info" });
      } else if (outcome.status === "granted") {
        notify({ title: t("premium_active"), body: t("premium_tagline"), kind: "info" });
      }
      // "cancelled" is the user's own choice — no message needed.
    } catch (e) {
      console.error("[Premium] Purchase failed", e);
      notify({ title: t("sync_error"), body: t("premium_purchase_failed"), kind: "info" });
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    setBusy(true);
    try {
      const restored = await restorePremium();
      notify({
        title: t("premium"),
        body: restored ? t("premium_restored") : t("premium_restore_none"),
        kind: "info",
      });
    } finally {
      setBusy(false);
    }
  };

  // Early access: everyone has the features, nobody has a purchase. Say so
  // plainly instead of showing "Premium is active" (which would claim a
  // purchase that isn't there) or a buy button for something already free.
  if (entitlement?.source === "free") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-mint" />
          <span className="font-serif text-base leading-tight">{t("premium_free_all_title")}</span>
        </div>
        <p className="text-xs text-muted-foreground">{t("premium_free_all_body")}</p>
        <PremiumPerks withoutAds />
        {isBillingSupported() && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground"
            disabled={busy}
            onClick={handleRestore}
          >
            <RotateCw className="mr-1.5 size-3.5" /> {t("premium_restore")}
          </Button>
        )}
      </div>
    );
  }

  if (entitlement) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-mint" />
          <span className="font-serif text-base leading-tight">{t("premium_active")}</span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {t("premium_active_since")} {new Date(entitlement.purchasedAt).toLocaleDateString()}
          {isUnlockServiceConfigured() && (
            <> · {entitlement.verified ? t("premium_verified") : t("premium_unverified")}</>
          )}
        </p>
        <PremiumWebLink />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-primary" />
        <span className="font-serif text-base leading-tight">{t("premium_title")}</span>
      </div>
      <p className="text-xs text-muted-foreground">{t("premium_tagline")}</p>
      <PremiumPerks />

      {isBillingSupported() ? (
        <>
          <Button className="w-full" disabled={busy} onClick={handleBuy}>
            <Sparkles className="mr-2 size-4" />
            {product ? t("premium_buy_price").replace("{price}", product.price) : t("premium_buy")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground"
            disabled={busy}
            onClick={handleRestore}
          >
            <RotateCw className="mr-1.5 size-3.5" /> {t("premium_restore")}
          </Button>
        </>
      ) : (
        // Browser build: Play checkout can't run here, so point at the phone.
        <p className="text-[11px] text-muted-foreground">{t("premium_only_on_android")}</p>
      )}
    </div>
  );
}
