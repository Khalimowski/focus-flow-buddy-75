import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart3,
  BadgeCheck,
  Check,
  Flame,
  Globe,
  Sparkles,
  ChevronRight,
  ListTodo,
  CalendarDays,
  CalendarClock,
  Mic,
  Repeat,
  CalendarSync,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18nStore, useTranslation, type TourId } from "@/lib/i18n";
import { usePremium } from "@/lib/premium";
import { isNative } from "@/lib/native";

type Hole = { top: number; left: number; width: number; height: number };

type Step = {
  /** `data-tour` value to spotlight, or null for a centred card. */
  target: string | null;
  icon: LucideIcon;
  title: string;
  desc: string;
};

/** The translator, with its keys still typed against the `en` dictionary. */
type T = ReturnType<typeof useTranslation>["t"];

const PAD = 8;
const POPUP_W = 340;
const POPUP_GAP = 14;

/**
 * How long to wait before a tour appears. Some anchors only exist after their
 * own mount effect has run (the mic button asks whether dictation is possible
 * first), and a step whose element is missing gets dropped — so measuring on
 * the same tick as this component's mount would silently lose it.
 */
const SETTLE_MS = 400;

/** Follow-up tours, in the order they'd be offered. 'main' is handled apart. */
const FOLLOW_UPS: TourId[] = ["premium", "web"];

/** An open sheet/dialog, which a tour has to wait out before it starts. */
const OPEN_LAYER_SELECTOR = ['[role="dialog"]', '[role="alertdialog"]']
  .map((role) => `${role}[data-state="open"]`)
  .join(",");

/**
 * The first-run tour, built for the device it's running on: the mic step is
 * dropped where dictation isn't offered (that anchor simply isn't rendered),
 * reads as locked without Premium, and Insights only exists in the browser.
 * Finishing it counts as having seen the follow-up tours too — it already
 * covered their ground.
 */
function mainSteps(t: T, native: boolean, premium: boolean): Step[] {
  return [
    { target: null, icon: Sparkles, title: t("onboarding_welcome"), desc: t("tagline") },
    { target: "streak", icon: Flame, title: t("tour_streak_title"), desc: t("tour_streak_desc") },
    { target: "tabs", icon: ListTodo, title: t("tour_tabs_title"), desc: t("tour_tabs_desc") },
    { target: "days", icon: CalendarDays, title: t("tour_days_title"), desc: t("tour_days_desc") },
    { target: "add-task", icon: Check, title: t("onboarding_tasks_title"), desc: t("onboarding_tasks_desc") },
    {
      target: "voice",
      icon: Mic,
      title: t("tour_voice_title"),
      // Early access is over, so on the free Android tier the mic is there but
      // locked. Telling that user to tap it and start talking is a dead end —
      // say what it does and where it comes from instead.
      desc: premium ? t("tour_voice_desc") : t("tour_voice_locked_desc"),
    },
    { target: "view-toggle", icon: CalendarClock, title: t("tour_views_title"), desc: t("tour_views_desc") },
    // Habits and Cycles are spotlit on their own tabs rather than opened: the
    // tour never switches tab, and an empty list teaches nothing anyway.
    { target: "tab-reminders", icon: Repeat, title: t("onboarding_habits_title"), desc: t("onboarding_habits_desc") },
    { target: "tab-cycles", icon: CalendarSync, title: t("tour_cycles_title"), desc: t("tour_cycles_desc") },
    ...(native
      ? []
      : [{ target: "insights", icon: BarChart3, title: t("tour_insights_title"), desc: t("tour_insights_desc") }]),
    { target: "settings", icon: SettingsIcon, title: t("tour_settings_title"), desc: t("tour_settings_desc") },
  ];
}

/** Shown once, on the device where a Premium purchase landed. */
function premiumSteps(t: T): Step[] {
  return [
    { target: null, icon: BadgeCheck, title: t("tour_premium_welcome_title"), desc: t("tour_premium_welcome_desc") },
    { target: "settings", icon: Globe, title: t("tour_premium_web_title"), desc: t("tour_premium_web_desc") },
    { target: "voice", icon: Mic, title: t("tour_premium_voice_title"), desc: t("tour_premium_voice_desc") },
    { target: null, icon: Sparkles, title: t("tour_premium_extras_title"), desc: t("tour_premium_extras_desc") },
  ];
}

/** Shown once per browser, for someone who already knows the phone app. */
function webSteps(t: T): Step[] {
  return [
    { target: null, icon: Globe, title: t("tour_web_welcome_title"), desc: t("tour_web_welcome_desc") },
    { target: "insights", icon: BarChart3, title: t("tour_insights_title"), desc: t("tour_insights_desc") },
    { target: "voice", icon: Mic, title: t("tour_voice_title"), desc: t("tour_voice_desc") },
  ];
}

