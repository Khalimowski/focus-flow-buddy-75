/**
 * Habit scheduling helpers.
 *
 * A habit fires at a set of "HH:mm" times. `days` narrows that to particular
 * weekdays — JS `getDay()` numbering, 0 = Sunday … 6 = Saturday — so "Gym,
 * Monday 18:00" is `{ times: ["18:00"], days: [1] }`. Undefined or empty means
 * every day, which is what every habit created before `days` existed is; that
 * equivalence is why nothing has to be migrated.
 */

export type HabitSchedule = { id: string; times: string[]; days?: number[] };

/** Monday-first order, for anything the user looks at. */
export const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 0] as const;

/** Translation keys for the short day names, indexed by JS weekday. */
export const DAY_KEYS = [
  "day_sun",
  "day_mon",
  "day_tue",
  "day_wed",
  "day_thu",
  "day_fri",
  "day_sat",
] as const;

/**
 * Sorted, de-duplicated selection — or undefined when the habit runs daily.
 * "None selected" and "all seven selected" both mean daily, so the two ways a
 * user can express it collapse to the one representation the rest of the code
 * checks.
 */
export function normalizeDays(days?: number[]): number[] | undefined {
  if (!days) return undefined;
  const set = new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6));
  if (set.size === 0 || set.size === 7) return undefined;
  return [...set].sort((a, b) => a - b);
}

export function isEveryDay(days?: number[]): boolean {
  return normalizeDays(days) === undefined;
}

/** Does this habit belong on the given date at all? */
export function runsOn(days: number[] | undefined, date: Date): boolean {
  const norm = normalizeDays(days);
  return !norm || norm.includes(date.getDay());
}

/**
 * The next moment an "HH:mm" slot of this habit comes round, today included as
 * long as the time hasn't passed yet. Used for the calendar copies, which are
 * one-shot events anchored to a real date.
 */
export function nextOccurrence(
  days: number[] | undefined,
  hour: number,
  minute: number,
  from: Date = new Date(),
): Date {
  const at = new Date(from);
  at.setHours(hour, minute, 0, 0);
  if (at.getTime() < from.getTime()) at.setDate(at.getDate() + 1);
  const norm = normalizeDays(days);
  if (!norm) return at;
  for (let i = 0; i < 7 && !norm.includes(at.getDay()); i++) {
    at.setDate(at.getDate() + 1);
  }
  return at;
}

export type HabitSlot = {
  /** Hashed into the notification id — see the id conventions in native.ts. */
  key: string;
  time: string;
  hour: number;
  minute: number;
  /** JS weekday, or undefined for a slot that repeats every day. */
  weekday?: number;
};

/**
 * Every notification slot a habit needs.
 *
 * Daily habits keep the historic `rem:<id>:<idx>` key — notifications scheduled
 * by older builds are still pending on users' phones and are matched on it.
 * A weekday habit can't be one repeating notification (Android matches a single
 * weekday), so it gets one per selected day and its keys carry that day.
 */
export function habitSlots(habit: HabitSchedule): HabitSlot[] {
  const days = normalizeDays(habit.days);
  const slots: HabitSlot[] = [];
  habit.times.forEach((time, idx) => {
    const [hour, minute] = time.split(":").map(Number);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return;
    if (!days) {
      slots.push({ key: `rem:${habit.id}:${idx}`, time, hour, minute });
      return;
    }
    for (const weekday of days) {
      slots.push({ key: `rem:${habit.id}:${idx}:${weekday}`, time, hour, minute, weekday });
    }
  });
  return slots;
}
