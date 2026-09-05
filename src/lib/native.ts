import { LocalNotifications, Weekday } from "@capacitor/local-notifications";
import { StatusBar } from "@capacitor/status-bar";
import { CapacitorCalendar } from "@ebarooni/capacitor-calendar";
import { Capacitor, registerPlugin, SystemBars, SystemBarsStyle } from "@capacitor/core";
import { App } from "@capacitor/app";
import { loadJSON, saveJSON, STORAGE_KEYS } from "./storage";
import { translations, useI18nStore, type VibrationType } from "./i18n";
import { recordStat } from "./stats";
import { dateKey } from "./utils";
import { habitSlots, nextOccurrence, runsOn } from "./habits";
import {
  completeEvent,
  notifKey,
  occurrenceAt,
  occurrenceDay,
  normalizeEvents,
  type RecurringEvent,
} from "./recurring";

// Capacitor runtime helpers — isNative() guards all plugin calls, making static imports safe in browser & SSR

export const isNative = (): boolean => {
  if (typeof window === "undefined") return false;
  try {
    return Capacitor.isNativePlatform();
  } catch (e) {
    return false;
  }
};

let channelEnsured = false;
let calendarPermissionGranted = false;

export async function ensureNativeNotifPermission(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    console.log("[Notif] Checking permissions...");
    const cur = await LocalNotifications.checkPermissions();

    if (cur.display !== "granted") {
      const req = await LocalNotifications.requestPermissions();
      if (req.display !== "granted") return false;
    }

    // Android 12+ exact alarms
    try {
      if ((LocalNotifications as any).checkExactNotificationSetting) {
        const exact = await (LocalNotifications as any).checkExactNotificationSetting();
        if (exact.exact_alarm !== "granted") {
          await (LocalNotifications as any).changeExactNotificationSetting();
        }
      }
    } catch (e) {
      console.warn("[Notif] Exact alarm check skipped", e);
    }

    return true;
  } catch (e) {
    console.error("[Notif] Permission check failed", e);
    return false;
  }
}

export async function ensureCalendarPermission(): Promise<boolean> {
  if (!isNative()) return false;
  if (calendarPermissionGranted) return true;

  const isGranted = (s: any) => s === "granted";

  try {
    const check = await CapacitorCalendar.checkAllPermissions();
    console.log("[Perm] checkAllPermissions:", JSON.stringify(check));

    // Android returns states at the top level: { readCalendar: "granted", writeCalendar: "granted", ... }
    if (isGranted((check as any).readCalendar) && isGranted((check as any).writeCalendar)) {
      console.log("[Perm] Calendar permissions already granted");
      calendarPermissionGranted = true;
      return true;
    }

    // Request full access — shows a single combined dialog on Android
    const req = await CapacitorCalendar.requestFullCalendarAccess();
    console.log("[Perm] requestFullCalendarAccess:", JSON.stringify(req));

    // Returns { result: "granted" | "denied" | "prompt" }
    calendarPermissionGranted = isGranted((req as any).result);
    return calendarPermissionGranted;
  } catch (e) {
    console.error("[Perm] Calendar permission failed:", e);
    return false;
  }
}

// One channel per vibration style — Android channels are immutable after
// creation, so the vibration setting works by scheduling on a different
// channel id. Patterns live in MainActivity.java (createNotificationChannel);
// keep both places in step when adding a style.
const VIBRATION_CHANNELS: Record<VibrationType, string> = {
  long: "boink_channel_v8",
  short: "boink_channel_v8_short",
  double: "boink_channel_v8_double",
  off: "boink_channel_v8_novib",
};

function currentChannelId(): string {
  const type = useI18nStore.getState().vibrationType;
  return VIBRATION_CHANNELS[type] ?? VIBRATION_CHANNELS.long;
}

async function ensureChannel() {
  if (!isNative() || channelEnsured) return;
  try {
    // Safety net only — MainActivity creates these first (onResume runs
    // before the WebView JS) with the real vibration patterns, which
    // Capacitor's createChannel can't express.
    for (const [type, id] of Object.entries(VIBRATION_CHANNELS) as [VibrationType, string][]) {
      await LocalNotifications.createChannel({
        id,
        name: "Habit Notifications",
        description: "Channel for your calm habit reminders",
        importance: 5,
        visibility: 1,
        sound: "boink",
        vibration: type !== "off",
      });
    }
    channelEnsured = true;
  } catch (e) {
    console.error("[Notif] Channel creation failed", e);
  }
}

