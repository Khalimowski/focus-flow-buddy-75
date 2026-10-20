// Per-habit tick history behind the Insights "Habits" consistency card.
//
// The habit list itself can't answer "how often did I keep this one": each
// slot's `lastFired` holds only the most recent day it was ticked, and the
// stats counter in lib/stats.ts is one daily total shared by every habit. So
// each tick is also logged here, as a count of slots done per (habit, day).
//
// Unlike the stats counters this is not grow-only — unticking takes the slot
// back out — so merging two devices' copies can't take the max. Each cell
// carries the time it was last written instead, and the newer cell wins.
// That's last-writer-wins per (habit, day), which only loses anything if two
// devices change the same habit on the same day between syncs.
//
// History starts when this shipped; there's nothing older to backfill from.
import { STORAGE_KEYS, loadJSON, saveJSON } from "./storage";
import { dateKey } from "./utils";
import { runsOn } from "./habits";

/** Days of history kept, matching the stats counters. */
const RETENTION_DAYS = 400;

/** [slots done that day, when this cell was last written (ms)]. */
type Cell = [number, number];

export type HabitLog = {
  v: 1;
  /** First day anything was logged; "" when nothing has been yet. */
  since: string;
  /** habit id -> day -> cell. */
  h: Record<string, Record<string, Cell>>;
};

const EMPTY: HabitLog = { v: 1, since: "", h: {} };

function isCell(value: unknown): value is Cell {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  );
}

function normalize(raw: unknown): HabitLog {
  if (!raw || typeof raw !== "object") return { ...EMPTY, h: {} };
  const log = raw as Partial<HabitLog>;
  const h: HabitLog["h"] = {};
  if (log.h && typeof log.h === "object") {
    for (const [id, days] of Object.entries(log.h)) {
      if (!days || typeof days !== "object") continue;
      const clean: Record<string, Cell> = {};
      for (const [day, cell] of Object.entries(days)) if (isCell(cell)) clean[day] = cell;
      h[id] = clean;
    }
  }
  return { v: 1, since: typeof log.since === "string" ? log.since : "", h };
}

export function readHabitLog(): HabitLog {
  return normalize(loadJSON<unknown>(STORAGE_KEYS.habitLog, null));
}

/** Drop days past the retention window, so the blob can't grow without bound. */
function prune(log: HabitLog, today: string = dateKey()): HabitLog {
  const cutoff = new Date(`${today}T00:00:00`);
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const oldest = dateKey(cutoff);
  const h: HabitLog["h"] = {};
  for (const [id, days] of Object.entries(log.h)) {
    const kept: Record<string, Cell> = {};
    for (const [day, cell] of Object.entries(days)) if (day >= oldest) kept[day] = cell;
    if (Object.keys(kept).length > 0) h[id] = kept;
  }
  return { ...log, since: log.since && log.since < oldest ? oldest : log.since, h };
}

/**
 * Log one slot of a habit being ticked (`+1`) or unticked (`-1`) on `day`.
 *
 * `slots` is how many times the habit fires a day; the count is held inside
 * 0…slots so a double tick from two paths can't push a day past "all done".
 */
export function recordHabitTick(habitId: string, day: string, delta: 1 | -1, slots: number): void {
  if (typeof window === "undefined" || !habitId) return;
  try {
    const log = readHabitLog();
    const days = { ...(log.h[habitId] ?? {}) };
    const before = days[day]?.[0] ?? 0;
    const after = Math.max(0, Math.min(Math.max(slots, 1), before + delta));
    if (after === before && days[day]) return;
    days[day] = [after, Date.now()];
    const next = prune({
      v: 1,
      since: log.since && log.since <= day ? log.since : day,
      h: { ...log.h, [habitId]: days },
    });
    saveJSON(STORAGE_KEYS.habitLog, next);
  } catch (e) {
    // Insights are a nice-to-have; never let them break the tick itself.
    console.warn("[HabitLog] Failed to record", habitId, e);
  }
}

// --- Merge (used by sync.ts on every pull) ---------------------------------

function mergeLogs(a: HabitLog, b: HabitLog): HabitLog {
  const h: HabitLog["h"] = {};
  for (const id of new Set([...Object.keys(a.h), ...Object.keys(b.h)])) {
    const left = a.h[id] ?? {};
    const right = b.h[id] ?? {};
    const days: Record<string, Cell> = {};
    for (const day of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const l = left[day];
      const r = right[day];
      // Newer write wins; on a tie the higher count, so both sides pick the same.
      if (!l) days[day] = r;
      else if (!r) days[day] = l;
      else if (l[1] !== r[1]) days[day] = l[1] > r[1] ? l : r;
      else days[day] = l[0] >= r[0] ? l : r;
    }
    h[id] = days;
  }
  const since = [a.since, b.since].filter(Boolean).sort()[0] ?? "";
  return prune({ v: 1, since, h });
}

