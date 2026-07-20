import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, Wand2, Check, Clock, RotateCcw, Plus, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHistoryStore } from "@/lib/history";
import { useTranslation, useI18nStore } from "@/lib/i18n";
import { notify } from "@/lib/notifications";
import { loadJSON, saveJSON, STORAGE_KEYS } from "@/lib/storage";
import { generateId } from "@/lib/utils";
import { isNative, scheduleNativeAt, hashId } from "@/lib/native";
import {
  emptyProfile,
  hasCompletedInterview,
  loadProfile,
  midTime,
  minTime,
  saveProfile,
  shiftTime,
  type LifeStage,
  type UserProfile,
} from "@/lib/profile";
import { format } from "date-fns";

type SuggestionStep = "greeting" | "interview" | "preview";

type Task = {
  id: string;
  title: string;
  done: boolean;
  remindAt: string | null; // ISO
  dueDate: string; // YYYY-MM-DD
  notified?: boolean;
  createdAt: number;
};

type Reminder = {
  id: string;
  label: string;
  times: string[]; // "HH:mm"
  enabled: boolean;
};

type SuggestedTask = {
  id: string;
  title: string;
  time: string | null; // "HH:mm"
  source: "habit" | "profile" | "default";
  selected: boolean;
};

// Event fired by Settings to open the coach on demand
export const AI_COACH_OPEN_EVENT = "ff.ai_coach.open";

// How many suggestions to show initially and per "suggest more" tap
const SUGGESTION_BATCH = 3;

// After this many days of usage the preview presents itself as a full day plan
const PLAN_MODE_DAYS = 7;

// Interview options: ids are stored in the profile, labels resolved via i18n
const LIFE_STAGES = [
  { id: "student", key: "ai_coach_life_student" },
  { id: "working", key: "ai_coach_life_working" },
  { id: "shift", key: "ai_coach_life_shift" },
  { id: "other", key: "ai_coach_life_other" },
] as const;

const SPORT_OPTIONS = [
  { id: "walk", key: "ai_coach_sport_walk" },
  { id: "gym", key: "ai_coach_sport_gym" },
  { id: "run", key: "ai_coach_sport_run" },
  { id: "bike", key: "ai_coach_sport_bike" },
  { id: "swim", key: "ai_coach_sport_swim" },
  { id: "yoga", key: "ai_coach_sport_yoga" },
  { id: "team", key: "ai_coach_sport_team" },
] as const;

// Monday-first display order, as JS getDay() numbers
const WEEK_DAYS = [
  { day: 1, key: "day_mon" },
  { day: 2, key: "day_tue" },
  { day: 3, key: "day_wed" },
  { day: 4, key: "day_thu" },
  { day: 5, key: "day_fri" },
  { day: 6, key: "day_sat" },
  { day: 0, key: "day_sun" },
] as const;

const chipClass = (selected: boolean) =>
  `rounded-full border px-2.5 py-1 text-[10px] font-medium transition ${
    selected ? "border-mint bg-mint/15 text-mint" : "border-border text-muted-foreground hover:bg-secondary/50"
  }`;

const timeInputClass = "rounded-lg border border-border bg-secondary/40 px-2 py-1 font-mono text-[11px]";

// Day-plan order for display: earliest first, untimed last
const byTime = (a: SuggestedTask, b: SuggestedTask) =>
  (a.time ?? "99:99").localeCompare(b.time ?? "99:99");

