import { LocalNotifications } from "@capacitor/local-notifications";
import { StatusBar, Style } from "@capacitor/status-bar";
import { CapacitorCalendar } from "@ebarooni/capacitor-calendar";
import { Capacitor } from "@capacitor/core";

// Capacitor runtime helpers — isNative() guards all plugin calls, making static imports safe in browser & SSR

export const isNative = (): boolean => {
  if (typeof window === "undefined") return false;
  try {
    return Capacitor.isNativePlatform();
  } catch (e) {
    return false;
  }
};

// Use direct plugin access to avoid "thenable" issues with Proxy objects
const getCalendar = () => (Capacitor as any).Plugins.CapacitorCalendar || CapacitorCalendar;
const getNotifications = () => (Capacitor as any).Plugins.LocalNotifications || LocalNotifications;
const getStatusBar = () => (Capacitor as any).Plugins.StatusBar || StatusBar;

let channelEnsured = false;

export async function ensureNativeNotifPermission(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    console.log("[Notif] Checking permissions...");
    const notifications = getNotifications();
    const cur = await notifications.checkPermissions();

    if (cur.display !== "granted") {
      const req = await notifications.requestPermissions();
      if (req.display !== "granted") return false;
    }

    // Android 12+ exact alarms
    try {
      if (notifications.checkExactNotificationSetting) {
        const exact = await notifications.checkExactNotificationSetting();
        if (exact.exact_alarm !== "granted") {
          await notifications.changeExactNotificationSetting();
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
  if (!isNative()) {
    console.warn("[Perm] Not a native platform, calendar sync unavailable");
    return false;
  }

  const calendar = getCalendar();
  const isGranted = (s: any) => s === "granted" || s === "GRANTED";

  try {
    console.log("[Perm] Checking calendar permissions...");
    const check = await calendar.checkAllPermissions();
    console.log("[Perm] checkAllPermissions raw:", JSON.stringify(check));

    // The plugin returns permissions at top level and sometimes under "result"
    const readTop = (check as any).readCalendar;
    const writeTop = (check as any).writeCalendar;
    const res = (check as any).result || {};
    const readRes = res.readCalendar || res.READ_CALENDAR;
    const writeRes = res.writeCalendar || res.WRITE_CALENDAR;

    if ((isGranted(readTop) || isGranted(readRes)) && (isGranted(writeTop) || isGranted(writeRes))) {
      console.log("[Perm] Calendar permissions already granted");
      return true;
    }
  } catch (e) {
    console.warn("[Perm] checkAllPermissions failed, attempting direct check...", e);
    try {
      // Fallback: check individually if the bulk check failed
      const readState = await calendar.checkPermission({ scope: 'readCalendar' as any });
      const writeState = await calendar.checkPermission({ scope: 'writeCalendar' as any });
      if (isGranted((readState as any).result) && isGranted((writeState as any).result)) return true;
    } catch (e2) {
      console.error("[Perm] Individual check failed too", e2);
    }
  }

  try {
    console.log("[Perm] Requesting full calendar access...");
    // Attempt full access first
    const req = await calendar.requestFullCalendarAccess();
    console.log("[Perm] requestFullCalendarAccess result:", JSON.stringify(req));
    if (isGranted((req as any).result)) return true;

    // Last ditch: request individually
    console.log("[Perm] Requesting permissions individually...");
    await calendar.requestReadOnlyCalendarAccess();
    const finalReq = await calendar.requestWriteOnlyCalendarAccess();
    return isGranted((finalReq as any).result);
  } catch (e) {
    console.error("[Perm] Calendar request failed", e);
    return false;
  }
}

async function ensureChannel() {
  if (!isNative() || channelEnsured) return;
  try {
    await getNotifications().createChannel({
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
    const notifications = getNotifications();
    await notifications.schedule({
      notifications: [
        {
          id: notifId,
          title,
          body: body ?? "",
          schedule: { at: new Date(Date.now() + 1000), allowWhileIdle: true },
          channelId: "boink_channel_v8",
          smallIcon: "ic_stat_icon",
          sound: "boink",
        },
      ],
    });
    console.log("Immediate notification scheduled.");
  } catch (e) {
    console.error("nativeNotify failed", e);
  }
}

// Schedule a one-shot notification at a future date
export async function scheduleNativeAt(id: number, title: string, body: string, at: Date, syncCalendar = false) {
  if (!isNative()) return;
  try {
    await ensureChannel();
    console.log(`[Native] Scheduling notification at ${at.toISOString()}: ${title} (id: ${id})`);
    const notifications = getNotifications();
    await notifications.schedule({
      notifications: [
        {
          id,
          title,
          body,
          schedule: { at, allowWhileIdle: true },
          channelId: "boink_channel_v8",
          smallIcon: "ic_stat_icon",
          sound: "boink",
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
export async function scheduleNativeDaily(id: number, title: string, body: string, hour: number, minute: number, syncCalendar = false) {
  if (!isNative()) return;
  try {
    await ensureChannel();
    console.log(`Scheduling daily notification at ${hour}:${minute}: ${title} (id: ${id})`);
    const notifications = getNotifications();
    await notifications.schedule({
      notifications: [
        {
          id,
          title,
          body,
          schedule: { on: { hour, minute }, repeats: true, allowWhileIdle: true },
          channelId: "boink_channel_v8",
          smallIcon: "ic_stat_icon",
          sound: "boink",
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

    const endDate = new Date(date.getTime() + 15 * 60 * 1000);
    console.log(`[Sync] Adding: ${title}`);

    const calendar = getCalendar();
    const res = await calendar.createEvent({
      title,
      startDate: date.getTime(),
      endDate: endDate.getTime(),
    });

    return (res as any).id;
  } catch (e) {
    console.warn("[Sync] Add failed", e);
    return null;
  }
}

export async function deleteFromCalendar(title: string) {
  if (!isNative()) return;
  try {
    const hasPerm = await ensureCalendarPermission();
    if (!hasPerm) return;

    console.log(`[Sync] Deleting: ${title}`);
    const calendar = getCalendar();
    const searchRes = await calendar.listEventsInRange({
      from: Date.now() - 30 * 24 * 60 * 60 * 1000,
      to: Date.now() + 365 * 24 * 60 * 60 * 1000,
    });

    const toDelete = ((searchRes as any).result || [])
      .filter((ev: any) => ev.title === title)
      .map((ev: any) => ev.id);

    if (toDelete.length > 0) {
      await calendar.deleteEventsById({ ids: toDelete });
      console.log(`[Sync] Deleted ${toDelete.length} events`);
    }
  } catch (e) {
    console.error("[Sync] Delete failed", e);
  }
}

export async function cancelNative(ids: number[]) {
  if (!isNative() || ids.length === 0) return;
  try {
    console.log("Cancelling notifications:", ids);
    const notifications = getNotifications();
    await notifications.cancel({ notifications: ids.map((id) => ({ id })) });
  } catch (e) {
    console.error("cancelNative failed", e);
  }
}

// Stable numeric id from a string (for plugin id field)
export function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 2_000_000_000;
}

// Call once at app boot
export async function initNative() {
  if (!isNative()) return;
  console.log("[Native] Initializing features...");
  // Use .then() instead of await to avoid potential issues with thenable proxies
  ensureNativeNotifPermission().catch(e => console.error(e));
  ensureChannel().catch(e => console.error(e));

  try {
    const statusBar = getStatusBar();
    statusBar.setOverlaysWebView({ overlay: false }).catch((e: any) => console.warn(e));
    statusBar.setBackgroundColor({ color: "#0F1115" }).catch((e: any) => console.warn(e));
  } catch (e) {
    console.warn("[Native] StatusBar overlay setup failed", e);
  }
}

// Dynamically update status bar based on theme
export async function updateStatusBar(theme: "light" | "dark") {
  if (!isNative()) return;
  try {
    const statusBar = getStatusBar();
    if (theme === "dark") {
      statusBar.setStyle({ style: Style.Dark }).catch((e: any) => console.warn(e));
      statusBar.setBackgroundColor({ color: "#0F1115" }).catch((e: any) => console.warn(e));
    } else {
      statusBar.setStyle({ style: Style.Light }).catch((e: any) => console.warn(e));
      statusBar.setBackgroundColor({ color: "#F9FAFB" }).catch((e: any) => console.warn(e));
    }
    console.log(`[Native] Status bar updated for ${theme} mode`);
  } catch (e) {
    console.warn("[Native] updateStatusBar failed", e);
  }
}

export async function syncAllToCalendar(tasks: any[], reminders: any[]) {
  if (!isNative()) return;
  const hasPerm = await ensureCalendarPermission();
  if (!hasPerm) return;

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
  console.log("[Native] Bulk sync complete.");
}