function logsEqual(a: HabitLog, b: HabitLog): boolean {
  if (a.since !== b.since) return false;
  for (const id of new Set([...Object.keys(a.h), ...Object.keys(b.h)])) {
    const left = a.h[id] ?? {};
    const right = b.h[id] ?? {};
    for (const day of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const l = left[day];
      const r = right[day];
      if (!l || !r || l[0] !== r[0] || l[1] !== r[1]) return false;
    }
  }
  return true;
}

/** Fold a pulled row into what this device has. Same contract as mergeRemoteStats. */
export function mergeRemoteHabitLog(remoteValue: unknown): {
  merged: HabitLog;
  changedLocal: boolean;
  changedRemote: boolean;
} {
  const remote = normalize(remoteValue);
  const local = readHabitLog();
  const merged = mergeLogs(local, remote);
  return {
    merged,
    changedLocal: !logsEqual(merged, local),
    changedRemote: !logsEqual(merged, remote),
  };
}

// --- Reading ----------------------------------------------------------------

export type HabitDay = {
  day: string;
  /** "full" = every slot ticked, "partial" = some, "missed" = none, "today" = none yet. */
  state: "full" | "partial" | "missed" | "today";
};

export type HabitConsistency = {
  id: string;
  label: string;
  /** Slots ticked / slots scheduled over the window, as a percentage. */
  rate: number;
  /** Days in the window the habit was due (and was being logged). */
  scheduledDays: number;
  /** Consecutive fully kept due days, ending today (or yesterday while today is open). */
  currentRun: number;
  /** Longest such run anywhere in the logged history. */
  bestRun: number;
  /** One entry per due day in the window, oldest first. */
  days: HabitDay[];
};

type Reminder = { id: string; label: string; times: string[]; enabled: boolean; days?: number[] };

/**
 * Consistency for each enabled habit over the last `windowDays` days.
 *
 * Only days since logging began are judged — a habit isn't "missed" on days
 * before the app could see it being ticked. Days the habit doesn't run on are
 * skipped entirely rather than counted as misses, so a Monday-only habit kept
 * every Monday reads 100%.
 */
export function habitConsistency(windowDays = 30, now: Date = new Date()): HabitConsistency[] {
  const reminders = loadJSON<Reminder[]>(STORAGE_KEYS.reminders, []);
  const log = readHabitLog();
  if (!log.since) return [];
  const todayKey = dateKey(now);

  const out: HabitConsistency[] = [];
  for (const habit of reminders) {
    if (!habit.enabled || habit.times.length === 0) continue;
    const slots = habit.times.length;
    const cells = log.h[habit.id] ?? {};

    // Walk from the first logged day to today once; the window is the tail.
    const start = new Date(`${log.since}T00:00:00`);
    const windowStart = new Date(now);
    windowStart.setHours(0, 0, 0, 0);
    windowStart.setDate(windowStart.getDate() - (windowDays - 1));

    let bestRun = 0;
    let run = 0;
    let done = 0;
    let due = 0;
    const days: HabitDay[] = [];
    for (let d = new Date(start); dateKey(d) <= todayKey; d.setDate(d.getDate() + 1)) {
      if (!runsOn(habit.days, d)) continue;
      const key = dateKey(d);
      const count = Math.min(cells[key]?.[0] ?? 0, slots);
      const isToday = key === todayKey;

      if (count >= slots) {
        run++;
        bestRun = Math.max(bestRun, run);
      } else if (!isToday) {
        run = 0;
      }

      if (d >= windowStart) {
        // Today counts once something is ticked; an untouched today isn't a miss yet.
        if (!isToday || count > 0) {
          due++;
          done += count;
        }
        days.push({
          day: key,
          state: count >= slots ? "full" : count > 0 ? "partial" : isToday ? "today" : "missed",
        });
      }
    }

    out.push({
      id: habit.id,
      label: habit.label,
      rate: due > 0 ? Math.round((done / (due * slots)) * 100) : 0,
      scheduledDays: due,
      currentRun: run,
      bestRun,
      days,
    });
  }
  return out.sort((a, b) => b.rate - a.rate || b.currentRun - a.currentRun);
}
