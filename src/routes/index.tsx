import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Bell, BellOff, ListTodo, Repeat, CheckSquare, BarChart3 } from "lucide-react";
import { useTranslation, useI18nStore } from "@/lib/i18n";
import { TaskList } from "@/components/TaskList";
import { Reminders } from "@/components/Reminders";
import { SimpleToDo } from "@/components/SimpleToDo";
import { StreakStrip, useStreak } from "@/components/Streaks";
import { InAppToaster } from "@/components/InAppToaster";
import { ensurePermission, getPermission, notify } from "@/lib/notifications";
import { Button } from "@/components/ui/button";
import { Settings } from "@/components/Settings";
import { Onboarding } from "@/components/Onboarding";
import { AuthGate } from "@/components/AuthGate";
import { PremiumGate } from "@/components/PremiumGate";
import { WEB_GATE_ENABLED, usePremium } from "@/lib/premium";
import { AICoach } from "@/components/AICoach";
import { Analytics } from "@/components/Analytics";
import { UpdateBanner } from "@/components/UpdateBanner";
import { WidgetPrompt } from "@/components/WidgetPrompt";
import { EndOfDayReview } from "@/components/EndOfDayReview";
import { WhatsNew } from "@/components/WhatsNew";
import { LogoMark } from "@/components/Logo";
import { isNative, updateStatusBar } from "@/lib/native";
import { isOAuthPopupCallback } from "@/lib/google";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FlowDay — Calm focus & reminders for ADHD brains" },
      {
        name: "description",
        content:
          "A gentle focus timer, daily habits, and tiny tasks — designed for ADHD brains. Install to your phone, get reminders, build streaks.",
      },
      { property: "og:title", content: "FlowDay" },
      { property: "og:description", content: "Calm focus, gentle reminders, tiny wins." },
      { name: "theme-color", content: "#0F1115" },
    ],
  }),
  component: Home,
});

type Tab = "tasks" | "reminders" | "todo" | "insights";

// Radix layers (dialogs, sheets, popovers, menus) all dismiss on Escape and
// mark themselves open in the DOM, so the hardware back button can close the
// topmost one by faking the keypress — Radix keeps the layer stack itself.
const OPEN_LAYER_SELECTOR = ["dialog", "alertdialog", "menu", "listbox"]
  .map((role) => `[role="${role}"][data-state="open"]`)
  .join(",");

const countOpenLayers = () => document.querySelectorAll(OPEN_LAYER_SELECTOR).length;

/**
 * Closes the topmost open overlay, if any. `onMiss` runs when there was
 * nothing to close, or when the layer refused to go — React needs a tick to
 * re-render the closed state, so the outcome is only knowable next timeout.
 * Without that fallback a layer that ignores Escape would eat the back press
 * and leave the button doing nothing at all.
 */
const dismissTopLayer = (onMiss: () => void) => {
  const before = countOpenLayers();
  if (before === 0) {
    onMiss();
    return;
  }
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  setTimeout(() => {
    if (countOpenLayers() >= before) onMiss();
  }, 0);
};

