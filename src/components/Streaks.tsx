import { useEffect, useState } from "react";
import { Flame } from "lucide-react";
import { loadJSON, saveJSON, STORAGE_KEYS } from "@/lib/storage";
import { useTranslation } from "@/lib/i18n";
import { dateKey, shiftDateKey } from "@/lib/utils";

type Streak = { days: string[]; current: number; best: number };

const today = () => dateKey();
const yesterday = () => shiftDateKey(-1);

/**
 * Length of the unbroken run ending today (or yesterday, so a day still in
 * progress doesn't read as broken). Derived from `days` rather than trusted
 * from storage: the stored counter only ever moved on a completion, so after a
 * week away the header kept advertising the old streak over an empty strip.
 */
function currentStreak(days: string[], stored = 0): number {
  const seen = new Set(days);
  let start = 0;
  if (!seen.has(today())) {
    if (!seen.has(yesterday())) return 0;
    start = 1;
  }
  let count = 0;
  while (seen.has(shiftDateKey(-(start + count)))) count++;
  // `days` only retains the last 60 entries. If the run swallowed every one of
  // them it may reach further back than we can see, so keep the stored counter
  // when it's longer — otherwise a 90-day streak would visibly reset to 60.
  return count >= seen.size ? Math.max(count, stored) : count;
}

export function useStreak() {
  const [s, setS] = useState<Streak>({ days: [], current: 0, best: 0 });

  useEffect(() => {
    const load = () => {
      const stored = loadJSON<Streak>(STORAGE_KEYS.streak, { days: [], current: 0, best: 0 });
      const current = currentStreak(stored.days ?? [], stored.current ?? 0);
      setS({ ...stored, current, best: Math.max(stored.best ?? 0, current) });
    };
    load();
    // Re-read after cloud sync applies remote data
    window.addEventListener("ff.remote-update", load);
    return () => window.removeEventListener("ff.remote-update", load);
  }, []);

  const markToday = () => {
    // Read back from storage rather than from state: this runs from a click
    // handler that may fire twice in a tick, and storage is the source of
    // truth that both calls agree on (it's also what sync pushes).
    const stored = loadJSON<Streak>(STORAGE_KEYS.streak, { days: [], current: 0, best: 0 });
    const days = stored.days ?? [];
    if (days.includes(today())) return;
    const nextDays = [...days, today()].slice(-60);
    const current = currentStreak(nextDays, stored.current ?? 0);
    const next = { days: nextDays, current, best: Math.max(stored.best ?? 0, current) };
    saveJSON(STORAGE_KEYS.streak, next);
    setS(next);
  };

  return { streak: s, markToday };
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
