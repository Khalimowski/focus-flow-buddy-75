/**
 * Recurring events on a custom cycle — "every 5 weeks", "every 6 months",
 * "every year".
 *
 * Habits (lib/habits.ts) repeat *inside* a week: a set of times, optionally
 * narrowed to weekdays. That model can't express a flea-and-tick dose every
 * five weeks or a vaccination every year, which is what this file is for. The
 * two never share storage: habits stay in `ff.reminders.v1`, cycles live in
 * `ff.recurring.v1`.
 *
 * A cycle is an anchor day plus an interval, and the two modes differ only in
 * what happens once an occurrence is behind you:
 *
 * - `completion` — the anchor *is* the due day, and it only moves when you tick
 *   the event off, which re-anchors the whole cycle to that moment. A dose
 *   given three days late pushes the next one three days out, and one you
 *   ignore keeps counting up as overdue rather than quietly rolling over.
 * - `schedule` — the anchor is the phase of a fixed calendar date. It never
 *   moves: the next occurrence is computed by stepping whole cycles forward
 *   until the date is today or later, so a birthday lands on the same day next
 *   year whether or not anyone ticked anything. `lastDone` is what stops the
 *   day it's ticked from still reading "Today".
 *
 * Every day here is a **local** day key (see utils.dateKey). Local, because
 * "how many days until" is a question about the calendar on the wall, and
 * because `new Date("2026-09-05")` is parsed as UTC and lands on the wrong day
 * for most of the world.
 */
import { dateKey } from "./utils";

export type IntervalUnit = "day" | "week" | "month" | "year";

export type RecurrenceMode = "completion" | "schedule";

export type RecurringEvent = {
  id: string;
  label: string;
  /** Day key: the due day (`completion`) or the phase of the date (`schedule`). */
  anchor: string;
  /** How many `unit`s one cycle lasts. At least 1. */
  every: number;
  unit: IntervalUnit;
  /** "HH:mm" the reminder fires at on the day itself. */
  time: string;
  mode: RecurrenceMode;
  /** Off pauses the reminders; the countdown keeps running. */
  enabled: boolean;
  /** The occurrence day most recently ticked off, if any. */
  lastDone?: string;
  /**
   * The anchor as it stood before that tick, so it can be put back — a tap on
   * the wrong row of the day list must not silently move a medication date.
   * Only meaningful alongside `lastDone`; see uncompleteEvent.
   */
  previousAnchor?: string;
  /** Occurrence the in-app (browser) reminder has already fired for. */
  notifiedFor?: string;
  createdAt: number;
  /** Which quick-add preset filled the form, if any. Language-independent. */
  presetId?: string;
};

export const INTERVAL_UNITS: IntervalUnit[] = ["day", "week", "month", "year"];

/** The longest cycle anyone can set, in units. Keeps the arithmetic bounded. */
export const MAX_EVERY = 999;

const MS_PER_DAY = 86_400_000;

/** Rough length of one unit, used only to jump near the right cycle. */
const APPROX_DAYS: Record<IntervalUnit, number> = {
  day: 1,
  week: 7,
  month: 30.44,
  year: 365.25,
};

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Local midnight for a day key. Anything unparseable falls back to today. */
export function parseDayKey(day: string): Date {
  if (!DAY_KEY_RE.test(day)) return startOfToday();
  const [y, m, d] = day.split("-").map(Number);
  const at = new Date(y, m - 1, d);
  return Number.isNaN(at.getTime()) ? startOfToday() : at;
}

function startOfToday(): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

/**
 * Whole days from one day key to another — negative when `to` is in the past.
 * Rounded, so the hour a DST switch adds or removes can't turn a day into 0.9.
 */
export function diffDays(from: string, to: string): number {
  return Math.round((parseDayKey(to).getTime() - parseDayKey(from).getTime()) / MS_PER_DAY);
}

/**
 * `day` moved by `count` whole units (negative goes back).
 *
 * Month and year arithmetic clamps to the end of the month — 31 January plus a
 * month is 28 February — and always counts from the original day, so the 31st
 * is back on the 31st in March instead of drifting to the 28th forever.
 */
