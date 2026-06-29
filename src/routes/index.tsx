import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Bell, BellOff, ListTodo, Repeat } from "lucide-react";
import { useTranslation, useI18nStore } from "@/lib/i18n";
import { TaskList } from "@/components/TaskList";
import { Reminders } from "@/components/Reminders";
import { StreakStrip, useStreak } from "@/components/Streaks";
import { InAppToaster } from "@/components/InAppToaster";
import { ensurePermission, getPermission, notify } from "@/lib/notifications";
import { Button } from "@/components/ui/button";
import { Settings } from "@/components/Settings";
import { Onboarding } from "@/components/Onboarding";
import { AICoach } from "@/components/AICoach";
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

type Tab = "tasks" | "reminders";

function Home() {
  const [tab, setTab] = useState<Tab>("tasks");
  const [perm, setPerm] = useState<string>("default");
  const [mounted, setMounted] = useState(false);
  const { streak, markToday } = useStreak();
  const { t } = useTranslation();
  const { tutorialCompleted, theme } = useI18nStore();

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

    // On Main Screen, back button should minimize instead of exit
    if (isNative()) {
      const initBackListener = async () => {
        const { App } = await import("@capacitor/app");
        const backListener = App.addListener("backButton", ({ canGoBack }) => {
          if (!canGoBack) {
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

  const askPerm = async () => {
    const p = await ensurePermission();
    setPerm(p);
  };

  if (!mounted) return null;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-4 pb-24 pt-safe-top">
      {!tutorialCompleted && <Onboarding />}
      <AICoach />
      <InAppToaster />

      <header className="mb-10 relative flex items-center justify-center min-h-[64px]">
        <div className="absolute left-0 top-1/2 -translate-y-1/2">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-primary to-mint shadow-glow"
          >
            <div className="size-3 rounded-full bg-background/80" />
          </motion.div>
        </div>

        <div className="text-center">
          <h1 className="text-xl font-bold tracking-tight">{t('app_name')}</h1>
          <p className="text-[10px] text-muted-foreground">{t('tagline')}</p>
        </div>

        <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-2">
          {perm !== "granted" && perm !== "unsupported" && (
            <Button size="sm" variant="secondary" onClick={askPerm} className="rounded-full h-8 w-8 p-0 sm:w-auto sm:px-3">
              {perm === "denied" ? <BellOff className="size-3.5 sm:mr-1.5" /> : <Bell className="size-3.5 sm:mr-1.5" />}
              <span className="hidden sm:inline text-xs">{perm === "denied" ? t('blocked') : t('enable_nudges')}</span>
            </Button>
          )}
          <Settings />
        </div>
      </header>

      <StreakStrip streak={streak} />

      <nav className="my-6 flex gap-1 rounded-full border bg-card/40 p-1 backdrop-blur">
        {(
          [
            { id: "tasks", label: t('tasks'), icon: ListTodo },
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
        key={tab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        {tab === "tasks" && <TaskList onComplete={markToday} />}
        {tab === "reminders" && <Reminders />}
      </motion.section>

      <footer className="mt-12 text-center text-[11px] text-muted-foreground">
        {t('footer_hint')}
      </footer>
    </div>
  );
}
