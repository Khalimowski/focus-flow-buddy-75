import { LocalNotifications } from "@capacitor/local-notifications";
import { StatusBar, Style } from "@capacitor/status-bar";
import { CapacitorCalendar } from "@ebarooni/capacitor-calendar";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { App } from "@capacitor/app";
import { loadJSON, saveJSON, STORAGE_KEYS } from "./storage";
import { translations, useI18nStore } from "./i18n";

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

async function ensureChannel() {
  if (!isNative() || channelEnsured) return;
  try {
    await LocalNotifications.createChannel({
      id: "boink_channel_v8",
      name: "Nudge Notifications",
      description: "Channel for your calm nudges and reminders",
      importance: 5,
      visibility: 1,
      sound: "boink",
      vibration: true,
    });
    channelEnsured = true;
  } catch (e) {
    console.error("[Notif] Channel creation failed", e);
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
          channelId: "boink_channel_v8",
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
export async function scheduleNativeAt(id: number, title: string, body: string, at: Date, syncCalendar = false, taskId?: string) {
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
          channelId: "boink_channel_v8",
          smallIcon: "ic_stat_icon",
          sound: "boink",
          actionTypeId: "TASK_ACTIONS",
          extra: { type: 'task', taskId, title }
        }
      ],
    });

    if (syncCalendar) {
      void addToCalendar(title, at);
    }

    console.log(`[Native] Notification ${id} scheduled.`);
  } catch (e) {
    console.error("[Native] scheduleNativeAt failed", e);
  }
}

// Schedule a daily-repeating notification at HH:mm
export async function scheduleNativeDaily(id: number, title: string, body: string, hour: number, minute: number, syncCalendar = false, nudgeId?: string) {
  if (!isNative()) return;
  try {
    await ensureChannel();
    const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    console.log(`Scheduling daily notification at ${hour}:${minute}: ${title} (id: ${id})`);
    await LocalNotifications.schedule({
      notifications: [
        {
          id,
          title,
          body,
          schedule: { on: { hour, minute }, repeats: true, allowWhileIdle: true },
          channelId: "boink_channel_v8",
          smallIcon: "ic_stat_icon",
          sound: "boink",
          actionTypeId: "NUDGE_ACTIONS",
          extra: { type: 'nudge', nudgeId, time: timeStr, title }
        },
      ],
    });

    if (syncCalendar) {
      const at = new Date();
      at.setHours(hour, minute, 0, 0);
      if (at.getTime() < Date.now()) at.setDate(at.getDate() + 1);
      void addToCalendar(title, at);
    }

    console.log(`Daily notification ${id} scheduled.`);
  } catch (e) {
    console.error("scheduleNativeDaily failed", e);
  }
}

async function addToCalendar(title: string, date: Date) {
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

    const endDate = new Date(date.getTime() + 15 * 60 * 1000);
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

// Stable numeric id from a string (for plugin id field)
export function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 2_000_000_000;
}

// Make the device's scheduled notifications match current storage. Called
// after cloud sync writes remote data (items created/completed on another
// device) and at boot as a safety net. Skips calendar sync on purpose —
// re-adding calendar events here would duplicate them on every pull.
export async function reconcileNotifications() {
  if (!isNative()) return;
  try {
    const lang = translations[useI18nStore.getState().language] || translations.en;
    const now = Date.now();
    const today = new Date().toISOString().slice(0, 10);

    type TaskLike = { id: string; title: string; done: boolean; remindAt?: string | null };
    type ReminderLike = {
      id: string;
      label: string;
      times: string[];
      enabled: boolean;
      lastFired?: Record<string, string>;
    };

    const tasks = loadJSON<TaskLike[]>(STORAGE_KEYS.tasks, []);
    const reminders = loadJSON<ReminderLike[]>(STORAGE_KEYS.reminders, []);

    // One-shot task reminders that should be pending: open + in the future
    const wantTask = new Map<number, TaskLike>();
    for (const t of tasks) {
      if (!t.done && t.remindAt && new Date(t.remindAt).getTime() > now) {
        wantTask.set(hashId("task:" + t.id), t);
      }
    }

    // Daily nudge slots that should exist at all (enabled reminders)…
    const validNudgeIds = new Set<number>();
    // …and the subset to (re)schedule now (skip slots already fired today —
    // boot cleanup cancels those; the Reminders UI re-arms them next day)
    const scheduleNudge = new Map<number, { r: ReminderLike; time: string }>();
    for (const r of reminders) {
      if (!r.enabled) continue;
      r.times.forEach((time, idx) => {
        const id = hashId(`rem:${r.id}:${idx}`);
        validNudgeIds.add(id);
        if (r.lastFired?.[time] !== today) scheduleNudge.set(id, { r, time });
      });
    }

    const pending = await LocalNotifications.getPending();
    const pendingIds = new Set<number>();
    const stale: number[] = [];
    for (const n of pending.notifications) {
      pendingIds.add(n.id);
      const extra = (n.extra ?? {}) as { type?: string; taskId?: string };
      // Only touch canonical ids — postponed reminders use throwaway ids and
      // should be left to fire.
      if (extra.type === "task" && extra.taskId && n.id === hashId("task:" + extra.taskId)) {
        if (!wantTask.has(n.id)) stale.push(n.id);
      } else if (extra.type === "nudge") {
        if (!validNudgeIds.has(n.id)) stale.push(n.id);
      }
    }
    if (stale.length > 0) await cancelNative(stale);

    let added = 0;
    for (const [id, t] of wantTask) {
      if (!pendingIds.has(id)) {
        await scheduleNativeAt(id, t.title, lang.reminder_title, new Date(t.remindAt!), false, t.id);
        added++;
      }
    }
    for (const [id, { r, time }] of scheduleNudge) {
      if (!pendingIds.has(id)) {
        const [h, m] = time.split(":").map(Number);
        await scheduleNativeDaily(id, r.label, lang.gentle_nudge_emoji, h, m, false, r.id);
        added++;
      }
    }
    console.log(`[Native] Reconciled notifications: +${added} scheduled, -${stale.length} cancelled`);
  } catch (e) {
    console.warn("[Native] reconcileNotifications failed", e);
  }
}

