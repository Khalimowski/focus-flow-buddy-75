// Local storage helpers (SSR-safe)
const isBrowser = typeof window !== "undefined";

export function loadJSON<T>(key: string, fallback: T): T {
  if (!isBrowser) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJSON<T>(key: string, value: T): void {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota */
  }
}

export const STORAGE_KEYS = {
  tasks: "ff.tasks.v1",
  reminders: "ff.reminders.v1",
  timer: "ff.timer.v1",
  streak: "ff.streak.v1",
  settings: "ff.settings.v1",
  inAppNotifs: "ff.notifs.v1",
  history: "ff.history.v1",
} as const;