// Re-issue pending notifications so they pick up the channel matching the
// current vibration setting. Cancels canonical task/habit ids only —
// postponed notifications use throwaway ids and are left to fire as-is.
export async function applyVibrationSetting() {
  if (!isNative()) return;
  try {
    const pending = await LocalNotifications.getPending();
    const canonical: number[] = [];
    for (const n of pending.notifications) {
      const extra = (n.extra ?? {}) as { type?: string; taskId?: string; canonical?: boolean };
      if (extra.type === "task" && extra.taskId && n.id === hashId("task:" + extra.taskId)) {
        canonical.push(n.id);
      } else if (extra.type === "nudge") {
        canonical.push(n.id);
      } else if (extra.type === "cycle" && extra.canonical) {
        canonical.push(n.id);
      }
    }
    if (canonical.length > 0) await cancelNative(canonical);
    await reconcileNotifications();
    // Re-armed rather than cancelled above: scheduling by the same id replaces
    // it, which is all it takes to pick up the new channel.
    await refreshEndOfDayPrompt();
  } catch (e) {
    console.warn("[Native] applyVibrationSetting failed", e);
  }
}

// Fire an immediate native notification
export async function nativeNotify(title: string, body?: string) {
  if (!isNative()) return;
  try {
    await ensureChannel();
    const notifId = hashId(title + Date.now());
    console.log(`Scheduling immediate notification: ${title} (id: ${notifId})`);
    await LocalNotifications.schedule({
      notifications: [
        {
          id: notifId,
          title,
          body: body ?? "",
          schedule: { at: new Date(Date.now() + 1000), allowWhileIdle: true },
          channelId: currentChannelId(),
          smallIcon: "ic_stat_icon",
          sound: "boink",
          actionTypeId: "TASK_ACTIONS",
          extra: { type: 'test' }
        },
      ],
    });
    console.log("Immediate notification scheduled.");
  } catch (e) {
    console.error("nativeNotify failed", e);
  }
}

// Schedule a one-shot notification at a future date
export async function scheduleNativeAt(id: number, title: string, body: string, at: Date, syncCalendar = false, taskId?: string, durationMin?: number) {
  if (!isNative()) return;
  try {
    await ensureChannel();
    console.log(`[Native] Scheduling notification at ${at.toISOString()}: ${title} (id: ${id})`);
    await LocalNotifications.schedule({
      notifications: [
        {
          id,
          title,
          body,
          schedule: { at, allowWhileIdle: true },
          channelId: currentChannelId(),
          smallIcon: "ic_stat_icon",
          sound: "boink",
          actionTypeId: "TASK_ACTIONS",
          extra: { type: 'task', taskId, title }
        }
      ],
    });

    if (syncCalendar) {
      void addToCalendar(title, at, durationMin);
    }

    console.log(`[Native] Notification ${id} scheduled.`);
  } catch (e) {
    console.error("[Native] scheduleNativeAt failed", e);
  }
}

// Schedule a daily-repeating notification at HH:mm for one habit time.
//
// The payload below still says "nudge" — the action type id, the `type` tag and
// the `nudgeId` field — because habits used to be called nudges and every
// notification an older build already scheduled is sitting on the user's phone
// with those exact values. Reconciliation and the action handlers match on them,
// so renaming here would orphan every pending notification until it re-fired.
/**
 * Arm one repeating habit slot. Without `weekday` it repeats every day; with it
 * (JS numbering, 0 = Sunday) the match narrows to that one day, so the same
 * notification repeats weekly instead.
 */
export async function scheduleNativeDaily(id: number, title: string, body: string, hour: number, minute: number, syncCalendar = false, habitId?: string, weekday?: number) {
  if (!isNative()) return;
  try {
    await ensureChannel();
    const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    // Capacitor's Weekday runs Sunday = 1 … Saturday = 7, one ahead of getDay().
    const on = weekday === undefined
      ? { hour, minute }
      : { weekday: (weekday + 1) as Weekday, hour, minute };
    console.log(`Scheduling ${weekday === undefined ? 'daily' : `weekly (day ${weekday})`} notification at ${hour}:${minute}: ${title} (id: ${id})`);
    await LocalNotifications.schedule({
      notifications: [
        {
          id,
          title,
          body,
          schedule: { on, repeats: true, allowWhileIdle: true },
          channelId: currentChannelId(),
          smallIcon: "ic_stat_icon",
          sound: "boink",
          actionTypeId: "NUDGE_ACTIONS",
          extra: { type: 'nudge', nudgeId: habitId, time: timeStr, title }
        },
      ],
    });

    if (syncCalendar) {
      void addToCalendar(title, nextOccurrence(weekday === undefined ? undefined : [weekday], hour, minute));
    }

    console.log(`Daily notification ${id} scheduled.`);
  } catch (e) {
    console.error("scheduleNativeDaily failed", e);
  }
}

