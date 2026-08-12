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
  // last 14 days
  const cells = Array.from({ length: 14 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    const key = dateKey(d);
    return { key, done: streak.days.includes(key), label: d.getDate() };
  });

  return (
    <div className="rounded-2xl border bg-card/40 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            {t('streak_current')}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-4xl font-semibold">{streak.current}</span>
            <span className="text-sm text-muted-foreground">{t(streak.current === 1 ? 'day' : 'days')}</span>
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
