// Shared shape + loader for the daily nudges stored under STORAGE_KEYS.reminders.
import { loadJSON, STORAGE_KEYS } from "@/lib/storage";

export type Reminder = {
  id: string;
  label: string;
  times: string[]; // "HH:mm"
  enabled: boolean;
  lastFired: Record<string, string>; // time -> YYYY-MM-DD (local day)
  // Which quick-add preset this came from, if any. Language-independent, so
  // switching to Polish can't make an already-added preset look unused.
  presetId?: string;
};

// Reminders don't only come from this build: cloud sync replaces the whole list
// last-writer-wins, so a record written by an older version (or a half-formed
// one) lands in storage as-is — loadJSON does no schema validation. Readers
// index straight into `lastFired` and iterate `times`, and a missing field
// there throws inside a render pass, which takes the whole tab into the
// CatchBoundary: the user gets an error screen instead of their tasks.
//
// So normalise once, here, on the way out of storage. Callers get a Reminder
// that actually matches the type and can index it without optional chaining.
export function loadReminders(): Reminder[] {
  const raw = loadJSON<unknown>(STORAGE_KEYS.reminders, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Reminder => !!r && typeof r === "object")
    .map((r) => ({
      ...r,
      times: Array.isArray(r.times) ? r.times : [],
      lastFired: r.lastFired ?? {},
    }));
}