function Home() {
  const [tab, setTab] = useState<Tab>("tasks");
  const [perm, setPerm] = useState<string>("default");
  const [mounted, setMounted] = useState(false);
  // null = session check still in flight; afterwards true/false.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const { streak, markToday } = useStreak();
  const { t } = useTranslation();
  const { theme, guestMode } = useI18nStore();
  const premium = usePremium();
  // True when this window is the Google OAuth popup landing back on the app
  // URL: don't boot the app here — finish the token handshake and close.
  const [oauthPopup] = useState(() => isOAuthPopupCallback());

  useEffect(() => {
    if (oauthPopup) {
      void import("@/lib/google").then((g) => g.completeOAuthPopup());
      return;
    }
    // This branch is the "Classic Editorial" UI test build, which is only
    // drawn in light. Pin the palette instead of following the setting so the
    // phone always shows exactly what the Figma variation specifies — the
    // Settings theme toggle is inert here by design.
    const root = window.document.documentElement;
    root.classList.remove("dark");
    root.classList.add("light");

    setMounted(true);
    setPerm(getPermission());
    void import("@/lib/native").then((m) => {
      m.initNative();
      m.updateStatusBar("light");
    });
    void import("@/lib/sync").then(async (m) => {
      const user = await m.initSync();
      setSignedIn(!!user);
      // After the initial pull settles: clean up Google Calendar events whose
      // tasks were deleted/completed while no fresh token was around
      void import("@/lib/google").then((g) => g.reconcileGoogleCalendar());
      // Pick up purchases Play knows about but this install doesn't (new
      // device, reinstall, or a pending payment that settled), then finish any
      // verification/welcome-email left over from an offline purchase.
      void import("@/lib/billing").then((b) => b.reconcilePurchases());
      void import("@/lib/premium").then((p) => p.syncEntitlementWithService());
    });

    // On Main Screen, back button should minimize instead of exit
    if (isNative()) {
      const initBackListener = async () => {
        const { App } = await import("@capacitor/app");
        const backListener = App.addListener("backButton", ({ canGoBack }) => {
          const leaveScreen = () => {
            // Only navigate back within entries the app itself created (the
            // settings sheet's pushed state, or router navigations). Backing
            // beyond the first entry lands on a page the router can't render
            // (white screen), so minimize instead.
            const state = window.history.state as { settings?: boolean; __TSR_index?: number } | null;
            const hasInAppHistory = !!state?.settings || (state?.__TSR_index ?? 0) > 0;
            if (canGoBack && hasInAppHistory) {
              window.history.back();
            } else {
              void App.minimizeApp();
            }
          };
          // An open dialog/sheet/popover takes back first: on screen, "back"
          // means closing that layer, not leaving the app. Dialogs that don't
          // register history state (the calendar, the time picker) would
          // otherwise drop straight through to minimizeApp.
          dismissTopLayer(leaveScreen);
        });
        return backListener;
      };
      const backListenerPromise = initBackListener();
      return () => {
        void backListenerPromise.then(l => l.remove());
      };
    }
  }, [theme]);

  useEffect(() => {
    const onAuthChanged = () => {
      void import("@/lib/sync").then((m) => setSignedIn(!!m.getSyncUser()));
    };
    window.addEventListener("ff.auth-changed", onAuthChanged);
    return () => window.removeEventListener("ff.auth-changed", onAuthChanged);
  }, []);

  const askPerm = async () => {
    const p = await ensurePermission();
    setPerm(p);
  };

  // Insights is the browser version's own premium feature: the phone records
  // the activity (see lib/stats.ts), the browser is where you sit down and
  // read it. Deliberately absent on Android, which is the free tier.
  const showInsights = !isNative() && !!premium;
  const tabs: { id: Tab; label: string; icon: typeof ListTodo }[] = [
    { id: "tasks", label: t('tasks'), icon: ListTodo },
    { id: "todo", label: t('todo'), icon: CheckSquare },
    { id: "reminders", label: t('habits'), icon: Repeat },
    ...(showInsights ? [{ id: "insights" as const, label: t('insights'), icon: BarChart3 }] : []),
  ];

  if (oauthPopup) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-6 text-center text-sm text-muted-foreground">
        {t('oauth_popup_finishing')}
      </div>
    );
  }

  if (!mounted) return null;

  // Auth-first: until the session check finishes, render nothing; then show
  // the login page unless signed in or explicitly continuing as guest.
  // Guest mode is Android-only — the browser version always requires an
  // account, so a `guestMode` flag synced/persisted from the phone can't let
  // anyone past this gate on web.
  if (signedIn === null) return null;
  if (!signedIn && !(guestMode && isNative())) return <AuthGate />;

  // Browser access is the premium feature. Android is never gated — that's the
  // free, ad-supported tier, and where the purchase is made.
  if (WEB_GATE_ENABLED && !isNative() && !premium) return <PremiumGate />;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 pb-safe-nav xl:max-w-6xl 2xl:max-w-[1600px]">
      {/* Decides for itself which tour is due — first run, or a follow-up once
          Premium or the browser version brings new things into reach. */}
      <Onboarding />
      <AICoach />
      <InAppToaster />
      <EndOfDayReview />
      <WhatsNew />

      <header className="sticky top-0 z-30 -mx-4 mb-5 bg-background/85 px-4 pb-3 pt-safe-top-sm backdrop-blur-xl">
        <div className="relative flex items-center justify-center min-h-[64px]">
          {/* Mark and wordmark sit together in the middle, as on the brand sheet */}
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-center"
          >
            <h1 className="flex items-center justify-center gap-2">
              <LogoMark className="size-9" />
              <span className="text-xl font-bold tracking-tight">{t('app_name')}</span>
            </h1>
            <p className="text-[10px] text-muted-foreground">{t('tagline')}</p>
          </motion.div>

          <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-2" data-tour="settings">
            {perm !== "granted" && perm !== "unsupported" && (
              <Button size="sm" variant="secondary" onClick={askPerm} className="rounded-full h-8 w-8 p-0 sm:w-auto sm:px-3">
                {perm === "denied" ? <BellOff className="size-3.5 sm:mr-1.5" /> : <Bell className="size-3.5 sm:mr-1.5" />}
                <span className="hidden sm:inline text-xs">{perm === "denied" ? t('blocked') : t('enable_habits')}</span>
              </Button>
            )}
            <Settings />
          </div>
        </div>
      </header>

      <UpdateBanner />
      <WidgetPrompt />
      <div data-tour="streak">
        <StreakStrip streak={streak} />
      </div>

      {/* Keyed by tab only: remounting on sync would wipe in-progress input
          (draft titles, open edit rows, the picked date). Tabs re-read storage
          on ff.remote-update instead. */}
      <motion.section
        key={tab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        {tab === "tasks" && <TaskList onComplete={markToday} />}
        {tab === "todo" && <SimpleToDo />}
        {tab === "reminders" && <Reminders />}
        {tab === "insights" && showInsights && <Analytics />}
      </motion.section>

      {/* Bottom tab bar — "Classic Editorial" moves navigation off the top of
          the screen and onto the thumb. Fixed rather than sticky so it stays
          put while a tab's own list scrolls, and lifted above the ad banner
          by `bottom-safe-nav` so the banner never covers it. */}
      <nav
        className="fixed inset-x-0 bottom-safe-nav z-40 border-t border-border bg-card/95 backdrop-blur-xl"
        data-tour="tabs"
      >
        <div className="mx-auto flex w-full max-w-4xl items-stretch px-2 pb-[env(safe-area-inset-bottom,0px)] xl:max-w-6xl">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                // Insights is the one tab the tours point at on its own.
                data-tour={t.id === "insights" ? "insights" : undefined}
                // min-w-0 + truncate: the labels are translated, and a long
                // translation used to run off the right edge of a 375px screen.
                className={`relative flex min-w-0 flex-1 items-center justify-center gap-1.5 px-1 py-3 text-[11px] font-medium transition ${
                  active ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="tab-pill"
                    className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-primary"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                <Icon className="size-4 shrink-0" strokeWidth={active ? 2.4 : 1.9} />
                <span className="truncate">{t.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <footer className="mt-12 text-center text-[11px] text-muted-foreground">
        {t('footer_hint')}
      </footer>
    </div>
  );
}