/**
 * Arm the one-shot notification for a recurring event's next occurrence (see
 * lib/recurring.ts). Long cycles are scheduled a year or more ahead, which
 * Android forgets on reboot — `reconcileNotifications` re-arms them at boot,
 * which is why the id is derived from the occurrence rather than random.
 *
 * `occurrence` is the day this one is *for*, carried so the Done action can
 * tick off that day rather than whichever day the notification is answered on.
 *
 * `canonical` marks exactly the reconcilable id. A postponed copy is scheduled
 * with a throwaway id and `canonical: false`, so the reconcile pass leaves it
 * alone instead of cancelling it as stale.
 */
export async function scheduleNativeCycle(
  id: number,
  title: string,
  body: string,
  at: Date,
  cycleId: string,
  occurrence: string,
  canonical = true,
) {
  if (!isNative()) return;
  try {
    await ensureChannel();
    console.log(`[Native] Scheduling cycle at ${at.toISOString()}: ${title} (id: ${id})`);
    await LocalNotifications.schedule({
      notifications: [
        {
          id,
          title,
          body,
          schedule: { at, allowWhileIdle: true },
          channelId: currentChannelId(),
          smallIcon: "ic_stat_icon",
          sound: "boink",
          actionTypeId: "CYCLE_ACTIONS",
          extra: { type: 'cycle', cycleId, title, occurrence, canonical },
        },
      ],
    });
  } catch (e) {
    console.error("[Native] scheduleNativeCycle failed", e);
  }
}

/**
 * Put a recurring event's notification where the event now says it belongs.
 *
 * `previous` is the version being replaced, if any. Its notification is only
 * cancelled when the new one lands under a *different* id — scheduling an id
 * again replaces what's pending under it, and cancelling then re-scheduling the
 * same id is a race between two calls that can arrive in either order.
 */
export async function syncCycleNotification(
  next: RecurringEvent,
  body: string,
  previous?: RecurringEvent,
) {
  if (!isNative()) return;
  const nextKey = notifKey(next);
  if (previous && (!next.enabled || notifKey(previous) !== nextKey)) {
    await cancelNative([hashId(notifKey(previous))]);
  }
  if (!next.enabled) return;
  const at = occurrenceAt(next);
  // Already behind us: it has fired, or it was missed. Either way the app's own
  // list is what carries an overdue cycle from here.
  if (at.getTime() <= Date.now()) return;
  await scheduleNativeCycle(hashId(nextKey), next.label, body, at, next.id, occurrenceDay(next));
}

/** Drop the notification armed for this event's current occurrence. */
export async function cancelCycleNotification(ev: RecurringEvent) {
  if (!isNative()) return;
  await cancelNative([hashId(notifKey(ev))]);
}

// --- End-of-day review reminder ---
// One notification, re-armed from storage rather than left repeating: a daily
// `repeats: true` schedule would fire on evenings with nothing left to move.
// The id is fixed, so scheduling replaces any earlier arming.
const EOD_NOTIF_ID = hashId("eod:review");

/**
 * Arm (or clear) the "you still have open tasks" reminder for the next occurrence
 * of the user's check-in time. Cheap and idempotent — called at boot, on every
 * task save, and whenever the setting changes.
 */
export async function refreshEndOfDayPrompt() {
  if (!isNative()) return;
  try {
    const settings = useI18nStore.getState();
    if (!settings.eodReview) {
      await cancelNative([EOD_NOTIF_ID]);
      return;
    }

    const [h, m] = settings.eodTime.split(":").map(Number);
    const at = new Date();
    at.setHours(h || 0, m || 0, 0, 0);
    // Past today's time already: the next check-in is tomorrow's.
    if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);

    // Only remind about days that have actually arrived by then — a task planned
    // for next week isn't "unfinished" tonight.
    const dayKey = dateKey(at);
    type TaskLike = { done: boolean; dueDate?: string };
    const tasks = loadJSON<TaskLike[]>(STORAGE_KEYS.tasks, []);
    const open = tasks.filter((t) => !t.done && (t.dueDate ?? dayKey) <= dayKey);
    if (open.length === 0) {
      await cancelNative([EOD_NOTIF_ID]);
      return;
    }

    await ensureChannel();
    const lang = translations[settings.language] || translations.en;
    await LocalNotifications.schedule({
      notifications: [
        {
          id: EOD_NOTIF_ID,
          title: lang.eod_notif_title,
          body: lang.eod_notif_body,
          schedule: { at, allowWhileIdle: true },
          channelId: currentChannelId(),
          smallIcon: "ic_stat_icon",
          sound: "boink",
          extra: { type: "eod" },
        },
      ],
    });
  } catch (e) {
    console.warn("[Native] refreshEndOfDayPrompt failed", e);
  }
}