export function addInterval(day: string, count: number, unit: IntervalUnit): string {
  const at = parseDayKey(day);
  if (unit === "day" || unit === "week") {
    at.setDate(at.getDate() + count * (unit === "week" ? 7 : 1));
    return dateKey(at);
  }
  const months = unit === "year" ? count * 12 : count;
  const target = new Date(at.getFullYear(), at.getMonth() + months, 1);
  const lastOfMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(at.getDate(), lastOfMonth));
  return dateKey(target);
}

/** The day `k` whole cycles after the anchor. */
function cycleDay(ev: RecurringEvent, k: number): string {
  return addInterval(ev.anchor, ev.every * k, ev.unit);
}

/** Smallest `k` whose cycle day is `until` or later. */
function cyclesUntil(ev: RecurringEvent, until: string): number {
  const gap = diffDays(ev.anchor, until);
  if (gap <= 0) return 0;
  const span = Math.max(1, ev.every * APPROX_DAYS[ev.unit]);
  // The estimate lands within a cycle or two even where the clamping above
  // shortens a month; the guards are there so corrupt data can't spin.
  let k = Math.max(0, Math.floor(gap / span));
  let guard = 0;
  while (cycleDay(ev, k) < until && guard++ < 64) k++;
  while (k > 0 && cycleDay(ev, k - 1) >= until && guard++ < 128) k--;
  return k;
}

/** The day this event is next due — in the past when it's overdue. */
export function occurrenceDay(ev: RecurringEvent, today: string = dateKey()): string {
  // `completion`: the anchor is the due day and only a tick moves it, so an
  // ignored dose stays overdue instead of rolling over on its own.
  if (ev.mode === "completion") return ev.anchor;
  const k = cyclesUntil(ev, today);
  const day = cycleDay(ev, k);
  // Ticked off today (or ticked early): show the cycle after it, not this one.
  return ev.lastDone === day ? cycleDay(ev, k + 1) : day;
}

/** One cycle before the next occurrence — where the countdown started. */
export function previousOccurrenceDay(ev: RecurringEvent, today: string = dateKey()): string {
  return addInterval(occurrenceDay(ev, today), -ev.every, ev.unit);
}

/** The moment the reminder is due: the occurrence day at the event's time. */
export function occurrenceAt(ev: RecurringEvent, today: string = dateKey()): Date {
  const at = parseDayKey(occurrenceDay(ev, today));
  const [hour, minute] = (TIME_RE.test(ev.time) ? ev.time : "09:00").split(":").map(Number);
  at.setHours(hour, minute, 0, 0);
  return at;
}

/** Days until the next occurrence. 0 is today, negative is overdue. */
export function daysLeft(ev: RecurringEvent, today: string = dateKey()): number {
  return diffDays(today, occurrenceDay(ev, today));
}

/** How far through the current cycle we are, 0–1. For the progress bar. */
export function cycleProgress(ev: RecurringEvent, today: string = dateKey()): number {
  const next = occurrenceDay(ev, today);
  const previous = addInterval(next, -ev.every, ev.unit);
  const total = diffDays(previous, next);
  if (total <= 0) return 1;
  const gone = diffDays(previous, today);
  return Math.min(1, Math.max(0, gone / total));
}

/**
 * Tick an occurrence off and move to the next one.
 *
 * In `completion` mode the day it was actually done becomes the new anchor —
 * that's the point of the mode. In `schedule` mode the anchor is the fixed
 * date's phase and must not move, so only the tick is recorded.
 */
export function completeEvent(ev: RecurringEvent, on: string = dateKey()): RecurringEvent {
  const { notifiedFor: _drop, ...rest } = ev;
  if (ev.mode === "completion") {
    return {
      ...rest,
      anchor: addInterval(on, ev.every, ev.unit),
      lastDone: on,
      previousAnchor: ev.anchor,
    };
  }
  return { ...rest, lastDone: occurrenceDay(ev, on), previousAnchor: ev.anchor };
}