// Call once at app boot
export async function initNative() {
  if (!isNative()) return;
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
        } else if (actionId === 'postpone') {
          const nextAt = new Date(Date.now() + 15 * 60 * 1000);
          const id = hashId("task:" + taskId + Date.now()); // New ID to avoid conflicts
          void scheduleNativeAt(id, extra.title, "Postponed reminder", nextAt, false, taskId);
        }
      } else if (extra.type === 'nudge') {
        const nudgeId = extra.nudgeId;
        const time = extra.time;
        if (actionId === 'done') {
          const reminders = loadJSON<any[]>(STORAGE_KEYS.reminders, []);
          const dateStr = new Date().toISOString().slice(0, 10);
          const updated = reminders.map(r =>
            r.id === nudgeId ? { ...r, lastFired: { ...r.lastFired, [time]: dateStr } } : r
          );
          saveJSON(STORAGE_KEYS.reminders, updated);
          window.dispatchEvent(new CustomEvent('ff.data_updated'));
        } else if (actionId === 'postpone') {
          const nextAt = new Date(Date.now() + 15 * 60 * 1000);
          const id = hashId("nudge:" + nudgeId + Date.now());
          void scheduleNativeAt(id, extra.title, "Postponed nudge", nextAt, false);
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
  // or nudges that have already been fired today.
  try {
    const tasks = loadJSON<any[]>(STORAGE_KEYS.tasks, []);
    const doneTaskIds = tasks.filter(t => t.done).map(t => hashId("task:" + t.id));

    const reminders = loadJSON<any[]>(STORAGE_KEYS.reminders, []);
    const dateStr = new Date().toISOString().slice(0, 10);
    const firedNudgeIds: number[] = [];

    reminders.forEach(r => {
      r.times.forEach((time: string, idx: number) => {
        if (r.lastFired[time] === dateStr) {
          firedNudgeIds.push(hashId(`rem:${r.id}:${idx}`));
        }
      });
    });

    const toCancel = [...doneTaskIds, ...firedNudgeIds];
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
    });
    void App.addListener("resume", () => {
      void syncWidgetTicks();
    });
    await syncWidgetTicks();
  } catch (e) {
    console.warn("[Native] Widget sync setup failed", e);
  }

  // Safety net: re-arm notifications from storage (covers items synced from
  // other devices before this ran, and schedules lost to device reboots)
  void reconcileNotifications();

  try {
    await StatusBar.setOverlaysWebView({ overlay: false });
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
    if (theme === "dark") {
      await StatusBar.setStyle({ style: Style.Dark });
      await StatusBar.setBackgroundColor({ color: "#0F1115" });
    } else {
      await StatusBar.setStyle({ style: Style.Light });
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
      await addToCalendar(task.title, new Date(task.remindAt));
    }
  }
  for (const reminder of reminders) {
    if (reminder.enabled) {
      await deleteFromCalendar(reminder.label);
      for (const timeStr of reminder.times) {
        const [h, m] = timeStr.split(":").map(Number);
        const at = new Date();
        at.setHours(h, m, 0, 0);
        if (at.getTime() < Date.now()) at.setDate(at.getDate() + 1);
        await addToCalendar(reminder.label, at);
      }
    }
  }
  console.log("[Native] Bulk calendar sync complete.");
}
