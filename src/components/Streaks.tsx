import { useEffect, useState } from "react";
import { Flame } from "lucide-react";
import { loadJSON, saveJSON, STORAGE_KEYS } from "@/lib/storage";
import { useTranslation } from "@/lib/i18n";

type Streak = { days: string[]; current: number; best: number };

const today = () => new Date().toISOString().slice(0, 10);
const yesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
};

export function useStreak() {
  const [s, setS] = useState<Streak>({ days: [], current: 0, best: 0 });

  useEffect(() => {
    const load = () => setS(loadJSON<Streak>(STORAGE_KEYS.streak, { days: [], current: 0, best: 0 }));
    load();
    // Re-read after cloud sync applies remote data
    window.addEventListener("ff.remote-update", load);
    return () => window.removeEventListener("ff.remote-update", load);
  }, []);

  const markToday = () => {
    setS((prev) => {
      if (prev.days.includes(today())) return prev;
      const days = [...prev.days, today()].slice(-60);
      const current = prev.days.includes(yesterday()) || prev.current === 0 ? prev.current + 1 : 1;
      const next = { days, current, best: Math.max(prev.best, current) };
      saveJSON(STORAGE_KEYS.streak, next);
      return next;
    });
  };

  return { streak: s, markToday };
}

export function StreakStrip({ streak }: { streak: Streak }) {
  const { t } = useTranslation();
  // last 14 days
  const cells = Array.from({ length: 14 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    const key = d.toISOString().slice(0, 10);
    return { key, done: streak.days.includes(key), label: d.getDate() };
  });

  return (
    <div className="rounded-2xl border bg-card/40 p-5 backdrop-blur">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            {t('streak_current')}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-4xl font-semibold">{streak.current}</span>
            <span className="text-sm text-muted-foreground">{t('days')}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-sm">
          <Flame className="size-4 text-mint" />
          <span className="font-mono">{t('streak_best')} {streak.best}</span>
        </div>
      </div>
      <div
        className="grid grid-cols-14 gap-1.5"
        style={{ gridTemplateColumns: "repeat(14, minmax(0, 1fr))" }}
      >
        {cells.map((c) => (
          <div
            key={c.key}
            title={c.key}
            className={`aspect-square rounded-md border text-[10px] font-mono grid place-items-center transition ${
              c.done
                ? "bg-mint/80 border-mint text-mint-foreground shadow-soft"
                : "border-border bg-surface text-muted-foreground"
            }`}
          >
            {c.label}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {t('streak_desc')}
      </p>
    </div>
  );
}