async function addToCalendar(title: string, date: Date, durationMin?: number) {
  if (!isNative()) return;
  try {
    const hasPerm = await ensureCalendarPermission();
    if (!hasPerm) return;

    // 1. Fetch available calendars to find a good one (visible/primary)
    const listRes = await CapacitorCalendar.listCalendars();
    const calendars = (listRes as any).result || [];
    console.log(`[Sync] Found ${calendars.length} calendars`);

    // Prioritize Primary, then Visible, then fallback to first available
    const bestCalendar =
      calendars.find((c: any) => c.isPrimary) ||
      calendars.find((c: any) => c.visible) ||
      calendars[0];

    if (!bestCalendar) {
      console.warn("[Sync] No calendars found on device");
      return null;
    }

    console.log(`[Sync] Selected calendar: "${bestCalendar.title}" (id: ${bestCalendar.id}, visible: ${bestCalendar.visible})`);

    const endDate = new Date(date.getTime() + (durationMin ?? 15) * 60 * 1000);
    console.log(`[Sync] Adding: "${title}" at ${date.toISOString()}`);

    const res = await CapacitorCalendar.createEvent({
      title,
      startDate: date.getTime(),
      endDate: endDate.getTime(),
      calendarId: bestCalendar.id.toString(), // Ensure we pass the ID we found
    });

    console.log(`[Sync] Created event id: ${(res as any).id}`);
    return (res as any).id;
  } catch (e) {
    calendarPermissionGranted = false; // reset cache — op failure may indicate revoked permission
    console.warn("[Sync] addToCalendar failed:", e);
    return null;
  }
}

export async function deleteFromCalendar(title: string) {
  if (!isNative()) return;
  try {
    const hasPerm = await ensureCalendarPermission();
    if (!hasPerm) return;

    console.log(`[Sync] Searching for events to delete: "${title}"`);
    const searchRes = await CapacitorCalendar.listEventsInRange({
      from: Date.now() - 30 * 24 * 60 * 60 * 1000,
      to: Date.now() + 365 * 24 * 60 * 60 * 1000,
    });

    const allEvents = (searchRes as any).result || [];
    console.log(`[Sync] listEventsInRange returned ${allEvents.length} events`);

    const toDelete = allEvents
      .filter((ev: any) => ev.title === title)
      .map((ev: any) => ev.id);

    if (toDelete.length > 0) {
      await CapacitorCalendar.deleteEventsById({ ids: toDelete });
      console.log(`[Sync] Deleted ${toDelete.length} event(s) with title "${title}"`);
    } else {
      console.log(`[Sync] No events found to delete for "${title}"`);
    }
  } catch (e) {
    calendarPermissionGranted = false;
    console.error("[Sync] deleteFromCalendar failed:", e);
  }
}

export async function cancelNative(ids: number[]) {
  if (!isNative() || ids.length === 0) return;
  try {
    console.log("Cancelling notifications:", ids);
    await LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) });
  } catch (e) {
    console.error("cancelNative failed", e);
  }
}

// --- Home-screen widget bridge (Android) ---
// Mirrors open tasks into SharedPreferences for TaskWidgetProvider and pulls
// back ids ticked from the widget while the app was closed.

type WidgetBridgePlugin = {
  setTasks(options: { tasks: string }): Promise<void>;
  setTheme(options: { theme: "light" | "dark" }): Promise<void>;
  getPendingDone(): Promise<{ ids: string[] }>;
  getPinState(): Promise<{ supported: boolean; added: boolean }>;
  requestPin(): Promise<{ requested: boolean }>;
};
const WidgetBridge = registerPlugin<WidgetBridgePlugin>("WidgetBridge");

type WidgetTask = {
  id: string;
  title: string;
  done: boolean;
  remindAt: string | null;
  dueDate: string;
  createdAt: number;
};

// Same ordering as the app's task list: reminder time first, then creation;
// earlier due dates (incl. overdue) come before later ones.
function sortForWidget(list: WidgetTask[]): WidgetTask[] {
  return [...list].sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    if (a.remindAt && b.remindAt) {
      const getHM = (iso: string) => {
        const d = new Date(iso);
        return d.getHours() * 60 + d.getMinutes();
      };
      const diff = getHM(a.remindAt) - getHM(b.remindAt);
      if (diff !== 0) return diff;
      return a.createdAt - b.createdAt;
    }
    if (a.remindAt) return -1;
    if (b.remindAt) return 1;
    return a.createdAt - b.createdAt;
  });
}

