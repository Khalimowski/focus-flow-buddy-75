import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, Wand2, CalendarCheck, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHistoryStore } from "@/lib/history";
import { useTranslation, useI18nStore } from "@/lib/i18n";
import { notify } from "@/lib/notifications";
import { loadJSON, saveJSON, STORAGE_KEYS } from "@/lib/storage";
import { generateId } from "@/lib/utils";
import { isNative, scheduleNativeAt, scheduleNativeDaily, hashId } from "@/lib/native";
import { format } from "date-fns";

type SuggestionStep = "greeting" | "preview";

export function AICoach() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<SuggestionStep>("greeting");
  const { getDaysSinceLaunch, getDaysSinceLastAISuggestion, setAISuggestionDate, addEvent } = useHistoryStore();
  const { t } = useTranslation();
  const { calendarSync, nudgeCalendarSync } = useI18nStore();

  useEffect(() => {
    const daysSinceLaunch = getDaysSinceLaunch();
    const daysSinceLastSuggestion = getDaysSinceLastAISuggestion();

    // Trigger logic:
    // 1. Must be at least 2 days since launch
    // 2. Must be at least 2 days since the last suggestion interaction
    if (daysSinceLaunch >= 2 && daysSinceLastSuggestion >= 2) {
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

  const handleRefuse = () => {
    setVisible(false);
    setAISuggestionDate(Date.now());
    addEvent('ai_suggestion_refused');
    setStep("greeting");
  };

  const handleAccept = async () => {
    setVisible(false);
    setAISuggestionDate(Date.now());
    addEvent('ai_suggestion_accepted');

    try {
      const today = new Date();
      const todayStr = format(today, 'yyyy-MM-dd');

      // 1. Create Suggested Nudges
      const currentReminders = loadJSON<any[]>(STORAGE_KEYS.reminders, []);

      const newNudges = [
        { label: t('ai_coach_morning_hydration'), times: ["09:00"] },
        { label: t('ai_coach_wind_down'), times: ["19:00"] }
      ];

      for (const nudge of newNudges) {
        if (!currentReminders.some(r => r.label === nudge.label)) {
          const id = generateId();
          const r = {
            id,
            label: nudge.label,
            times: nudge.times,
            enabled: true,
            lastFired: {},
          };
          currentReminders.push(r);

          if (isNative()) {
            nudge.times.forEach((time, idx) => {
              const [h, m] = time.split(":").map(Number);
              void scheduleNativeDaily(hashId(`rem:${id}:${idx}`), nudge.label, t('gentle_nudge_emoji'), h, m, nudgeCalendarSync, id);
            });
          }
        }
      }
      saveJSON(STORAGE_KEYS.reminders, currentReminders);

      // 2. Refresh page to show new data (since we are outside the TaskList/Reminders state)
      // Alternatively, we could use a global state or event bus, but window.location.reload()
      // is the simplest reliable way to ensure all components see the updated localStorage.
      window.location.reload();

    } catch (e) {
      console.error("Failed to apply AI suggestions", e);
    }

    setStep("greeting");
  };

  const showPreview = () => {
    setStep("preview");
  };

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
                    <h3 className="text-sm font-bold tracking-tight">{t('ai_coach_suggested_title')}</h3>
                    <div className="rounded-xl bg-secondary/30 p-3 text-[11px] space-y-2 border border-primary/10">
                      <div className="flex items-center gap-2 text-primary font-bold uppercase tracking-tight">
                        <CalendarCheck className="size-3" /> {t('ai_coach_peak_focus')} (10:00 - 12:00)
                      </div>
                      <p className="text-muted-foreground italic leading-tight">"{t('ai_coach_peak_desc')}"</p>
                      <div className="border-t border-primary/10 pt-2 space-y-1">
                        <div className="flex justify-between">
                          <span>09:00 - {t('ai_coach_morning_hydration')}</span>
                          <span className="text-mint font-bold text-[9px] uppercase tracking-tighter">+{t('ai_coach_suggested_tag')}</span>
                        </div>
                        <div className="flex justify-between opacity-60">
                          <span>10:30 - {t('tasks')}</span>
                          <span className="text-[9px] uppercase tracking-tighter">({t('ai_coach_keep_tag')})</span>
                        </div>
                        <div className="flex justify-between">
                          <span>19:00 - {t('ai_coach_wind_down')}</span>
                          <span className="text-mint font-bold text-[9px] uppercase tracking-tighter">+{t('ai_coach_suggested_tag')}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleAccept} className="flex-1 h-8 rounded-full text-[10px] font-bold uppercase">
                        {t('ai_coach_accept')}
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
