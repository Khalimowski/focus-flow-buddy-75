import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Flame, Sparkles, ChevronRight, ListTodo, CalendarDays, Settings as SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18nStore, useTranslation } from "@/lib/i18n";

type Hole = { top: number; left: number; width: number; height: number };

const PAD = 8;
const POPUP_W = 340;
const POPUP_GAP = 14;

export function Onboarding() {
  const [step, setStep] = useState(0);
  const [hole, setHole] = useState<Hole | null>(null);
  const { setTutorialCompleted } = useI18nStore();
  const { t } = useTranslation();

  const steps = [
    { target: null, icon: Sparkles, color: "from-primary to-mint", title: t('onboarding_welcome'), desc: t('tagline') },
    { target: "streak", icon: Flame, color: "from-orange-400 to-red-400", title: t('tour_streak_title'), desc: t('tour_streak_desc') },
    { target: "tabs", icon: ListTodo, color: "from-blue-500 to-indigo-500", title: t('tour_tabs_title'), desc: t('tour_tabs_desc') },
    { target: "days", icon: CalendarDays, color: "from-emerald-400 to-teal-500", title: t('tour_days_title'), desc: t('tour_days_desc') },
    { target: "add-task", icon: Check, color: "from-primary to-mint", title: t('onboarding_tasks_title'), desc: t('onboarding_tasks_desc') },
    { target: "settings", icon: SettingsIcon, color: "from-violet-500 to-purple-500", title: t('tour_settings_title'), desc: t('tour_settings_desc') },
  ];

  const current = steps[step] ?? steps[0];
  const isLast = step === steps.length - 1;

  // Measure the highlighted element (after scrolling it into view) so the
  // spotlight cutout and the popup can be positioned around it.
  useEffect(() => {
    const measure = () => {
      if (!current.target) {
        setHole(null);
        return;
      }
      const el = document.querySelector(`[data-tour="${current.target}"]`);
      if (!el) {
        setHole(null);
        return;
      }
      el.scrollIntoView({ block: "center", behavior: "auto" });
      requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        setHole({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
      });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [step, current.target]);

  // Popup sits below the highlighted element when there's room, otherwise above.
  const popup = useMemo(() => {
    if (!hole) return null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(vw - 32, POPUP_W);
    const left = Math.min(Math.max(16, hole.left + hole.width / 2 - width / 2), vw - width - 16);
    const spaceBelow = vh - (hole.top + hole.height + POPUP_GAP);
    if (spaceBelow >= 260 || hole.top < 260) {
      return { top: hole.top + hole.height + POPUP_GAP, left, width } as const;
    }
    return { bottom: vh - hole.top + POPUP_GAP, left, width } as const;
  }, [hole]);

  const finish = () => setTutorialCompleted(true);
  const next = () => (step < steps.length - 1 ? setStep(step + 1) : finish());

  const Icon = current.icon;

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Dimmed backdrop with a spotlight cutout over the current element */}
      {hole ? (
        <motion.div
          initial={false}
          animate={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
          transition={{ type: "spring", stiffness: 320, damping: 32 }}
          className="absolute rounded-2xl ring-2 ring-primary/70 pointer-events-none"
          style={{ boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.7)" }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/70" />
      )}

      <div
        className={popup ? "absolute" : "absolute inset-0 flex items-center justify-center p-6"}
        style={popup ?? undefined}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.22 }}
            className="w-full max-w-[360px] rounded-3xl border border-primary/20 bg-card p-5 shadow-glow"
          >
            <div className="mb-3 flex items-center gap-3">
              <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${current.color} shadow-lg`}>
                <Icon className="size-5 text-white" />
              </div>
              <h3 className="text-base font-bold tracking-tight">{current.title}</h3>
            </div>

            <p className="text-sm leading-relaxed text-muted-foreground">{current.desc}</p>

            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="flex gap-1.5">
                {steps.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      i === step ? "w-6 bg-primary" : "w-1.5 bg-muted"
                    }`}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={finish} className="h-9 rounded-full px-3 text-xs">
                  {t('tour_skip')}
                </Button>
                <Button size="sm" onClick={next} className="h-9 rounded-full px-4 text-xs font-bold">
                  {isLast ? t('get_started') : t('next')}
                  {!isLast && <ChevronRight className="ml-1 size-3.5" />}
                </Button>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
