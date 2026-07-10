import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, Wand2, Check, Clock, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHistoryStore } from "@/lib/history";
import { useTranslation, useI18nStore } from "@/lib/i18n";
import { notify } from "@/lib/notifications";
import { loadJSON, saveJSON, STORAGE_KEYS } from "@/lib/storage";
import { generateId } from "@/lib/utils";
import { isNative, scheduleNativeAt, hashId } from "@/lib/native";
import { format } from "date-fns";

type SuggestionStep = "greeting" | "preview";

type Task = {
  id: string;
  title: string;
  done: boolean;
  remindAt: string | null; // ISO
  dueDate: string; // YYYY-MM-DD
  notified?: boolean;
  createdAt: number;
};

type SuggestedTask = {
  id: string;
  title: string;
  time: string | null; // "HH:mm"
  source: "habit" | "default";
  selected: boolean;
};

// Event fired by Settings to open the coach on demand
export const AI_COACH_OPEN_EVENT = "ff.ai_coach.open";

export function AICoach() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<SuggestionStep>("greeting");
  const [suggestions, setSuggestions] = useState<SuggestedTask[]>([]);
  const { getDaysSinceLaunch, getDaysSinceLastAISuggestion, setAISuggestionDate, addEvent } = useHistoryStore();
  const { t } = useTranslation();
  const { calendarSync } = useI18nStore();

  // Build task suggestions from the user's history: titles that recur
  // (created/completed at least twice) and aren't already planned today,
  // topped up with default suggestions.
  const buildSuggestions = useCallback((): SuggestedTask[] => {
    const todayStr = format(new Date(), "yyyy-MM-dd");
    const tasks = loadJSON<Task[]>(STORAGE_KEYS.tasks, []);
    const todayTitles = new Set(
      tasks.filter((task) => task.dueDate === todayStr).map((task) => task.title.trim().toLowerCase())
    );

    const counts = new Map<string, { title: string; count: number }>();
    for (const ev of useHistoryStore.getState().events) {
      if (ev.type !== "task_created" && ev.type !== "task_completed") continue;
      const title = typeof ev.metadata?.title === "string" ? ev.metadata.title.trim() : "";
      if (!title) continue;
      const key = title.toLowerCase();
      const entry = counts.get(key) ?? { title, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }

    // The usual time for a recurring task: the most frequent reminder time
    // among stored tasks with the same title.
    const usualTimeFor = (key: string): string | null => {
      const freq = new Map<string, number>();
      let best: string | null = null;
      let bestCount = 0;
      for (const task of tasks) {
        if (!task.remindAt || task.title.trim().toLowerCase() !== key) continue;
        const d = new Date(task.remindAt);
        const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        const n = (freq.get(time) ?? 0) + 1;
        freq.set(time, n);
        if (n > bestCount) {
          bestCount = n;
          best = time;
        }
      }
      return best;
    };

    const result: SuggestedTask[] = [];
    const seen = new Set<string>();

    const habits = [...counts.entries()]
      .filter(([key, entry]) => entry.count >= 2 && !todayTitles.has(key))
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 3);

    for (const [key, entry] of habits) {
      seen.add(key);
      result.push({ id: generateId(), title: entry.title, time: usualTimeFor(key), source: "habit", selected: true });
    }

    const defaults: { title: string; time: string }[] = [
      { title: t("ai_coach_default_plan"), time: "09:00" },
      { title: t("ai_coach_default_break"), time: "13:00" },
      { title: t("ai_coach_default_review"), time: "19:00" },
    ];
    for (const d of defaults) {
      if (result.length >= 3) break;
      const key = d.title.trim().toLowerCase();
      if (todayTitles.has(key) || seen.has(key)) continue;
      result.push({ id: generateId(), title: d.title, time: d.time, source: "default", selected: true });
    }

    // Present as a day plan: earliest first, untimed suggestions last
    return result.sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99"));
  }, [t]);

  // Automatic trigger: at least 3 days since launch and 3 days since the
  // last suggestion interaction, once per session.
  useEffect(() => {
    const daysSinceLaunch = getDaysSinceLaunch();
    const daysSinceLastSuggestion = getDaysSinceLastAISuggestion();

    if (daysSinceLaunch >= 3 && daysSinceLastSuggestion >= 3) {
      const isAlreadyVisible = sessionStorage.getItem("ff.ai_coach.session_shown") === "true";
      if (!isAlreadyVisible) {
        setVisible(true);
        sessionStorage.setItem("ff.ai_coach.session_shown", "true");

        notify({
          title: "Focus Flow AI",
          body: t('ai_coach_ready'),
          kind: "info"
        });
      }
    }
  }, [getDaysSinceLaunch, getDaysSinceLastAISuggestion, t]);

  // Manual trigger from Settings: skip the greeting and go straight to the preview
  useEffect(() => {
    const openFromSettings = () => {
      setSuggestions(buildSuggestions());
      setStep("preview");
      setVisible(true);
    };
    window.addEventListener(AI_COACH_OPEN_EVENT, openFromSettings);
    return () => window.removeEventListener(AI_COACH_OPEN_EVENT, openFromSettings);
  }, [buildSuggestions]);

  const handleRefuse = () => {
    setVisible(false);
    setAISuggestionDate(Date.now());
    addEvent('ai_suggestion_refused');
    setStep("greeting");
  };

  const toggleSuggestion = (id: string) => {
    setSuggestions(prev => prev.map(s => s.id === id ? { ...s, selected: !s.selected } : s));
  };

  const handleAccept = () => {
    const accepted = suggestions.filter(s => s.selected);
    setVisible(false);
    setAISuggestionDate(Date.now());
    setStep("greeting");

    if (accepted.length === 0) {
      addEvent('ai_suggestion_refused');
      return;
    }

    try {
      const today = new Date();
      const todayStr = format(today, 'yyyy-MM-dd');
      const tasks = loadJSON<Task[]>(STORAGE_KEYS.tasks, []);

      for (const s of accepted) {
        let remindAt: string | null = null;
        if (s.time) {
          const [h, m] = s.time.split(":").map(Number);
          const d = new Date(today);
          d.setHours(h, m, 0, 0);
          // Only attach a reminder if the time hasn't already passed today
          if (d.getTime() > Date.now()) remindAt = d.toISOString();
        }

        const id = generateId();
        const newTask: Task = {
          id,
          title: s.title,
          done: false,
          remindAt,
          dueDate: todayStr,
          createdAt: Date.now(),
        };
        tasks.unshift(newTask);

        if (isNative() && remindAt) {
          scheduleNativeAt(hashId("task:" + id), s.title, t('reminder_title'), new Date(remindAt), calendarSync, id)
            .catch(e => console.error("Sync: schedule failed", e));
        }

        addEvent('task_created', { title: s.title, hasReminder: !!remindAt, date: todayStr, source: 'ai' });
      }

      saveJSON(STORAGE_KEYS.tasks, tasks);
      addEvent('ai_suggestion_accepted', { count: accepted.length });

      // TaskList listens for this and reloads from localStorage
      window.dispatchEvent(new Event('ff.data_updated'));

      notify({
        title: "Focus Flow AI",
        body: t('ai_coach_tasks_added'),
        kind: "info"
      });
    } catch (e) {
      console.error("Failed to apply AI suggestions", e);
    }
  };

  const showPreview = () => {
    setSuggestions(buildSuggestions());
    setStep("preview");
  };

  const selectedCount = suggestions.filter(s => s.selected).length;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          className="fixed bottom-24 left-4 right-4 z-40"
        >
          <div className="relative overflow-hidden rounded-3xl border border-primary/20 bg-card/95 p-5 backdrop-blur-xl shadow-glow">
            <div className="absolute -right-4 -top-4 size-24 rounded-full bg-primary/10 blur-2xl" />

            <button
              onClick={handleRefuse}
              aria-label={t('close')}
              className="absolute right-3 top-3 rounded-full p-1 text-muted-foreground hover:bg-secondary"
            >
              <X className="size-4" />
            </button>

            <div className="flex items-start gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-mint shadow-lg">
                <Sparkles className="size-6 text-white" />
              </div>

              <div className="flex-1 min-w-0 pr-6 text-left">
                {step === "greeting" ? (
                  <>
                    <h3 className="text-sm font-bold tracking-tight">AI Flow Coach</h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {t('ai_coach_greeting')}
                    </p>

                    <div className="mt-4 flex gap-2">
                      <Button size="sm" onClick={showPreview} className="h-8 rounded-full px-4 text-[11px] font-bold uppercase">
                        <Wand2 className="mr-1.5 size-3" />
                        {t('ai_coach_yes')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={handleRefuse} className="h-8 rounded-full px-4 text-[11px] uppercase">
                        {t('ai_coach_no')}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="space-y-3">
                    <h3 className="text-sm font-bold tracking-tight">{t('ai_coach_tasks_title')}</h3>
                    <p className="text-[11px] leading-tight text-muted-foreground">{t('ai_coach_tasks_desc')}</p>

                    <div className="rounded-xl bg-secondary/30 p-2 space-y-1 border border-primary/10">
                      {suggestions.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => toggleSuggestion(s.id)}
                          className={`flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition ${
                            s.selected ? "bg-primary/10" : "opacity-50"
                          }`}
                        >
                          <span
                            className={`grid size-5 shrink-0 place-items-center rounded-full border transition ${
                              s.selected ? "border-mint bg-mint text-mint-foreground" : "border-border"
                            }`}
                          >
                            {s.selected && <Check className="size-3" strokeWidth={3} />}
                          </span>
                          <span className="flex-1 min-w-0 truncate text-[11px] font-medium">{s.title}</span>
                          {s.time && (
                            <span className="flex items-center gap-1 font-mono text-[9px] text-muted-foreground">
                              <Clock className="size-2.5" /> {s.time}
                            </span>
                          )}
                          <span className={`text-[8px] font-bold uppercase tracking-tighter ${
                            s.source === "habit" ? "text-primary" : "text-mint"
                          }`}>
                            {s.source === "habit" ? t('ai_coach_habit_tag') : t('ai_coach_new_tag')}
                          </span>
                        </button>
                      ))}
                    </div>

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleAccept}
                        disabled={selectedCount === 0}
                        className="flex-1 h-8 rounded-full text-[10px] font-bold uppercase"
                      >
                        {t('ai_coach_accept')} ({selectedCount})
                      </Button>
                      <Button size="sm" variant="outline" onClick={handleRefuse} className="h-8 rounded-full px-3 text-[10px] uppercase">
                        <RotateCcw className="mr-1 size-3" /> {t('ai_coach_reject')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
