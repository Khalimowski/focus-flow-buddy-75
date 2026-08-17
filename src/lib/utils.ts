import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * A calendar day key ("YYYY-MM-DD") in the **device's local** timezone.
 *
 * The whole app keys days locally (task dueDate, the day strip, habit ticks in
 * the task list), so anything that stores or compares a day must use this.
 * `toISOString().slice(0,10)` is the UTC day and drifts by one for most of the
 * world — east of UTC after midnight, west of UTC in the evening — which made
 * habits re-fire and streaks land on the wrong day.
 */
export function dateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Local day key `days` days away from `from` (negative goes back). */
export function shiftDateKey(days: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

export function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older environments
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15) +
    Date.now().toString(36)
  );
}