export async function pushTasksToWidget() {
  if (!isNative()) return;
  try {
    const tasks = loadJSON<WidgetTask[]>(STORAGE_KEYS.tasks, []);
    // dueDate rides along so the widget can filter to the device's current
    // day at render time (stays correct across midnight without the app)
    const open = sortForWidget(tasks.filter((t) => !t.done)).map((t) => ({
      id: t.id,
      title: t.title,
      dueDate: t.dueDate,
      // Pre-formatted like the in-app list so the widget just displays it
      time: t.remindAt
        ? new Date(t.remindAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : "",
    }));
    await WidgetBridge.setTasks({ tasks: JSON.stringify(open) });
  } catch (e) {
    console.warn("[Widget] Failed to push tasks", e);
  }
}

export async function syncWidgetTicks() {
  if (!isNative()) return;
  try {
    const { ids } = await WidgetBridge.getPendingDone();
    if (!ids || ids.length === 0) {
      void pushTasksToWidget();
      return;
    }
    console.log(`[Widget] Applying ${ids.length} tick(s) from widget`);
    const idSet = new Set(ids);
    const tasks = loadJSON<WidgetTask[]>(STORAGE_KEYS.tasks, []);
    const updated = tasks.map((t) => (idSet.has(t.id) ? { ...t, done: true } : t));
    saveJSON(STORAGE_KEYS.tasks, updated); // fires ff.tasks_saved -> widget re-push
    void cancelNative(ids.map((id) => hashId("task:" + id)));
    window.dispatchEvent(new CustomEvent("ff.data_updated"));
  } catch (e) {
    console.warn("[Widget] Failed to sync ticks", e);
  }
}

export type WidgetPinState = { supported: boolean; added: boolean };

// Whether we can offer to pin the widget, and whether it's already on a home
// screen. Web (and APKs built before the plugin gained these methods) report
// unsupported, which keeps the prompt hidden.
export async function getWidgetPinState(): Promise<WidgetPinState> {
  if (!isNative()) return { supported: false, added: false };
  try {
    const state = await WidgetBridge.getPinState();
    return { supported: !!state?.supported, added: !!state?.added };
  } catch (e) {
    console.warn("[Widget] Pin state unavailable", e);
    return { supported: false, added: false };
  }
}

// Opens the launcher's "add widget" dialog. False means the launcher refused —
// the user has to long-press the home screen instead.
export async function requestWidgetPin(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const { requested } = await WidgetBridge.requestPin();
    return !!requested;
  } catch (e) {
    console.warn("[Widget] Pin request failed", e);
    return false;
  }
}

// Stable numeric id from a string (for plugin id field)
export function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 2_000_000_000;
}