export function AICoach() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<SuggestionStep>("greeting");
  const [pool, setPool] = useState<SuggestedTask[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestedTask[]>([]);
  const [interviewPage, setInterviewPage] = useState(0);
  const [draft, setDraft] = useState<UserProfile>(emptyProfile);
  const { getDaysSinceLaunch, getDaysSinceLastAISuggestion, setAISuggestionDate, addEvent } = useHistoryStore();
  const { t } = useTranslation();
  const { calendarSync } = useI18nStore();

  // Build the full ranked pool of suggestion candidates: titles that recur
  // in history (created/completed at least twice) and aren't already planned
  // today — strongest habits first — followed by default suggestions. The UI
  // shows the pool in batches of SUGGESTION_BATCH via "suggest more".
  const buildSuggestionPool = useCallback((): SuggestedTask[] => {
    const todayStr = format(new Date(), "yyyy-MM-dd");
    const tasks = loadJSON<Task[]>(STORAGE_KEYS.tasks, []);
    const todayTitles = new Set(
      tasks.filter((task) => task.dueDate === todayStr).map((task) => task.title.trim().toLowerCase())
    );

    // Titles an active nudge already covers — no point suggesting them as tasks
    const nudgeTitles = new Set(
      loadJSON<Reminder[]>(STORAGE_KEYS.reminders, [])
        .filter((r) => r.enabled)
        .map((r) => r.label.trim().toLowerCase())
    );
    const isTaken = (key: string) => todayTitles.has(key) || nudgeTitles.has(key);

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
      .filter(([key, entry]) => entry.count >= 2 && !isTaken(key))
      .sort((a, b) => b[1].count - a[1].count);

    for (const [key, entry] of habits) {
      seen.add(key);
      result.push({ id: generateId(), title: entry.title, time: usualTimeFor(key), source: "habit", selected: true });
    }

    // Profile-driven: a session for each declared sport on its declared days,
    // placed an hour after the busy block ends.
    const profile = loadProfile();
    if (profile.sportDays.includes(new Date().getDay())) {
      const sportTime = profile.workEnd ? shiftTime(profile.workEnd, 60) : "18:00";
      for (const sportId of profile.sports) {
        const option = SPORT_OPTIONS.find((o) => o.id === sportId);
        const title = `${t("ai_coach_sport_prefix")} ${option ? t(option.key) : sportId}`;
        const key = title.trim().toLowerCase();
        if (isTaken(key) || seen.has(key)) continue;
        seen.add(key);
        result.push({ id: generateId(), title, time: sportTime, source: "profile", selected: true });
      }
    }

    // Defaults, anchored to the user's busy hours when known
    const ws = profile.workStart;
    const we = profile.workEnd;
    const defaults: { title: string; time: string }[] = [
      { title: t("ai_coach_default_plan"), time: ws ?? "09:00" },
      { title: t("ai_coach_default_break"), time: ws && we ? midTime(ws, we) : "13:00" },
      { title: t("ai_coach_default_review"), time: we ? minTime(shiftTime(we, 120), "21:00") : "19:00" },
      { title: t("ai_coach_default_hydrate"), time: ws ? shiftTime(ws, 90) : "10:30" },
      { title: t("ai_coach_default_tidy"), time: we ? shiftTime(we, 30) : "16:00" },
      { title: t("ai_coach_default_small_win"), time: ws ? shiftTime(ws, 120) : "11:00" },
    ];
    for (const d of defaults) {
      const key = d.title.trim().toLowerCase();
      if (isTaken(key) || seen.has(key)) continue;
      result.push({ id: generateId(), title: d.title, time: d.time, source: "default", selected: true });
    }

    return result;
  }, [t]);

  // Show the first batch of a freshly built pool
  const startSuggestions = useCallback(() => {
    const fullPool = buildSuggestionPool();
    setPool(fullPool);
    setSuggestions([...fullPool.slice(0, SUGGESTION_BATCH)].sort(byTime));
  }, [buildSuggestionPool]);

  // Append the next batch from the pool (new ones arrive pre-selected)
  const showMoreSuggestions = () => {
    setSuggestions((current) => {
      const shownIds = new Set(current.map((s) => s.id));
      const next = pool.filter((s) => !shownIds.has(s.id)).slice(0, SUGGESTION_BATCH);
      return [...current, ...next].sort(byTime);
    });
  };

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

  // Re-run the interview (pre-filled with the stored answers)
  const openInterview = useCallback(() => {
    setDraft(loadProfile());
    setInterviewPage(0);
    setStep("interview");
  }, []);

  // The greeting's YES and the Settings button both land here: run the
  // interview first if the user never took it, otherwise show suggestions.
  const showPreview = useCallback(() => {
    if (!hasCompletedInterview(loadProfile())) {
      openInterview();
    } else {
      startSuggestions();
      setStep("preview");
    }
  }, [openInterview, startSuggestions]);

  // Manual trigger from Settings: skip the greeting
  useEffect(() => {
    const openFromSettings = () => {
      showPreview();
      setVisible(true);
    };
    window.addEventListener(AI_COACH_OPEN_EVENT, openFromSettings);
    return () => window.removeEventListener(AI_COACH_OPEN_EVENT, openFromSettings);
  }, [showPreview]);

  const finishInterview = (finalDraft: UserProfile) => {
    saveProfile({ ...finalDraft, completedAt: Date.now() });
    addEvent("profile_updated");
    startSuggestions();
    setStep("preview");
  };

  const interviewNext = () => {
    if (interviewPage === 0) {
      setInterviewPage(1);
    } else if (interviewPage === 1) {
      // Commit the displayed default hours if the inputs were left untouched
      setDraft((d) => ({ ...d, workStart: d.workStart ?? "09:00", workEnd: d.workEnd ?? "17:00" }));
      setInterviewPage(2);
    } else {
      finishInterview(draft);
    }
  };

  // Skip = advance without changing the current answer
  const interviewSkip = () => {
    if (interviewPage < 2) setInterviewPage(interviewPage + 1);
    else finishInterview(draft);
  };

  const toggleLifeStage = (id: LifeStage) =>
    setDraft((d) => ({ ...d, lifeStage: d.lifeStage === id ? null : id }));

  const toggleSport = (id: string) =>
    setDraft((d) => ({
      ...d,
      sports: d.sports.includes(id) ? d.sports.filter((s) => s !== id) : [...d.sports, id],
    }));

  const toggleSportDay = (day: number) =>
    setDraft((d) => ({
      ...d,
      sportDays: d.sportDays.includes(day) ? d.sportDays.filter((n) => n !== day) : [...d.sportDays, day],
    }));

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

  const selectedCount = suggestions.filter(s => s.selected).length;

  // After a week of usage (and a taken interview) the preview is a day plan
  const planMode = getDaysSinceLaunch() >= PLAN_MODE_DAYS && hasCompletedInterview(loadProfile());

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
                ) : step === "interview" ? (
                  <div className="space-y-3">
                    <h3 className="text-sm font-bold tracking-tight">{t('ai_coach_interview_title')}</h3>
                    <p className="text-[11px] leading-tight text-muted-foreground">{t('ai_coach_interview_desc')}</p>

                    {interviewPage === 0 && (
                      <div className="space-y-2">
                        <p className="text-[11px] font-medium">{t('ai_coach_q_life_stage')}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {LIFE_STAGES.map((o) => (
                            <button key={o.id} onClick={() => toggleLifeStage(o.id)} className={chipClass(draft.lifeStage === o.id)}>
                              {t(o.key)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {interviewPage === 1 && (
                      <div className="space-y-2">
                        <p className="text-[11px] font-medium">{t('ai_coach_q_work_hours')}</p>
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="text-muted-foreground">{t('ai_coach_work_from')}</span>
                          <input
                            type="time"
                            value={draft.workStart ?? "09:00"}
                            onChange={(e) => setDraft((d) => ({ ...d, workStart: e.target.value }))}
                            className={timeInputClass}
                          />
                          <span className="text-muted-foreground">{t('ai_coach_work_to')}</span>
                          <input
                            type="time"
                            value={draft.workEnd ?? "17:00"}
                            onChange={(e) => setDraft((d) => ({ ...d, workEnd: e.target.value }))}
                            className={timeInputClass}
                          />
                        </div>
                      </div>
                    )}

                    {interviewPage === 2 && (
                      <div className="space-y-2">
                        <p className="text-[11px] font-medium">{t('ai_coach_q_sports')}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {SPORT_OPTIONS.map((o) => (
                            <button key={o.id} onClick={() => toggleSport(o.id)} className={chipClass(draft.sports.includes(o.id))}>
                              {t(o.key)}
                            </button>
                          ))}
                        </div>
                        {draft.sports.length > 0 && (
                          <>
                            <p className="text-[11px] font-medium">{t('ai_coach_q_sport_days')}</p>
                            <div className="flex flex-wrap gap-1.5">
                              {WEEK_DAYS.map((d) => (
                                <button key={d.day} onClick={() => toggleSportDay(d.day)} className={chipClass(draft.sportDays.includes(d.day))}>
                                  {t(d.key)}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button size="sm" onClick={interviewNext} className="flex-1 h-8 rounded-full text-[10px] font-bold uppercase">
                        {interviewPage < 2 ? t('ai_coach_next') : t('ai_coach_done')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={interviewSkip} className="h-8 rounded-full px-3 text-[10px] uppercase">
                        {t('ai_coach_skip')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <h3 className="text-sm font-bold tracking-tight">{planMode ? t('ai_coach_plan_title') : t('ai_coach_tasks_title')}</h3>
                    <p className="text-[11px] leading-tight text-muted-foreground">{planMode ? t('ai_coach_plan_desc') : t('ai_coach_tasks_desc')}</p>

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
                            {s.source === "habit" ? t('ai_coach_habit_tag') : s.source === "profile" ? t('ai_coach_profile_tag') : t('ai_coach_new_tag')}
                          </span>
                        </button>
                      ))}

                      {suggestions.length < pool.length && (
                        <button
                          onClick={showMoreSuggestions}
                          className="flex w-full items-center justify-center gap-1 rounded-lg p-1.5 text-[10px] font-bold uppercase tracking-tight text-primary transition hover:bg-primary/10"
                        >
                          <Plus className="size-3" strokeWidth={3} /> {t('ai_coach_more')}
                        </button>
                      )}
                    </div>

                    <button
                      onClick={openInterview}
                      className="flex w-full items-center justify-center gap-1 rounded-lg p-1 text-[10px] font-medium uppercase tracking-tight text-muted-foreground transition hover:bg-secondary/50"
                    >
                      <UserRound className="size-3" /> {t('ai_coach_update_info')}
                    </button>

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
