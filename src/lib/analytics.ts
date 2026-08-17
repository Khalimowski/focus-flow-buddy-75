// Turns the app's own storage into the numbers the Insights screen draws.
//
// It reads from two very different sources, and the difference matters:
//
//  - **The task list itself.** Completed tasks stay in storage, each with a due
//    date, so "what did I plan for that day, and how much of it got done" is
//    answerable for the app's whole history — including every day before
//    Insights existed. This is the headline metric.
//  - **The counters in lib/stats.ts.** Rescheduling, postponing and deleting
//    leave no trace in the task list (the task moves, or is simply gone), and
//    to-dos and habits carry no completion date at all. Those can only be
//    counted as they happen, so they start from the day tracking began, which
//    is why `trackingSince` is reported alongside them.
//
// Nothing here writes; it's pure derivation over what's already stored.
import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { STORAGE_KEYS, loadJSON } from "./storage";
import { dateKey } from "./utils";
import { emptyTotals, readStats, totalsForDays, type StatTotals } from "./stats";

export type Granularity = "day" | "week" | "month";

/** How far back each view looks. */
export const BUCKET_COUNT: Record<Granularity, number> = {
  day: 14,
  week: 12,
  month: 12,
};

type Task = {
  id: string;
  title: string;
  done: boolean;
  remindAt: string | null;
  dueDate: string;
  createdAt: number;
};

type ToDoItem = { id: string; title: string; done: boolean; createdAt: number };

type Reminder = { id: string; label: string; times: string[]; enabled: boolean };

export type InsightBucket = {
  /** Stable identity: the first day in the bucket. */
  key: string;
  start: Date;
  /** Inclusive. May be in the future for the bucket containing today. */
  end: Date;
  days: string[];
  /** Tasks whose due date falls here. */
  planned: number;
  /** …of which these are ticked off. */
  completed: number;
  /** …and these are still open on a day that has already passed. */
  missed: number;
  stats: StatTotals;
};

export type WeekdayStat = {
  /** 0 = Monday. */
  weekday: number;
  planned: number;
  completed: number;
};

export type Insights = {
  granularity: Granularity;
  /** Oldest first — chart order. */
  buckets: InsightBucket[];
  current: InsightBucket;
  previous: InsightBucket | null;
  /** Every task ever, by due date. */
  lifetime: { planned: number; completed: number; missed: number };
  /** Completion by day of week over the range on screen. Monday first. */
  weekdays: WeekdayStat[];
  /** Counters over the whole visible range. */
  rangeStats: StatTotals;
  /** First day anything was counted; "" when nothing has been yet. */
  trackingSince: string;
  todos: { open: number; done: number };
  /** Enabled habit times per day — what a "full" habit day would be. */
  habitSlots: number;
};

/** Percentage, rounded, with 0/0 reading as 0 rather than NaN. */
export function rate(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((done / total) * 100);
}

function bucketBounds(granularity: Granularity, offset: number, today: Date): [Date, Date] {
  if (granularity === "day") {
    const day = startOfDay(addDays(today, offset));
    return [day, day];
  }
  if (granularity === "week") {
    const start = startOfWeek(addWeeks(today, offset), { weekStartsOn: 1 });
    return [start, endOfWeek(start, { weekStartsOn: 1 })];
  }
  const start = startOfMonth(addMonths(today, offset));
  return [start, endOfMonth(start)];
}

function daysBetween(start: Date, end: Date): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(dateKey(d));
  return out;
}

/**
 * Build the whole Insights model for one granularity.
 *
 * `now` is injectable so the caller can pin a moment; everything is keyed in
 * the device's local timezone, matching the rest of the app (see dateKey).
 */
export function buildInsights(granularity: Granularity, now: Date = new Date()): Insights {
  const tasks = loadJSON<Task[]>(STORAGE_KEYS.tasks, []);
  const todos = loadJSON<ToDoItem[]>(STORAGE_KEYS.todo, []);
  const reminders = loadJSON<Reminder[]>(STORAGE_KEYS.reminders, []);
  const log = readStats();

  const today = startOfDay(now);
  const todayKey = dateKey(today);
  const count = BUCKET_COUNT[granularity];

  const buckets: InsightBucket[] = [];
  // Which bucket a given day belongs to, so the task list is walked once.
  const dayToBucket = new Map<string, number>();

  for (let i = count - 1; i >= 0; i--) {
    const [start, end] = bucketBounds(granularity, -i, today);
    const days = daysBetween(start, end);
    const index = buckets.length;
    for (const day of days) dayToBucket.set(day, index);
    buckets.push({
      key: dateKey(start),
      start,
      end,
      days,
      planned: 0,
      completed: 0,
      missed: 0,
      stats: emptyTotals(),
    });
  }

  const lifetime = { planned: 0, completed: 0, missed: 0 };
  const weekdays: WeekdayStat[] = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    planned: 0,
    completed: 0,
  }));

  for (const task of tasks) {
    // Tasks written before dueDate existed fall back to their creation day,
    // the same way TaskList migrates them on load.
    const due = task.dueDate || dateKey(new Date(task.createdAt || Date.now()));
    const overdue = !task.done && due < todayKey;

    lifetime.planned++;
    if (task.done) lifetime.completed++;
    else if (overdue) lifetime.missed++;

    const index = dayToBucket.get(due);
    if (index === undefined) continue;

    const bucket = buckets[index];
    bucket.planned++;
    if (task.done) bucket.completed++;
    else if (overdue) bucket.missed++;

    // date-fns getDay is Sunday-first; the app's weeks start on Monday.
    const weekday = (parseISO(due).getDay() + 6) % 7;
    weekdays[weekday].planned++;
    if (task.done) weekdays[weekday].completed++;
  }

  for (const bucket of buckets) {
    bucket.stats = totalsForDays(log, bucket.days);
  }

  const rangeStats = emptyTotals();
  for (const bucket of buckets) {
    for (const metric of Object.keys(rangeStats) as (keyof StatTotals)[]) {
      rangeStats[metric] += bucket.stats[metric];
    }
  }

  return {
    granularity,
    buckets,
    current: buckets[buckets.length - 1],
    previous: buckets.length > 1 ? buckets[buckets.length - 2] : null,
    lifetime,
    weekdays,
    rangeStats,
    trackingSince: log.since,
    todos: {
      open: todos.filter((item) => !item.done).length,
      done: todos.filter((item) => item.done).length,
    },
    habitSlots: reminders.filter((r) => r.enabled).reduce((n, r) => n + r.times.length, 0),
  };
}

/**
 * How tasks ended up over the range: finished, moved to another slot, or
 * dropped. Three mutually exclusive outcomes, so they can be read as shares of
 * one whole — which is what makes "I move more than I finish" visible at all.
 */
export function outcomeSplit(stats: StatTotals) {
  const finished = stats.taskCompleted;
  const moved = stats.taskRescheduled + stats.taskPostponed + stats.taskSnoozed;
  const dropped = stats.taskDeleted;
  const total = finished + moved + dropped;
  return { finished, moved, dropped, total };
}
