import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Bell, Calendar, Sparkles, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18nStore, useTranslation } from "@/lib/i18n";

export function Onboarding() {
  const [step, setStep] = useState(0);
  const { setTutorialCompleted } = useI18nStore();
  const { t } = useTranslation();

  const slides = [
    {
      title: t('onboarding_welcome'),
      desc: t('tagline'),
      icon: Sparkles,
      color: "from-primary to-mint",
    },
    {
      title: t('onboarding_tasks_title'),
      desc: t('onboarding_tasks_desc'),
      icon: Check,
      color: "from-blue-500 to-indigo-500",
    },
    {
      title: t('onboarding_nudges_title'),
      desc: t('onboarding_nudges_desc'),
      icon: Bell,
      color: "from-orange-400 to-red-400",
    },
    {
      title: t('onboarding_sync_title'),
      desc: t('onboarding_sync_desc'),
      icon: Calendar,
      color: "from-emerald-400 to-teal-500",
    },
  ];

  const next = () => {
    if (step < slides.length - 1) {
      setStep(step + 1);
    } else {
      setTutorialCompleted(true);
    }
  };

  const current = slides[step] || slides[0];
  const Icon = current.icon;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background p-6 text-center overflow-y-auto">
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.3 }}
          className="flex flex-col items-center max-w-sm"
        >
          <div className={`mb-8 flex size-24 items-center justify-center rounded-3xl bg-gradient-to-br ${current.color} shadow-lg shadow-primary/20`}>
            <Icon className="size-10 text-white" />
          </div>

          <h2 className="mb-4 text-3xl font-bold tracking-tight text-foreground">
            {current.title}
          </h2>

          <p className="mb-12 text-muted-foreground leading-relaxed">
            {current.desc}
          </p>
        </motion.div>
      </AnimatePresence>

      <div className="mt-auto flex w-full flex-col gap-4 max-w-sm">
        <div className="flex justify-center gap-1.5 mb-6">
          {slides.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === step ? "w-8 bg-primary" : "w-1.5 bg-muted"
              }`}
            />
          ))}
        </div>

        <Button
          size="lg"
          onClick={next}
          className="h-14 rounded-2xl text-lg font-semibold shadow-glow"
        >
          {step === slides.length - 1 ? t('get_started') : t('next')}
          {step < slides.length - 1 && <ChevronRight className="ml-2 size-5" />}
        </Button>
      </div>
    </div>
  );
}