// Make the device's scheduled notifications match current storage. Called
// after cloud sync writes remote data (items created/completed on another
// device) and at boot as a safety net. Calendar sync only runs for
// notifications that are newly scheduled here (not already pending), with a
// delete-by-title first — that's what keeps repeated pulls from duplicating
// calendar events.
export async function reconcileNotifications() {
  if (!isNative()) return;
  try {
    const settings = useI18nStore.getState();
    const lang = translations[settings.language] || translations.en;
    const now = Date.now();
    // Local day key — must match what the Reminders UI writes into lastFired.
    const today = dateKey();

    type TaskLike = { id: string; title: string; done: boolean; remindAt?: string | null; durationMin?: number };
    type ReminderLike = {
      id: string;
      label: string;
      times: string[];
      enabled: boolean;
      lastFired?: Record<string, string>;
      days?: number[];
    };

    const tasks = loadJSON<TaskLike[]>(STORAGE_KEYS.tasks, []);
    const reminders = loadJSON<ReminderLike[]>(STORAGE_KEYS.reminders, []);
    const cycles = normalizeEvents(loadJSON<unknown>(STORAGE_KEYS.recurring, []));

    // One-shot task reminders that should be pending: open + in the future
    const wantTask = new Map<number, TaskLike>();
    for (const t of tasks) {
      if (!t.done && t.remindAt && new Date(t.remindAt).getTime() > now) {
        wantTask.set(hashId("task:" + t.id), t);
      }
    }

    // Daily habit slots that should exist at all (enabled reminders)…
    const validHabitIds = new Set<number>();
    // …and the subset to (re)schedule now (skip slots already fired today —
    // boot cleanup cancels those; the Reminders UI re-arms them next day)
    const scheduleHabit = new Map<number, { r: ReminderLike; hour: number; minute: number; weekday?: number }>();
    for (const r of reminders) {
      if (!r.enabled) continue;
      for (const slot of habitSlots(r)) {
        const id = hashId(slot.key);
        validHabitIds.add(id);
        // Already ticked off today: boot cleanup cancels it and the next
        // reconcile re-arms it. A slot for another weekday was never armed for
        // today, so today's lastFired says nothing about it.
        const firedToday = r.lastFired?.[slot.time] === today && runsOn(r.days, new Date());
        if (!firedToday) scheduleHabit.set(id, { r, hour: slot.hour, minute: slot.minute, weekday: slot.weekday });
      }
    }

    // Recurring events: one notification per event, at its next occurrence.
    // An occurrence already behind us has fired (or was missed) and stays
    // unscheduled — the app's own list is what nags about an overdue one.
    const wantCycle = new Map<number, { ev: RecurringEvent; at: Date }>();
    for (const ev of cycles) {
      if (!ev.enabled) continue;
      const at = occurrenceAt(ev);
      if (at.getTime() > now) wantCycle.set(hashId(notifKey(ev)), { ev, at });
    }

    const pending = await LocalNotifications.getPending();
    const pendingIds = new Set<number>();
    const stale: number[] = [];
    // Labels of reminders that were deleted/disabled remotely — their calendar
    // events should go the same way cancelAll() removes them locally.
    const staleHabitLabels = new Set<string>();
    for (const n of pending.notifications) {
      pendingIds.add(n.id);
      const extra = (n.extra ?? {}) as {
        type?: string;
        taskId?: string;
        nudgeId?: string;
        cycleId?: string;
        canonical?: boolean;
        title?: string;
      };
      // Only touch canonical ids — postponed reminders use throwaway ids and
      // should be left to fire.
      if (extra.type === "task" && extra.taskId && n.id === hashId("task:" + extra.taskId)) {
        if (!wantTask.has(n.id)) stale.push(n.id);
      } else if (extra.type === "cycle") {
        // Only the id derived from the current occurrence is ours to cancel; a
        // postponed copy carries canonical: false and is left to fire.
        if (extra.canonical && !wantCycle.has(n.id)) stale.push(n.id);
      } else if (extra.type === "nudge") {
        if (!validHabitIds.has(n.id)) {
          stale.push(n.id);
          // Only wipe calendar events when the whole reminder is gone or
          // disabled — a reminder that merely lost one time slot keeps the
          // events of its remaining slots (delete is by title, not per slot).
          const owner = reminders.find((r) => r.id === extra.nudgeId);
          if (settings.habitCalendarSync && (!owner || !owner.enabled) && extra.title) {
            staleHabitLabels.add(extra.title);
          }
        }
      }
    }
    if (stale.length > 0) await cancelNative(stale);
    for (const label of staleHabitLabels) await deleteFromCalendar(label);

    let added = 0;
    for (const [id, t] of wantTask) {
      if (!pendingIds.has(id)) {
        // Same idiom as TaskList's add path: delete-by-title first (dedupe),
        // then schedule with the calendar flag.
        if (settings.calendarSync) await deleteFromCalendar(t.title);
        await scheduleNativeAt(id, t.title, lang.reminder_title, new Date(t.remindAt!), settings.calendarSync, t.id, t.durationMin);
        added++;
      }
    }
    // Reminders whose calendar events were already cleaned (or intentionally
    // kept) in this pass — delete-by-title must run at most once per reminder,
    // or the second slot's cleanup would erase the first slot's fresh event.
    const cleanedHabits = new Set<string>();
    for (const [id, { r, hour, minute, weekday }] of scheduleHabit) {
      if (!pendingIds.has(id)) {
        if (settings.habitCalendarSync && !cleanedHabits.has(r.id)) {
          cleanedHabits.add(r.id);
          // Delete-first only when the reminder is wholly new to this device;
          // if sibling slots are still pending, their events must survive.
          const siblingIds = habitSlots(r).map((slot) => hashId(slot.key));
          if (!siblingIds.some((sid) => pendingIds.has(sid))) {
            await deleteFromCalendar(r.label);
          }
        }
        await scheduleNativeDaily(id, r.label, lang.gentle_habit_emoji, hour, minute, settings.habitCalendarSync, r.id, weekday);
        added++;
      }
    }
    for (const [id, { ev, at }] of wantCycle) {
      if (!pendingIds.has(id)) {
        await scheduleNativeCycle(
          id,
          ev.label,
          lang.cycle_notification_body,
          at,
          ev.id,
          occurrenceDay(ev),
        );
        added++;
      }
    }
    console.log(`[Native] Reconciled notifications: +${added} scheduled, -${stale.length} cancelled`);
  } catch (e) {
    console.warn("[Native] reconcileNotifications failed", e);
  }
}

// Set once initNative has run. The screen re-runs its boot effect on every
// theme change, and a second pass would add a second
// localNotificationActionPerformed listener — harmless for a task tick, which
// is idempotent, but a cycle's Done *advances* its date, so two listeners moved
// it two intervals.
let nativeInitialized = false;

