// Local storage helpers (SSR-safe)
const isBrowser = typeof window !== "undefined";

// Current version of the storage schema
// Incrementing this will trigger migration logic if added
export const STORAGE_VERSION = 1;

export function loadJSON<T>(key: string, fallback: T): T {
  if (!isBrowser) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      console.log(`[Storage] No data found for key: ${key}`);
      return fallback;
    }
    const data = JSON.parse(raw);

    // Safety check for empty or corrupted data
    if (data === null || data === undefined) return fallback;

    return data as T;
  } catch (e) {
    console.error(`[Storage] Failed to load key ${key}:`, e);
    return fallback;
  }
}

export function saveJSON<T>(key: string, value: T): void {
  if (!isBrowser) return;
  try {
    // Prevent saving null/undefined which could wipe data
    if (value === null || value === undefined) {
      console.warn(`[Storage] Attempted to save null/undefined to ${key}. Operation ignored.`);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error(`[Storage] Failed to save key ${key}:`, e);
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
  todo: "ff.todo.v1",
  version: "ff.storage.version",
} as const;

// Ensure storage version is tracked
if (isBrowser) {
  const current = window.localStorage.getItem(STORAGE_KEYS.version);
  if (!current) {
    window.localStorage.setItem(STORAGE_KEYS.version, String(STORAGE_VERSION));
  }
}
