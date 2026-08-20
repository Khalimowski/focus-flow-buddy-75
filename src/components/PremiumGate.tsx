import { useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, Smartphone, RefreshCw, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";
import { PremiumPerks } from "@/components/Premium";
import { getSyncUser, fullSync, signOut } from "@/lib/sync";

/**
 * Full-screen lock for the browser build: browser access is the paid feature.
 * Never rendered on Android — the phone app stays free (ad-supported), which is
 * also where the purchase happens.
 *
 * Unlocking needs no action from us: the phone writes the entitlement, sync
 * mirrors it to the account's cloud row, and this page's usePremium() picks it
 * up on the next pull. "Check again" just forces that pull immediately instead
 * of waiting for the 15s poll.
 */
export function PremiumGate() {
  const { t } = useTranslation();
  const [checking, setChecking] = useState(false);
  const [checkedEmpty, setCheckedEmpty] = useState(false);
  const user = getSyncUser();

  const checkAgain = async () => {
    setChecking(true);
    setCheckedEmpty(false);
    try {
      await fullSync();
      // If the pull carried an entitlement, usePremium() in the parent has
      // already swapped this screen out; reaching here means it didn't.
      setCheckedEmpty(true);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="space-y-6"
      >
        <div className="flex flex-col items-center text-center">
          {/* A flat ink plate, not the old indigo-to-mint gradient: the
              editorial palette has no second hue to gradient towards, and
              `primary` is near-white in the dark theme, which turned the chip
              into a glowing blob. */}
          <div className="grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <Sparkles className="size-7" strokeWidth={1.75} />
          </div>
          <h1 className="mt-5 font-serif text-2xl leading-tight">{t("premium_web_locked_title")}</h1>
          <div className="mt-4 h-px w-16 bg-border" />
          <p className="mt-4 font-serif text-sm italic leading-relaxed text-muted-foreground">
            {t("premium_web_locked_body")}
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <PremiumPerks />
        </div>

        {/* No guest branch here: the browser version has no guest mode, so
            anyone seeing this screen is signed in and the entitlement can
            only arrive through their account. */}
        <div className="space-y-3">
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Smartphone className="size-3.5" />
            <span>{t("premium_only_on_android")}</span>
          </div>
          <Button className="w-full" disabled={checking} onClick={checkAgain}>
            <RefreshCw className={`mr-2 size-4 ${checking ? "animate-spin" : ""}`} />
            {checking ? t("premium_checking") : t("premium_check_again")}
          </Button>
          {checkedEmpty && (
            <p className="text-center text-[11px] text-muted-foreground">
              {t("premium_still_locked")}
            </p>
          )}
          {user && (
            <div className="pt-2 text-center">
              <p className="text-[11px] text-muted-foreground">
                {t("signed_in_as")}{" "}
                <span className="font-medium text-foreground">{user.email}</span>
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 text-muted-foreground"
                onClick={() => void signOut()}
              >
                <LogOut className="mr-1.5 size-3.5" /> {t("sign_out")}
              </Button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
