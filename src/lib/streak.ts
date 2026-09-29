// The daily streak: a day counts when at least one task, to-do or habit was
// ticked off on it, and banked freezes cover the odd missed day.
//
// Lives outside the component because it's written from several places — the
// task list, the to-do list, habit ticks, the notification's "Done" action and
// the home-screen widget — and the last two run with no React tree to call into.
import { loadJSON, saveJSON, STORAGE_KEYS } from "./storage";
import { dateKey, shiftDateKey } from "./utils";

/** Freezes bank up to this many. */
export const MAX_FREEZES = 2;
/** One freeze is earned each time the run reaches a multiple of this. */
export const FREEZE_EVERY = 7;
/** Entries kept in `days` and `frozen`. */
const KEEP = 60;

export type Streak = {
  /** Days something was actually completed. */
  days: string[];
  current: number;
  best: number;
  /** Freezes in the bank. */
  freezes?: number;
  /** Missed days a freeze covered. They hold the chain together but don't add to it. */
  frozen?: string[];
  /**
   * What counted today, so unticking the last of it can take today back out.
   * `prev` is the state before today was first counted: `best` and the freezes
   * can't be recomputed on the way back (`days` keeps only 60 entries, and the
   * gap a freeze covered is gone once today is counted), so they're restored.
   */
  log?: {
    day: string;
    ids: string[];
    /** Today was already counted by a build that didn't keep this log — never un-count it. */
    locked?: boolean;
    prev: { best: number; freezes: number; frozen: string[] };
  };
};

export const STREAK_EVENT = "ff.streak_updated";

const EMPTY: Streak = { days: [], current: 0, best: 0 };

export const loadStreak = () => loadJSON<Streak>(STORAGE_KEYS.streak, EMPTY);

/**
 * Length of the unbroken chain ending today (or yesterday, so a day still in
 * progress doesn't read as broken). Frozen days keep the chain going but only
 * real days count. Derived from the day lists rather than trusted from storage:
 * the stored counter only ever moved on a completion, so after a week away the
 * header kept advertising the old streak over an empty strip.
 */
function run(days: string[], frozen: string[], stored: number): number {
  const real = new Set(days);
  const chain = new Set([...days, ...frozen]);
  if (chain.size === 0) return 0;
  let i = chain.has(dateKey()) ? 0 : 1;
  const oldest = [...chain].sort()[0];
  let count = 0;
  let reachedOldest = false;
  for (let d = shiftDateKey(-i); chain.has(d); d = shiftDateKey(-++i)) {
    if (real.has(d)) count++;
    if (d === oldest) reachedOldest = true;
  }
  // Only the last 60 entries are kept. If the chain swallowed every one of them
  // it may reach further back than we can see, so keep the stored counter when
  // it's longer — otherwise a 90-day streak would visibly reset to 60.
  return reachedOldest ? Math.max(count, stored) : count;
}

/** Days after the last kept or frozen day, up to yesterday, oldest first. */
function missedDays(days: string[], frozen: string[]): string[] {
  const all = [...days, ...frozen].sort();
  const last = all[all.length - 1];
  if (!last) return [];
  const out: string[] = [];
  for (let i = 1; i <= 400; i++) {
    const d = shiftDateKey(-i);
    if (d <= last) break;
    out.unshift(d);
  }
  return out;
}

/**
 * The streak as it stands now, with freezes already spent on any missed days
 * they can cover. Pure: loading never writes, because a device that hasn't
 * pulled yet would spend freezes over days another device kept and then push
 * that over the cloud copy. The spend is persisted by the next `markToday`.
 * A gap longer than the bank breaks the streak and spends nothing.
 */
export function resolveStreak(s: Streak): Streak {
  const days = s.days ?? [];
  let frozen = s.frozen ?? [];
  let freezes = s.freezes ?? 0;
  const gap = missedDays(days, frozen);
  if (gap.length > 0 && gap.length <= freezes) {
    frozen = [...frozen, ...gap].slice(-KEEP);
    freezes -= gap.length;
  }
  const current = run(days, frozen, s.current ?? 0);
  return { ...s, days, frozen, freezes, current, best: Math.max(s.best ?? 0, current) };
}

function save(next: Streak) {
  saveJSON(STORAGE_KEYS.streak, next);
  window.dispatchEvent(new CustomEvent(STREAK_EVENT));
  return next;
}

/**
 * Count today for the completion `id` (`task:…`, `todo:…`, `habit:…:HH:mm`).
 * Idempotent per id.
 */
export function markToday(id: string): Streak {
  // Read back from storage rather than from state: this can fire twice in a
  // tick, and storage is the source of truth both calls agree on (it's also
  // what sync pushes).
  const raw = loadStreak();
  const today = dateKey();
  const counted = (raw.days ?? []).includes(today);
  const log =
    raw.log?.day === today
      ? raw.log
      : {
          day: today,
          ids: [],
          locked: counted,
          prev: { best: raw.best ?? 0, freezes: raw.freezes ?? 0, frozen: raw.frozen ?? [] },
        };
  if (counted && log.ids.includes(id)) return raw;
  const nextLog = { ...log, ids: [...log.ids.filter((x) => x !== id), id] };
  if (counted) return save({ ...raw, log: nextLog });

  const r = resolveStreak(raw); // spends freezes on the gap, if they cover it
  const days = [...r.days, today].slice(-KEEP);
  const current = run(days, r.frozen ?? [], r.current > 0 ? r.current + 1 : 0);
  let freezes = r.freezes ?? 0;
  if (current % FREEZE_EVERY === 0) freezes = Math.min(MAX_FREEZES, freezes + 1);
  return save({
    days,
    current,
    best: Math.max(r.best, current),
    freezes,
    frozen: r.frozen,
    log: nextLog,
  });
}

/**
 * Take back the completion `id`. When it was the last thing counted today,
 * today comes off the streak and the record and freezes go back to how they
 * were. Only today: a day already earned doesn't un-happen because a task
 * ticked then is reopened now.
 */
export function unmarkToday(id: string): Streak {
  const raw = loadStreak();
  const log = raw.log;
  if (!log || log.day !== dateKey() || !log.ids.includes(id)) return raw;
  const nextLog = { ...log, ids: log.ids.filter((x) => x !== id) };
  if (nextLog.ids.length > 0 || log.locked) return save({ ...raw, log: nextLog });

  const base: Streak = {
    ...raw,
    days: (raw.days ?? []).filter((d) => d !== log.day),
    freezes: log.prev.freezes,
    frozen: log.prev.frozen,
    log: nextLog,
  };
  // `current - 1` carries a chain older than the 60 visible days.
  const { current } = resolveStreak({ ...base, current: Math.max(0, (raw.current ?? 0) - 1) });
  return save({ ...base, current, best: Math.max(log.prev.best, current) });
}

/** Mark or unmark in one call, for toggles. */
export function setDoneToday(id: string, done: boolean): Streak {
  return done ? markToday(id) : unmarkToday(id);
}