// Call once at app boot
export async function initNative() {
  if (!isNative() || nativeInitialized) return;
  nativeInitialized = true;
  console.log("[Native] Initializing features...");

  // Register notification actions
  try {
    await LocalNotifications.registerActionTypes({
      types: [
        {
          id: 'TASK_ACTIONS',
          actions: [
            { id: 'done', title: 'Done' },
            { id: 'postpone', title: 'Postpone (15m)' }
          ]
        },
        {
          id: 'NUDGE_ACTIONS',
          actions: [
            { id: 'done', title: 'Got it!' },
            { id: 'postpone', title: 'Remind later' }
          ]
        },
        {
          id: 'CYCLE_ACTIONS',
          actions: [
            { id: 'done', title: 'Done' },
            // A cycle is weeks or months long — fifteen minutes, the snooze the
            // other two use, would be no reprieve at all.
            { id: 'postpone', title: 'Remind tomorrow' }
          ]
        }
      ]
    });

    // Handle actions
    LocalNotifications.addListener('localNotificationActionPerformed', async (notification) => {
      const { actionId, notification: { extra } } = notification;
      if (!extra || !extra.type) return;

      console.log(`[Native] Notification action: ${actionId} for type ${extra.type}`);

      if (extra.type === 'task') {
        const taskId = extra.taskId;
        if (actionId === 'done') {
          const tasks = loadJSON<any[]>(STORAGE_KEYS.tasks, []);
          const updated = tasks.map(t => t.id === taskId ? { ...t, done: true } : t);
          saveJSON(STORAGE_KEYS.tasks, updated);
          window.dispatchEvent(new CustomEvent('ff.data_updated'));
          void deleteFromCalendar(extra.title);
          // Ticked off from the notification shade — same completion as
          // tapping the circle in the app, and Insights must see both.
          if (tasks.some(t => t.id === taskId && !t.done)) recordStat('taskCompleted');
        } else if (actionId === 'postpone') {
          const nextAt = new Date(Date.now() + 15 * 60 * 1000);
          const id = hashId("task:" + taskId + Date.now()); // New ID to avoid conflicts
          void scheduleNativeAt(id, extra.title, "Postponed reminder", nextAt, false, taskId);
          recordStat('taskSnoozed');
        }
      } else if (extra.type === 'cycle') {
        const cycleId = extra.cycleId;
        const events = normalizeEvents(loadJSON<unknown>(STORAGE_KEYS.recurring, []));
        const target = events.find(e => e.id === cycleId);
        if (!target) return;
        // The day this notification was for. A shade left unread until tomorrow
        // still answers *yesterday's* occurrence.
        const occurrence = typeof extra.occurrence === 'string' ? extra.occurrence : undefined;
        if (actionId === 'done') {
          // A fixed-date cycle ticks off the occurrence that fired: answering
          // Monday's notification on Tuesday would otherwise mark the *next*
          // date done and skip it entirely. A completion-mode cycle still
          // counts from today — restarting on the day you did it is the mode.
          const on = target.mode === 'schedule' && occurrence ? occurrence : dateKey();
          saveJSON(
            STORAGE_KEYS.recurring,
            events.map(e => (e.id === cycleId ? completeEvent(e, on) : e)),
          );
          window.dispatchEvent(new CustomEvent('ff.data_updated'));
          // The next occurrence can be a year out; arm it now rather than
          // waiting for the app to be opened.
          void reconcileNotifications();
        } else if (actionId === 'postpone') {
          const nextAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
          const lang = translations[useI18nStore.getState().language] || translations.en;
          void scheduleNativeCycle(
            hashId("cycle:" + cycleId + Date.now()),
            target.label,
            lang.cycle_notification_body,
            nextAt,
            target.id,
            // Still the same occurrence — only the reminder moved.
            occurrence ?? occurrenceDay(target),
            false,
          );
        }
      } else if (extra.type === 'nudge') {
        const nudgeId = extra.nudgeId;
        const time = extra.time;
        if (actionId === 'done') {
          const reminders = loadJSON<any[]>(STORAGE_KEYS.reminders, []);
          const dateStr = dateKey();
          const updated = reminders.map(r =>
            r.id === nudgeId ? { ...r, lastFired: { ...r.lastFired, [time]: dateStr } } : r
          );
          saveJSON(STORAGE_KEYS.reminders, updated);
          window.dispatchEvent(new CustomEvent('ff.data_updated'));
          if (reminders.some(r => r.id === nudgeId && r.lastFired?.[time] !== dateStr)) {
            recordStat('habitCompleted', 1, dateStr);
          }
        } else if (actionId === 'postpone') {
          const nextAt = new Date(Date.now() + 15 * 60 * 1000);
          const id = hashId("nudge:" + nudgeId + Date.now());
          void scheduleNativeAt(id, extra.title, "Postponed habit", nextAt, false);
          recordStat('habitSnoozed');
        }
      }
    });
  } catch (e) {
    console.error("[Native] Failed to register actions", e);
  }

  // Persistence check: Track boot count to confirm localStorage stability
  try {
    const boots = Number(window.localStorage.getItem("ff.boot_count") || "0");
    window.localStorage.setItem("ff.boot_count", String(boots + 1));

    // Log data counts for verification
    const tasksRaw = window.localStorage.getItem("ff.tasks.v1");
    const tasksCount = tasksRaw ? JSON.parse(tasksRaw).length : 0;
    console.log(`[Persistence] App boot #${boots + 1}. Tasks found: ${tasksCount}. Data is stable.`);
  } catch (e) {
    console.warn("[Persistence] Failed to update boot count", e);
  }

  await ensureNativeNotifPermission();
  await ensureChannel();

  // Notification Cleanup: Cancel notifications for tasks that are already done
  // or habits that have already been fired today.
  try {
    const tasks = loadJSON<any[]>(STORAGE_KEYS.tasks, []);
    const doneTaskIds = tasks.filter(t => t.done).map(t => hashId("task:" + t.id));

    const reminders = loadJSON<any[]>(STORAGE_KEYS.reminders, []);
    const dateStr = dateKey();
    const firedHabitIds: number[] = [];

    // Only slots that belong to today can have been ticked off today — a
    // Monday-only habit keeps its notification armed on a Tuesday.
    const runsToday = new Date();
    reminders.forEach(r => {
      if (!runsOn(r.days, runsToday)) return;
      habitSlots(r).forEach(slot => {
        if (r.lastFired?.[slot.time] === dateStr) {
          firedHabitIds.push(hashId(slot.key));
        }
      });
    });

    const toCancel = [...doneTaskIds, ...firedHabitIds];
    if (toCancel.length > 0) {
      console.log(`[Native] Cleaning up ${toCancel.length} obsolete notifications`);
      await cancelNative(toCancel);
    }
  } catch (e) {
    console.warn("[Native] Notification cleanup failed", e);
  }

  // Home-screen widget: keep the mirror fresh and apply ticks made while closed
  try {
    window.addEventListener("ff.tasks_saved", () => {
      void pushTasksToWidget();
      // Ticking the last open task off should take tonight's check-in with it
      void refreshEndOfDayPrompt();
    });
    void App.addListener("resume", () => {
      void syncWidgetTicks();
      // A one-shot cycle notification is spent once it fires, and the next
      // occurrence can only be armed by code that runs. Cold start already
      // reconciles; this catches the app merely coming back to the foreground.
      void reconcileNotifications();
    });
    await syncWidgetTicks();
  } catch (e) {
    console.warn("[Native] Widget sync setup failed", e);
  }

  // Safety net: re-arm notifications from storage (covers items synced from
  // other devices before this ran, and schedules lost to device reboots)
  void reconcileNotifications();
  void refreshEndOfDayPrompt();

  // AdMob banner — dynamic import keeps the ads SDK out of the web bundle path
  void import("./ads").then((m) => m.initAds());

  try {
    // Pre-Android-15 devices only (the plugin no-ops on 15+, where the app is
    // edge-to-edge and bar areas show the app's own background instead).
    await StatusBar.setBackgroundColor({ color: "#0F1115" });
  } catch (e) {
    console.warn("[Native] StatusBar setup failed", e);
  }
}