/**
 * The guided tours. Renders nothing unless one is due:
 *
 *  - **main** on first run, adapted to the device it's running on;
 *  - **premium** the first time this device holds a real purchase;
 *  - **web** the first time the app is opened in a browser.
 *
 * Which ones have been seen is device-local (see TourId in lib/i18n.ts), so a
 * phone purchase teaches the phone, and the browser gets its own introduction
 * when the same account opens it there.
 */
export function Onboarding() {
  const [step, setStep] = useState(0);
  const [steps, setSteps] = useState<Step[]>([]);
  const [hole, setHole] = useState<Hole | null>(null);
  const { tutorialCompleted, toursSeen, setTutorialCompleted, markToursSeen } = useI18nStore();
  const { t, language } = useTranslation();
  const entitlement = usePremium();
  const native = isNative();
  // Early access hands everyone an entitlement with source "free" — nobody
  // bought anything, so nobody gets thanked for it.
  const purchased = !!entitlement && entitlement.source !== "free";

  const pending = useMemo<TourId[]>(() => {
    if (!tutorialCompleted) return ["main"];
    return FOLLOW_UPS.filter((id) => {
      if (toursSeen.includes(id)) return false;
      if (id === "premium") return native && purchased;
      return !native && !!entitlement;
    });
  }, [tutorialCompleted, toursSeen, native, purchased, entitlement]);

  const tour = pending[0] ?? null;

  const allSteps = useMemo<Step[]>(() => {
    if (tour === "main") return mainSteps(t, native, !!entitlement);
    if (tour === "premium") return premiumSteps(t);
    if (tour === "web") return webSteps(t);
    return [];
    // `language` is what changes the strings `t` returns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour, native, language, entitlement]);

  // Drop steps whose anchor isn't on screen — a feature this build doesn't
  // show (no mic, no Insights on Android) shouldn't leave a dangling card.
  useEffect(() => {
    setStep(0);
    setSteps([]);
    if (!tour) return;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      // Hold while a sheet or dialog owns the screen: the purchase that starts
      // the Premium tour is made inside Settings, and the release notes can be
      // up at launch — a spotlight can't point through either of them.
      if (document.querySelector(OPEN_LAYER_SELECTOR)) {
        timer = setTimeout(attempt, SETTLE_MS);
        return;
      }
      setSteps(
        allSteps.filter((s) => !s.target || document.querySelector(`[data-tour="${s.target}"]`)),
      );
    };
    timer = setTimeout(attempt, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [tour, allSteps]);

  const current = steps[step] ?? steps[0] ?? null;
  const isLast = steps.length > 0 && step === steps.length - 1;

  // Measure the highlighted element (after scrolling it into view) so the
  // spotlight cutout and the popup can be positioned around it.
  useEffect(() => {
    const target = current?.target ?? null;
    const measure = () => {
      if (!target) {
        setHole(null);
        return;
      }
      const el = document.querySelector(`[data-tour="${target}"]`);
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
  }, [step, current?.target]);

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

  if (!tour || !current) return null;

  /**
   * Close the tour. Skipping means "stop teaching me", so it retires everything
   * still queued; finishing the first-run tour retires the follow-ups too,
   * since it already showed what they would have.
   */
  const finish = (skipRest: boolean) => {
    if (tour === "main") {
      markToursSeen(FOLLOW_UPS);
      setTutorialCompleted(true);
      return;
    }
    markToursSeen(skipRest ? pending : [tour]);
  };

  const next = () => (step < steps.length - 1 ? setStep(step + 1) : finish(false));

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
        <div className="absolute inset-0 bg-scrim" />
      )}

      <div
        className={popup ? "absolute" : "absolute inset-0 flex items-center justify-center p-6"}
        style={popup ?? undefined}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={`${tour}-${step}`}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.22 }}
            className="w-full max-w-[360px] rounded-3xl border border-border bg-card p-5 shadow-lg"
          >
            <div className="mb-3 flex items-center gap-3">
              {/* One flat ink plate for every step. The tour used to give each
                  step its own saturated gradient (orange, indigo, teal…),
                  which is the one thing this palette has no room for. */}
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Icon className="size-5" strokeWidth={1.75} />
              </div>
              <h3 className="font-serif text-lg leading-tight">{current.title}</h3>
            </div>

            <p className="text-sm leading-relaxed text-muted-foreground">{current.desc}</p>

            <div className="mt-4 flex items-center justify-between gap-3">
              {/* Wraps rather than pushing the buttons off: the main tour is
                  eleven steps in the browser, which is more dots than a 375px
                  card fits on one line beside Skip and Next. */}
              <div className="flex min-w-0 flex-wrap gap-1.5">
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
                <Button variant="ghost" size="sm" onClick={() => finish(true)} className="h-9 rounded-full px-3 text-xs">
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
