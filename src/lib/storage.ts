// Local storage helpers (SSR-safe)
const isBrowser = typeof window !== "undefined";

// Current version of the storage schema
// Incrementing this will trigger migration logic if added
export const STORAGE_VERSION = 1;

export function loadJSON<T>(key: string, fallback: T): T {
  if (!isBrowser) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    // A missing key is the normal state for a fresh install and for every
    // optional feature, and loadJSON runs on every render pass — logging it
    // buried real errors under dozens of lines per page load.
    if (!raw) return fallback;
    const data = JSON.parse(raw);

    // Safety check for empty or corrupted data
    if (data === null || data === undefined) return fallback;

    return data as T;
  } catch (e) {
    console.error(`[Storage] Failed to load key ${key}:`, e);
    return fallback;
  }
}

// Modules (e.g. cloud sync) can subscribe to local saves without storage.ts
// importing them — avoids a circular dependency.
type SaveListener = (key: string) => void;
const saveListeners: SaveListener[] = [];
export function registerSaveListener(fn: SaveListener) {
  saveListeners.push(fn);
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
    // Let interested modules react to task changes (e.g. home-screen widget mirror)
    if (key === STORAGE_KEYS.tasks) {
      window.dispatchEvent(new CustomEvent("ff.tasks_saved"));
    }
    for (const fn of saveListeners) fn(key);
  } catch (e) {
    console.error(`[Storage] Failed to save key ${key}:`, e);
  }
}

export const STORAGE_KEYS = {
  tasks: "ff.tasks.v1",
  reminders: "ff.reminders.v1",
  // Recurring events on a custom cycle — every 5 weeks, every year (see
  // lib/recurring.ts). Kept apart from `reminders` because that key holds the
  // weekly habit model and is already on users' devices in that shape.
  recurring: "ff.recurring.v1",
  streak: "ff.streak.v1",
  settings: "ff.settings.v1",
  inAppNotifs: "ff.notifs.v1",
  history: "ff.history.v1",
  todo: "ff.todo.v1",
  profile: "ff.profile.v1",
  premium: "ff.premium.v1",
  // The Google integration toggles, mirrored out of the settings store so they
  // can sync (see i18n.ts). The rest of that store stays device-local.
  googlePrefs: "ff.googleprefs.v1",
  // Per-day activity counters behind the Insights screen (see lib/stats.ts).
  // Synced, but merged rather than overwritten on pull — see sync.ts.
  stats: "ff.stats.v1",
  // Device-local on purpose (kept out of SYNC_KEYS): whether this phone has
  // been offered the home-screen widget, and until when it's snoozed. Another
  // device's answer means nothing.
  widgetPrompt: "ff.widgetprompt.v1",
  // Also device-local, and deliberately so: the id this install writes its
  // stats counters under, which is what lets two devices' counts be added up
  // instead of overwriting each other (see lib/stats.ts).
  deviceId: "ff.device.v1",
  // Also device-local: the last day whose end-of-day review was answered. The
  // *tasks* it moves sync; which screen you dismissed at 23:30 does not.
  endOfDay: "ff.eod.v1",
  // Device-local too: the newest release whose notes have been read here. Each
  // device updates on its own schedule, so another one's answer means nothing —
  // and syncing it would hide the notes on a phone that hasn't updated yet.
  whatsNew: "ff.whatsnew.v1",
  // Device-local and deliberately NOT synced: whether this install was already
  // running FlowDay when early access ended. It keeps voice input working for
  // a guest who has no account to hang an entitlement on. Syncing it would let
  // one grandfathered phone unlock the browser for a new account, which is the
  // one thing this must never do (see premium.ts).
  grandfathered: "ff.grandfathered.v1",
  version: "ff.storage.version",
} as const;

// Ensure storage version is tracked
if (isBrowser) {
  const current = window.localStorage.getItem(STORAGE_KEYS.version);
  if (!current) {
    window.localStorage.setItem(STORAGE_KEYS.version, String(STORAGE_VERSION));
  }
}
