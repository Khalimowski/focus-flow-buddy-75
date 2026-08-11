import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Bell, BellOff, ListTodo, Repeat, CheckSquare } from "lucide-react";
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
          "A gentle focus timer, daily nudges, and tiny tasks — designed for ADHD brains. Install to your phone, get reminders, build streaks.",
      },
      { property: "og:title", content: "FlowDay" },
      { property: "og:description", content: "Calm focus, gentle reminders, tiny wins." },
      { name: "theme-color", content: "#0F1115" },
    ],
  }),
  component: Home,
});

type Tab = "tasks" | "reminders" | "todo";

function Home() {
  const [tab, setTab] = useState<Tab>("tasks");
  const [perm, setPerm] = useState<string>("default");
  const [mounted, setMounted] = useState(false);
  // null = session check still in flight; afterwards true/false.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const { streak, markToday } = useStreak();
  const { t } = useTranslation();
  const { tutorialCompleted, theme, guestMode } = useI18nStore();
  const premium = usePremium();
  // True when this window is the Google OAuth popup landing back on the app
  // URL: don't boot the app here — finish the token handshake and close.
  const [oauthPopup] = useState(() => isOAuthPopupCallback());

  useEffect(() => {
    if (oauthPopup) {
      void import("@/lib/google").then((g) => g.completeOAuthPopup());
      return;
    }
    // Sync theme on mount to prevent flashing
    const root = window.document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    setMounted(true);
    setPerm(getPermission());
    void import("@/lib/native").then((m) => {
      m.initNative();
      m.updateStatusBar(theme);
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
  if (signedIn === null) return null;
  if (!signedIn && !guestMode) return <AuthGate />;

  // Browser access is the premium feature. Android is never gated — that's the
  // free, ad-supported tier, and where the purchase is made.
  if (WEB_GATE_ENABLED && !isNative() && !premium) return <PremiumGate />;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 pb-24 xl:max-w-6xl 2xl:max-w-[1600px]">
      {!tutorialCompleted && <Onboarding />}
      <AICoach />
      <InAppToaster />
      <EndOfDayReview />
      <WhatsNew />

      <header className="sticky top-0 z-30 -mx-4 mb-10 bg-background/80 px-4 pb-2 pt-safe-top-sm backdrop-blur-xl">
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
                <span className="hidden sm:inline text-xs">{perm === "denied" ? t('blocked') : t('enable_nudges')}</span>
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

      <nav className="my-6 flex gap-1 rounded-full border bg-card/40 p-1 backdrop-blur" data-tour="tabs">
        {(
          [
            { id: "tasks", label: t('tasks'), icon: ListTodo },
            { id: "todo", label: t('todo'), icon: CheckSquare },
            { id: "reminders", label: t('nudges'), icon: Repeat },
          ] as const
        ).map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              // min-w-0 + truncate: the labels are translated, and Polish
              // "Przypominajki" ran off the right edge of a 375px screen.
              className={`relative flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-2 text-sm font-medium transition sm:gap-2 sm:px-3 ${
                active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="tab-pill"
                  className="absolute inset-0 rounded-full bg-primary"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <Icon className="relative size-4 shrink-0" />
              <span className="relative truncate">{t.label}</span>
            </button>
          );
        })}
      </nav>

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
      </motion.section>

      <footer className="mt-12 text-center text-[11px] text-muted-foreground">
        {t('footer_hint')}
      </footer>
    </div>
  );
}
