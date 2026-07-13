import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Bell, BellOff, ListTodo, Repeat, CheckSquare, Brain } from "lucide-react";
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
import { AICoach } from "@/components/AICoach";
import { UpdateBanner } from "@/components/UpdateBanner";
import { isNative, updateStatusBar } from "@/lib/native";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Focus Flow — Calm focus & reminders for ADHD brains" },
      {
        name: "description",
        content:
          "A gentle focus timer, daily nudges, and tiny tasks — designed for ADHD brains. Install to your phone, get reminders, build streaks.",
      },
      { property: "og:title", content: "Focus Flow" },
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
  // Bumped when cloud sync writes remote data into localStorage, so the
  // active tab remounts and re-reads storage.
  const [syncEpoch, setSyncEpoch] = useState(0);
  // null = session check still in flight; afterwards true/false.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const { streak, markToday } = useStreak();
  const { t } = useTranslation();
  const { tutorialCompleted, theme, guestMode } = useI18nStore();

  useEffect(() => {
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
    const onRemoteUpdate = () => setSyncEpoch((e) => e + 1);
    const onAuthChanged = () => {
      void import("@/lib/sync").then((m) => setSignedIn(!!m.getSyncUser()));
    };
    window.addEventListener("ff.remote-update", onRemoteUpdate);
    window.addEventListener("ff.auth-changed", onAuthChanged);
    return () => {
      window.removeEventListener("ff.remote-update", onRemoteUpdate);
      window.removeEventListener("ff.auth-changed", onAuthChanged);
    };
  }, []);

  const askPerm = async () => {
    const p = await ensurePermission();
    setPerm(p);
  };

  if (!mounted) return null;

  // Auth-first: until the session check finishes, render nothing; then show
  // the login page unless signed in or explicitly continuing as guest.
  if (signedIn === null) return null;
  if (!signedIn && !guestMode) return <AuthGate />;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 pb-24 xl:max-w-6xl 2xl:max-w-[1600px]">
      {!tutorialCompleted && <Onboarding />}
      <AICoach />
      <InAppToaster />

      <header className="sticky top-0 z-30 -mx-4 mb-10 bg-background/80 px-4 pb-2 pt-safe-top-sm backdrop-blur-xl">
        <div className="relative flex items-center justify-center min-h-[64px]">
          <div className="absolute left-0 top-1/2 -translate-y-1/2">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-primary to-mint shadow-glow"
            >
              <Brain className="size-5 text-background/90" strokeWidth={2.25} />
            </motion.div>
          </div>

          <div className="text-center">
            <h1 className="text-xl font-bold tracking-tight">{t('app_name')}</h1>
            <p className="text-[10px] text-muted-foreground">{t('tagline')}</p>
          </div>

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
              className={`relative flex flex-1 items-center justify-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition ${
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
              <Icon className="relative size-4" />
              <span className="relative">{t.label}</span>
            </button>
          );
        })}
      </nav>

      <motion.section
        key={`${tab}-${syncEpoch}`}
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
