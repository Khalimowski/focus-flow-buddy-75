import { useEffect, useState } from "react";
import { Flame } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { dateKey } from "@/lib/utils";
import { currentStreak, loadStreak, STREAK_EVENT, type Streak } from "@/lib/streak";

export function useStreak() {
  const [s, setS] = useState<Streak>({ days: [], current: 0, best: 0 });

  useEffect(() => {
    const load = () => {
      const stored = loadStreak();
      const current = currentStreak(stored.days ?? [], stored.current ?? 0);
      setS({ ...stored, current, best: Math.max(stored.best ?? 0, current) });
    };
    load();
    // Re-read after cloud sync applies remote data, and after any tick or
    // untick (the task list, a notification action or the widget).
    window.addEventListener("ff.remote-update", load);
    window.addEventListener(STREAK_EVENT, load);
    return () => {
      window.removeEventListener("ff.remote-update", load);
      window.removeEventListener(STREAK_EVENT, load);
    };
  }, []);

  return { streak: s };
}

export function StreakStrip({ streak }: { streak: Streak }) {
  const { t } = useTranslation();
  // Back to the original fortnight of dated squares. The two-row dot grid that
  // replaced it read as decoration: you could see *that* a day was kept but not
  // *which*, so the strip stopped answering "did I miss Tuesday?".
  const cells = Array.from({ length: 14 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    const key = dateKey(d);
    return { key, done: streak.days.includes(key), label: d.getDate() };
  });

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            {t('streak_current')}
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="font-serif text-5xl leading-none font-normal tabular-nums">
              {streak.current}
            </span>
            <span className="text-sm text-muted-foreground">
              {t(streak.current === 1 ? 'day' : 'days')}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs">
          <Flame className="size-3.5 text-mint" />
          <span className="tabular-nums">{t('streak_best')} {streak.best}</span>
        </div>
      </div>
      {/* 14 across is tight on a 390px phone (~17px a cell), which is why the
          numerals went away once. They are legible again at that size because
          the digits are mono and the gap is hairline; anything wider would push
          the strip past two weeks, and two weeks is the span that still reads
          as "recently". */}
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: "repeat(14, minmax(0, 1fr))" }}
      >
        {cells.map((c) => (
          <div
            key={c.key}
            title={c.key}
            className={`grid aspect-square place-items-center rounded-md border font-mono text-[10px] leading-none transition ${
              c.done
                ? "border-mint bg-mint/80 text-mint-foreground shadow-soft"
                : "border-border bg-surface text-muted-foreground"
            }`}
          >
            {c.label}
          </div>
        ))}
      </div>
      <p className="mt-4 font-serif text-[13px] italic text-muted-foreground">
        {t('streak_desc')}
      </p>
    </div>
  );
}
