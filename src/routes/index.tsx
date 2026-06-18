import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Bell, BellOff, Brain, ListTodo, Repeat } from "lucide-react";
import { FocusTimer } from "@/components/FocusTimer";
import { TaskList } from "@/components/TaskList";
import { Reminders } from "@/components/Reminders";
import { StreakStrip, useStreak } from "@/components/Streaks";
import { InAppToaster } from "@/components/InAppToaster";
import { ensurePermission, getPermission } from "@/lib/notifications";
import { Button } from "@/components/ui/button";
import { Settings } from "@/components/Settings";
import { useTranslation } from "@/lib/i18n";

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

type Tab = "focus" | "tasks" | "reminders";

function Home() {
  const [tab, setTab] = useState<Tab>("focus");
  const [perm, setPerm] = useState<string>("default");
  const { streak, markToday } = useStreak();
  const { t } = useTranslation();

  useEffect(() => {
    setPerm(getPermission());
    void import("@/lib/native").then((m) => m.initNative());
  }, []);

  const askPerm = async () => {
    const p = await ensurePermission();
    setPerm(p);
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-4 pb-24 pt-6 sm:pt-10">
      <InAppToaster />

      <header className="mb-8 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 shrink-0">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="grid size-10 place-items-center rounded-2xl bg-gradient-to-br from-primary to-mint shadow-glow"
          >
            <div className="size-3 rounded-full bg-background/80" />
          </motion.div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{t('app_name')}</h1>
            <p className="text-xs text-muted-foreground">{t('tagline')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {perm !== "granted" && perm !== "unsupported" && (
            <Button size="sm" variant="secondary" onClick={askPerm} className="rounded-full h-9 whitespace-nowrap">
              {perm === "denied" ? <BellOff className="mr-2 size-4" /> : <Bell className="mr-2 size-4" />}
              {perm === "denied" ? t('blocked') : t('enable')}
            </Button>
          )}
          <Settings />
        </div>
      </header>

      <StreakStrip streak={streak} />

      <nav className="my-6 flex gap-1 rounded-full border bg-card/40 p-1 backdrop-blur">
        {(
          [
            { id: "focus", label: t('focus'), icon: Brain },
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
        {tab === "focus" && <FocusTimer />}
        {tab === "tasks" && <TaskList onComplete={markToday} />}
        {tab === "reminders" && <Reminders />}
      </motion.section>

      <footer className="mt-12 text-center text-[11px] text-muted-foreground">
        Tap "Enable nudges" then add this app to your home screen for phone-style reminders.
      </footer>
    </div>
  );
}
