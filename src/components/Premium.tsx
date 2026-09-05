import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Check,
  Copy,
  ExternalLink,
  Globe,
  Infinity as InfinityIcon,
  Mail,
  RefreshCw,
  RotateCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";
import { notify } from "@/lib/notifications";
import {
  entitlementPlan,
  isUnlockServiceConfigured,
  PLAN_LIST_PRICE,
  PLAY_SUBSCRIPTIONS_URL,
  redeemWithUnlockService,
  usePremium,
  WEB_APP_URL,
  type PremiumPlan,
} from "@/lib/premium";
import {
  getPremiumProducts,
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

/**
 * The browser address itself, spelled out once premium is on — the email link
 * only helps someone who can reach their inbox, and a user standing at another
 * computer just needs to read or copy the address.
 */
export function PremiumWebAddress() {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Shown without the scheme and trailing slash — it's an address to read and
  // type, not a link to click (the useful screen is usually the other device).
  const display = WEB_APP_URL.replace(/^https?:\/\//, "").replace(/\/+$/, "");

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(WEB_APP_URL);
      } else {
        // Older Android WebViews: no async clipboard, fall back to execCommand.
        const field = document.createElement("textarea");
        field.value = WEB_APP_URL;
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        field.select();
        document.execCommand("copy");
        field.remove();
      }
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("[Premium] Copy failed", e);
      notify({ title: t("premium"), body: t("premium_copy_failed"), kind: "info" });
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary/40 px-3 py-2">
        <Globe className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 select-all break-all font-mono text-xs">{display}</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 shrink-0 px-2 text-[11px] text-muted-foreground"
          onClick={copy}
        >
          {copied ? (
            <>
              <Check className="mr-1 size-3.5 text-mint" /> {t("premium_link_copied")}
            </>
          ) : (
            <>
              <Copy className="mr-1 size-3.5" /> {t("premium_copy_link")}
            </>
          )}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">{t("premium_web_address_hint")}</p>
    </div>
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

/**
 * One way to pay, as a tappable card.
 *
 * Both plans unlock exactly the same thing, so the two cards carry the same
 * visual weight. The only steer is the "best value" note on the one-off, which
 * is plainly true once you pass ten months — no countdown, no crossed-out
 * price, nothing that pressures a decision.
 */
function PlanOption({
  plan,
  price,
  disabled,
  onSelect,
}: {
  plan: PremiumPlan;
  price: string;
  disabled: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const monthly = plan === "monthly";
  const Icon = monthly ? RefreshCw : InfinityIcon;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className="w-full rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
    >
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-primary" />
        <span className="text-sm font-medium">
          {monthly ? t("premium_plan_monthly") : t("premium_plan_lifetime")}
        </span>
        {!monthly && (
          <span className="ml-auto rounded-full bg-mint/15 px-2 py-0.5 text-[10px] font-medium text-mint">
            {t("premium_plan_best_value")}
          </span>
        )}
      </div>
      <p className="mt-2 font-serif text-lg leading-tight">
        {t(monthly ? "premium_plan_monthly_price" : "premium_plan_lifetime_price").replace(
          "{price}",
          price,
        )}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {monthly ? t("premium_plan_monthly_note") : t("premium_plan_lifetime_note")}
      </p>
    </button>
  );
}

/** Premium block in the Settings sheet: buy, restore, or show the active state. */
export function PremiumSection() {
  const { t } = useTranslation();
  const entitlement = usePremium();
  const [products, setProducts] = useState<Partial<Record<PremiumPlan, PremiumProduct>>>({});
  const [busy, setBusy] = useState(false);

  // Prices come from Play, so they're only available in the Android build and
  // only once each product is live in Play Console. Whatever Play doesn't
  // answer for falls back to the configured list price below.
  useEffect(() => {
    if (!isBillingSupported() || entitlement) return;
    let cancelled = false;
    void getPremiumProducts().then((p) => {
      if (!cancelled) setProducts(p);
    });
    return () => {
      cancelled = true;
    };
  }, [entitlement]);

  const priceFor = (plan: PremiumPlan) => products[plan]?.price || PLAN_LIST_PRICE[plan];

  const handleBuy = async (plan: PremiumPlan) => {
    setBusy(true);
    try {
      const outcome = await purchasePremium(plan);
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

  const restoreButton = (
    <Button
      variant="ghost"
      size="sm"
      className="w-full text-muted-foreground"
      disabled={busy}
      onClick={handleRestore}
    >
      <RotateCw className="mr-1.5 size-3.5" /> {t("premium_restore")}
    </Button>
  );

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
        <PremiumWebAddress />
        {isBillingSupported() && restoreButton}
      </div>
    );
  }

  if (entitlement) {
    const plan = entitlementPlan(entitlement);
    // A subscription shows its period end when the unlock service has told us
    // one; without that service there is no date to show, so it falls back to
    // the purchase date like the one-off does.
    const periodEnd =
      plan === "monthly" && entitlement.expiresAt ? new Date(entitlement.expiresAt) : null;
    const dateLabel = periodEnd
      ? t(entitlement.autoRenewing === false ? "premium_ends_on" : "premium_renews_on")
      : t("premium_active_since");
    const date = periodEnd ?? new Date(entitlement.purchasedAt);

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-mint" />
          <span className="font-serif text-base leading-tight">{t("premium_active")}</span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {t(plan === "monthly" ? "premium_active_monthly" : "premium_active_lifetime")} ·{" "}
          {dateLabel} {date.toLocaleDateString()}
          {isUnlockServiceConfigured() && (
            <> · {entitlement.verified ? t("premium_verified") : t("premium_unverified")}</>
          )}
        </p>
        <PremiumWebAddress />
        <PremiumWebLink />
        {/* Play policy: a subscriber must be able to reach their subscription
            from inside the app. Only Play can cancel or change it. */}
        {plan === "monthly" && (
          <Button asChild size="sm" variant="ghost" className="w-full text-muted-foreground">
            <a href={PLAY_SUBSCRIPTIONS_URL} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1.5 size-3.5" /> {t("premium_manage_subscription")}
            </a>
          </Button>
        )}
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
          <p className="text-xs font-medium">{t("premium_choose_plan")}</p>
          <div className="space-y-2">
            <PlanOption
              plan="monthly"
              price={priceFor("monthly")}
              disabled={busy}
              onSelect={() => void handleBuy("monthly")}
            />
            <PlanOption
              plan="lifetime"
              price={priceFor("lifetime")}
              disabled={busy}
              onSelect={() => void handleBuy("lifetime")}
            />
          </div>
          {restoreButton}
        </>
      ) : (
        // Browser build: Play checkout can't run here, so point at the phone,
        // with both prices named so the decision can be made before picking the
        // phone up.
        <>
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>
              {t("premium_plan_monthly")} ·{" "}
              {t("premium_plan_monthly_price").replace("{price}", PLAN_LIST_PRICE.monthly)}
            </p>
            <p>
              {t("premium_plan_lifetime")} ·{" "}
              {t("premium_plan_lifetime_price").replace("{price}", PLAN_LIST_PRICE.lifetime)}
            </p>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("premium_only_on_android")}</p>
        </>
      )}
    </div>
  );
}
