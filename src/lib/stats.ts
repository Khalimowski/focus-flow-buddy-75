// Activity counters behind the Insights screen.
//
// What this is *not*: an event log. The app already has one (lib/history.ts),
// but it's capped at 500 events, device-local, and never synced — useless for
// "how did last month go". What we keep instead is one small number per
// (day, device, metric), which stays tiny over a year and answers every
// question the Insights screen asks.
//
// Why the device dimension exists
// -------------------------------
// Sync is last-writer-wins per key (see sync.ts). For a list that's merely
// lossy; for counters it's silently wrong — a day's phone activity would be
// erased the moment the browser pushed its own count for that day. So each
// device only ever writes its own sub-record, and merging two copies takes the
// max per (day, device, metric). Counts only ever grow, so max is exact, and
// the displayed total is the sum across devices. That makes the whole log a
// grow-only counter: any two copies merge to the same result, in any order.
//
// Recording happens in **every** build, web and Android alike. The phone is
// where the app is actually used, so counters written only in the browser would
// describe almost nothing. Only the *viewing* side is web-only and premium.
import { dateKey } from "./utils";
import { STORAGE_KEYS, loadJSON, saveJSON } from "./storage";

/** Days of history kept. Beyond this the oldest days are dropped on write. */
const RETENTION_DAYS = 400;

export type StatMetric =
  // Tasks
  | "taskCreated"
  | "taskCompleted"
  | "taskDeleted"
  | "taskRescheduled"
  | "taskPostponed"
  | "taskSnoozed"
  | "taskToTodo"
  // To-Do list
  | "todoCreated"
  | "todoCompleted"
  | "todoDeleted"
  | "todoScheduled"
  // Nudges
  | "nudgeCreated"
  | "nudgeDeleted"
  | "nudgeCompleted"
  | "nudgeSnoozed";

/**
 * On-disk codes. The blob is pushed to the cloud on every change, so the keys
 * are two characters rather than the readable names used everywhere else.
 * Never renumber an existing code — old rows would be misread as another
 * metric. Retiring one just means dropping it here and ignoring it on read.
 */
const CODES: Record<StatMetric, string> = {
  taskCreated: "tc",
  taskCompleted: "td",
  taskDeleted: "tx",
  taskRescheduled: "tr",
  taskPostponed: "tp",
  taskSnoozed: "ts",
  taskToTodo: "tt",
  todoCreated: "oc",
  todoCompleted: "od",
  todoDeleted: "ox",
  todoScheduled: "os",
  nudgeCreated: "nc",
  nudgeDeleted: "nx",
  nudgeCompleted: "nd",
  nudgeSnoozed: "ns",
};

const METRICS = Object.keys(CODES) as StatMetric[];

/** metric -> count, keyed by the on-disk code. */
type Counters = Record<string, number>;
/** device id -> that device's counters for the day. */
type DayLog = Record<string, Counters>;

export type StatsLog = {
  v: 1;
  /** First day this account recorded anything — "tracking since". */
  since: string;
  days: Record<string, DayLog>;
};

export type StatTotals = Record<StatMetric, number>;

const EMPTY_LOG: StatsLog = { v: 1, since: "", days: {} };

export function emptyTotals(): StatTotals {
  const out = {} as StatTotals;
  for (const m of METRICS) out[m] = 0;
  return out;
}

/**
 * This install's id. Random and device-local — it never leaves this device
 * except as a key inside the stats blob, and it identifies the *install*, not
 * the user. A reinstall simply starts a new sub-record; the old one keeps its
 * counts, so nothing is lost.
 */
function deviceId(): string {
  const stored = loadJSON<string | null>(STORAGE_KEYS.deviceId, null);
  if (typeof stored === "string" && stored) return stored;
  const fresh = Math.random().toString(36).slice(2, 10);
  saveJSON(STORAGE_KEYS.deviceId, fresh);
  return fresh;
}

function normalize(raw: unknown): StatsLog {
  if (!raw || typeof raw !== "object") return { ...EMPTY_LOG, days: {} };
  const log = raw as Partial<StatsLog>;
  return {
    v: 1,
    since: typeof log.since === "string" ? log.since : "",
    days: log.days && typeof log.days === "object" ? (log.days as Record<string, DayLog>) : {},
  };
}

export function readStats(): StatsLog {
  return normalize(loadJSON<unknown>(STORAGE_KEYS.stats, null));
}

