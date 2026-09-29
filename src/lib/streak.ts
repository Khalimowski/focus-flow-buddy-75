// The daily streak: which days had at least one completed task.
//
// Lives outside the component because it's written from three places — the
// task list, the notification's "Done" action and the home-screen widget — and
// the last two run with no React tree to call into.
import { loadJSON, saveJSON, STORAGE_KEYS } from "./storage";
import { dateKey, shiftDateKey } from "./utils";

export type Streak = {
  days: string[];
  current: number;
  best: number;
  /**
   * `best` as it stood before `bestDay` was marked. Unticking that day's last
   * task has to put the record back too, and it can't be recomputed: `days`
   * keeps only 60 entries, so an older, longer run is invisible from here.
   */
  bestBefore?: number;
  bestDay?: string;
};

export const STREAK_EVENT = "ff.streak_updated";

const EMPTY: Streak = { days: [], current: 0, best: 0 };

export const loadStreak = () => loadJSON<Streak>(STORAGE_KEYS.streak, EMPTY);

/**
 * Length of the unbroken run ending today (or yesterday, so a day still in
 * progress doesn't read as broken). Derived from `days` rather than trusted
 * from storage: the stored counter only ever moved on a completion, so after a
 * week away the header kept advertising the old streak over an empty strip.
 */
export function currentStreak(days: string[], stored = 0): number {
  const seen = new Set(days);
  let start = 0;
  if (!seen.has(dateKey())) {
    if (!seen.has(shiftDateKey(-1))) return 0;
    start = 1;
  }
  let count = 0;
  while (seen.has(shiftDateKey(-(start + count)))) count++;
  // `days` only retains the last 60 entries. If the run swallowed every one of
  // them it may reach further back than we can see, so keep the stored counter
  // when it's longer — otherwise a 90-day streak would visibly reset to 60.
  return count >= seen.size ? Math.max(count, stored) : count;
}

function save(next: Streak) {
  saveJSON(STORAGE_KEYS.streak, next);
  window.dispatchEvent(new CustomEvent(STREAK_EVENT));
  return next;
}

/** Count today. Idempotent — ticking a second task is a no-op. */
export function markToday(): Streak {
  // Read back from storage rather than from state: this can fire twice in a
  // tick, and storage is the source of truth both calls agree on (it's also
  // what sync pushes).
  const stored = loadStreak();
  const days = stored.days ?? [];
  const today = dateKey();
  if (days.includes(today)) return stored;
  const nextDays = [...days, today].slice(-60);
  const current = currentStreak(nextDays, stored.current ?? 0);
  const best = stored.best ?? 0;
  return save({
    days: nextDays,
    current,
    best: Math.max(best, current),
    bestBefore: best,
    bestDay: today,
  });
}

/**
 * Take today back out — called when the last task completed today is unticked.
 * Only today: yesterday's run was earned yesterday, and a task ticked then and
 * reopened now doesn't un-happen.
 */
export function unmarkToday(): Streak {
  const stored = loadStreak();
  const today = dateKey();
  const days = stored.days ?? [];
  if (!days.includes(today)) return stored;
  const nextDays = days.filter((d) => d !== today);
  // A run ending yesterday still counts, so this usually drops by exactly one.
  // `stored.current - 1` carries a run older than the 60 visible days.
  const current = currentStreak(nextDays, Math.max(0, (stored.current ?? 0) - 1));
  const best =
    stored.bestDay === today && typeof stored.bestBefore === "number"
      ? Math.max(stored.bestBefore, current)
      : (stored.best ?? 0);
  return save({ days: nextDays, current, best });
}