// Dynamically update status bar based on theme
export async function updateStatusBar(theme: "light" | "dark") {
  if (!isNative()) return;
  // Called on boot and on every theme toggle — keep the widget's mode in step
  try {
    await WidgetBridge.setTheme({ theme });
  } catch (e) {
    console.warn("[Widget] Failed to push theme", e);
  }
  try {
    // SystemBars (Capacitor core) styles status + gesture bar icons via the
    // non-deprecated WindowInsetsController path and is what applies on
    // Android 15+ edge-to-edge. setBackgroundColor only has an effect on
    // pre-15 devices, where the bars still have solid backgrounds.
    if (theme === "dark") {
      await SystemBars.setStyle({ style: SystemBarsStyle.Dark });
      await StatusBar.setBackgroundColor({ color: "#0F1115" });
    } else {
      await SystemBars.setStyle({ style: SystemBarsStyle.Light });
      await StatusBar.setBackgroundColor({ color: "#F9FAFB" });
    }
    console.log(`[Native] Status bar updated for ${theme} mode`);
  } catch (e) {
    console.warn("[Native] updateStatusBar failed", e);
  }
}

export async function syncAllToCalendar(tasks: any[], reminders: any[]) {
  if (!isNative()) return;
  const hasPerm = await ensureCalendarPermission();
  if (!hasPerm) {
    console.warn("[Native] syncAllToCalendar: calendar permission not granted");
    return;
  }

  console.log("[Native] Starting bulk calendar sync...");
  for (const task of tasks) {
    if (task.remindAt && !task.done) {
      await deleteFromCalendar(task.title);
      await addToCalendar(task.title, new Date(task.remindAt), task.durationMin);
    }
  }
  for (const reminder of reminders) {
    if (reminder.enabled) {
      await deleteFromCalendar(reminder.label);
      for (const slot of habitSlots(reminder)) {
        await addToCalendar(
          reminder.label,
          nextOccurrence(slot.weekday === undefined ? undefined : [slot.weekday], slot.hour, slot.minute),
        );
      }
    }
  }
  console.log("[Native] Bulk calendar sync complete.");
}