/** Drop days past the retention window, so the blob can't grow without bound. */
function prune(log: StatsLog): StatsLog {
  const days = Object.keys(log.days);
  if (days.length <= RETENTION_DAYS) return log;
  const keep = new Set(days.sort().slice(-RETENTION_DAYS));
  const next: Record<string, DayLog> = {};
  for (const day of days) if (keep.has(day)) next[day] = log.days[day];
  return { ...log, days: next, since: keep.size ? [...keep].sort()[0] : log.since };
}

/**
 * Count something the user just did.
 *
 * `day` defaults to today, and should be passed when the action is *about*
 * another day — ticking off yesterday's nudge belongs to yesterday, not to the
 * moment the box was clicked.
 */
export function recordStat(metric: StatMetric, count = 1, day: string = dateKey()): void {
  if (typeof window === "undefined" || count <= 0) return;
  try {
    const log = readStats();
    const id = deviceId();
    const code = CODES[metric];
    const dayLog: DayLog = { ...(log.days[day] ?? {}) };
    const counters: Counters = { ...(dayLog[id] ?? {}) };
    counters[code] = (counters[code] ?? 0) + count;
    dayLog[id] = counters;

    const next = prune({
      v: 1,
      since: log.since && log.since <= day ? log.since : day,
      days: { ...log.days, [day]: dayLog },
    });
    saveJSON(STORAGE_KEYS.stats, next);
  } catch (e) {
    // Insights are a nice-to-have; never let them break the action itself.
    console.warn("[Stats] Failed to record", metric, e);
  }
}

/** Totals for one day, summed across every device that contributed to it. */
export function totalsForDay(log: StatsLog, day: string): StatTotals {
  const out = emptyTotals();
  const dayLog = log.days[day];
  if (!dayLog) return out;
  for (const counters of Object.values(dayLog)) {
    for (const metric of METRICS) {
      out[metric] += counters[CODES[metric]] ?? 0;
    }
  }
  return out;
}

/** Totals over a run of days (inclusive of both ends). */
export function totalsForDays(log: StatsLog, days: string[]): StatTotals {
  const out = emptyTotals();
  for (const day of days) {
    const dayTotals = totalsForDay(log, day);
    for (const metric of METRICS) out[metric] += dayTotals[metric];
  }
  return out;
}

// --- Merge (used by sync.ts on every pull) ---------------------------------

function mergeLogs(a: StatsLog, b: StatsLog): StatsLog {
  const days: Record<string, DayLog> = {};
  for (const day of new Set([...Object.keys(a.days), ...Object.keys(b.days)])) {
    const left = a.days[day] ?? {};
    const right = b.days[day] ?? {};
    const merged: DayLog = {};
    for (const id of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const lc = left[id] ?? {};
      const rc = right[id] ?? {};
      const counters: Counters = {};
      for (const code of new Set([...Object.keys(lc), ...Object.keys(rc)])) {
        // Counters only ever grow, so the higher number is the newer one.
        counters[code] = Math.max(lc[code] ?? 0, rc[code] ?? 0);
      }
      merged[id] = counters;
    }
    days[day] = merged;
  }
  const since = [a.since, b.since].filter(Boolean).sort()[0] ?? "";
  return prune({ v: 1, since, days });
}

/** Deep numeric equality — used to decide whether a merge needs pushing back. */
function logsEqual(a: StatsLog, b: StatsLog): boolean {
  if (a.since !== b.since) return false;
  const days = new Set([...Object.keys(a.days), ...Object.keys(b.days)]);
  for (const day of days) {
    const left = a.days[day] ?? {};
    const right = b.days[day] ?? {};
    for (const id of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const lc = left[id] ?? {};
      const rc = right[id] ?? {};
      for (const code of new Set([...Object.keys(lc), ...Object.keys(rc)])) {
        if ((lc[code] ?? 0) !== (rc[code] ?? 0)) return false;
      }
    }
  }
  return true;
}

/**
 * Fold a pulled row into what this device already has.
 *
 * Returns the merged log plus whether it says more than the remote row did —
 * sync uses that to decide if the merge has to go back up. Both flags settle
 * after one round trip, so this can't oscillate.
 */
export function mergeRemoteStats(remoteValue: unknown): {
  merged: StatsLog;
  changedLocal: boolean;
  changedRemote: boolean;
} {
  const remote = normalize(remoteValue);
  const local = readStats();
  const merged = mergeLogs(local, remote);
  return {
    merged,
    changedLocal: !logsEqual(merged, local),
    changedRemote: !logsEqual(merged, remote),
  };
}