/** Undo the most recent tick, putting the cycle back where it was. */
export function uncompleteEvent(ev: RecurringEvent): RecurringEvent {
  const { lastDone: _wasDone, previousAnchor, notifiedFor: _drop, ...rest } = ev;
  return { ...rest, anchor: previousAnchor ?? ev.anchor };
}

/** Was this event ticked off on `day`? */
export function wasDoneOn(ev: RecurringEvent, day: string): boolean {
  return ev.lastDone === day;
}

/**
 * Does this event belong on the day list for `day`?
 *
 * Its own occurrence, obviously; the day it was ticked off, so a tick doesn't
 * make the row vanish out from under the finger that made it; and, on today
 * only, anything already overdue — an overdue dose that stayed behind on the
 * day it was due would be a reminder nobody ever sees again.
 */
export function showsOnDay(ev: RecurringEvent, day: string, today: string = dateKey()): boolean {
  if (!ev.enabled) return false;
  if (wasDoneOn(ev, day)) return true;
  const due = occurrenceDay(ev, today);
  if (due === day) return true;
  return day === today && due < today;
}

/**
 * Notification id source for one occurrence — see the id conventions in
 * native.ts. The day and time are part of it on purpose: rescheduling an event
 * changes the key, so the reconcile pass cancels the notification armed for the
 * old moment instead of leaving a second one behind.
 */
export function notifKey(ev: RecurringEvent, day: string = occurrenceDay(ev)): string {
  return `cycle:${ev.id}:${day}:${ev.time}`;
}

/** Whole numbers only, at least one cycle, and never long enough to overflow. */
export function sanitizeEvery(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_EVERY, Math.max(1, Math.floor(value)));
}

/**
 * A stored event, or null if it isn't one.
 *
 * Cycles sync (SYNC_KEYS in sync.ts), so this blob can arrive from a build
 * older or newer than this one; every read goes through here rather than
 * trusting the shape and rendering `Invalid Date`.
 */
export function normalizeEvent(raw: unknown): RecurringEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const ev = raw as Partial<RecurringEvent>;
  if (typeof ev.id !== "string" || !ev.id) return null;
  if (typeof ev.label !== "string" || !ev.label.trim()) return null;
  const unit = INTERVAL_UNITS.includes(ev.unit as IntervalUnit)
    ? (ev.unit as IntervalUnit)
    : "week";
  return {
    id: ev.id,
    label: ev.label.trim(),
    anchor: typeof ev.anchor === "string" && DAY_KEY_RE.test(ev.anchor) ? ev.anchor : dateKey(),
    every: sanitizeEvery(Number(ev.every)),
    unit,
    time: typeof ev.time === "string" && TIME_RE.test(ev.time) ? ev.time : "09:00",
    mode: ev.mode === "schedule" ? "schedule" : "completion",
    enabled: ev.enabled !== false,
    ...(typeof ev.lastDone === "string" && DAY_KEY_RE.test(ev.lastDone)
      ? { lastDone: ev.lastDone }
      : {}),
    ...(typeof ev.previousAnchor === "string" && DAY_KEY_RE.test(ev.previousAnchor)
      ? { previousAnchor: ev.previousAnchor }
      : {}),
    ...(typeof ev.notifiedFor === "string" && DAY_KEY_RE.test(ev.notifiedFor)
      ? { notifiedFor: ev.notifiedFor }
      : {}),
    createdAt: typeof ev.createdAt === "number" ? ev.createdAt : Date.now(),
    ...(typeof ev.presetId === "string" ? { presetId: ev.presetId } : {}),
  };
}

export function normalizeEvents(raw: unknown): RecurringEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeEvent).filter((ev): ev is RecurringEvent => ev !== null);
}

/** Soonest first — overdue at the very top, paused events after the rest. */
export function sortEvents(list: RecurringEvent[], today: string = dateKey()): RecurringEvent[] {
  return [...list].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    const left = daysLeft(a, today) - daysLeft(b, today);
    if (left !== 0) return left;
    return a.createdAt - b.createdAt;
  });
}
