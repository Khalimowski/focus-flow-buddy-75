// Capacitor runtime helpers — safe in browser & SSR (lazy imports)

export const isNative = (): boolean => {
  if (typeof window === "undefined") return false;
  const cap = (window as any).Capacitor;
  return !!cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform();
};

const getLocalNotifications = () => import("@capacitor/local-notifications").then(m => m.LocalNotifications);
const getStatusBar = () => import("@capacitor/status-bar").then(m => m.StatusBar);

async function getCapacitorCalendar() {
  const m = await import("@ebarooni/capacitor-calendar");
  return m.CapacitorCalendar;
}

let permissionGranted = false;
let channelEnsured = false;

export async function ensureNativeNotifPermission(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const LocalNotifications = await getLocalNotifications();
    console.log("[Notif] Checking permissions...");
    const cur = await LocalNotifications.checkPermissions();
    console.log("[Notif] Current:", JSON.stringify(cur));

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

    permissionGranted = true;
    return true;
  } catch (e) {
    console.error("[Notif] Permission check failed", e);
    return false;
  }
}

export async function ensureCalendarPermission(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const CapacitorCalendar = await getCapacitorCalendar();

    // Check current state
    const check = await CapacitorCalendar.checkAllPermissions();
    if (check.result.readWriteCalendar === "granted") return true;

    // Request full access
    console.log("[Perm] Requesting full access...");
    const res = await CapacitorCalendar.requestFullCalendarAccess();
    return res.result === "granted";
  } catch (e) {
    console.error("[Perm] Calendar permission failed", e);
    return false;
  }
}

async function ensureChannel() {
  if (!isNative() || channelEnsured) return;
  try {
    const LocalNotifications = await getLocalNotifications();
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
    const LocalNotifications = await getLocalNotifications();
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
    const LocalNotifications = await getLocalNotifications();
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
        }
      ],
    });

    // Add to calendar if enabled
    if (syncCalendar) {
      // NOTE: We don't await addToCalendar here to avoid blocking notification scheduling,
      // but in TaskList.tsx we should await deleteFromCalendar before calling this.
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
    const LocalNotifications = await getLocalNotifications();
    await ensureChannel();
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
        },
      ],
    });

    // For daily events, we just add the first instance to the calendar for now
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
    const CapacitorCalendar = await getCapacitorCalendar();
    const hasPerm = await ensureCalendarPermission();
    if (!hasPerm) return;

    const endDate = new Date(date.getTime() + 15 * 60 * 1000);
    console.log(`[Sync] Adding: ${title}`);

    const res = await CapacitorCalendar.createEvent({
      title,
      startDate: date.getTime(),
      endDate: endDate.getTime(),
    });

    return res.id;
  } catch (e) {
    console.warn("[Sync] Add failed", e);
    return null;
  }
}

export async function deleteFromCalendar(title: string) {
  if (!isNative()) return;
  try {
    const CapacitorCalendar = await getCapacitorCalendar();
    const hasPerm = await ensureCalendarPermission();
    if (!hasPerm) return;

    console.log(`[Sync] Deleting: ${title}`);
    const searchRes = await CapacitorCalendar.listEventsInRange({
      startTime: Date.now() - 30 * 24 * 60 * 60 * 1000,
      endTime: Date.now() + 365 * 24 * 60 * 60 * 1000,
    });

    const toDelete = (searchRes.result || [])
      .filter(ev => ev.title === title)
      .map(ev => ev.id);

    if (toDelete.length > 0) {
      await CapacitorCalendar.deleteEventsById({ ids: toDelete });
      console.log(`[Sync] Deleted ${toDelete.length} events`);
    }
  } catch (e) {
    console.error("[Sync] Delete failed", e);
  }
}


export async function cancelNative(ids: number[]) {
  if (!isNative() || ids.length === 0) return;
  try {
    const LocalNotifications = await getLocalNotifications();
    console.log("Cancelling notifications:", ids);
    await LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) });
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
  await ensureNativeNotifPermission();
  await ensureChannel();

  // Set default state
  try {
    const StatusBar = await getStatusBar();
    // Ensure the webview does not overlap the status bar area
    await StatusBar.setOverlaysWebView({ overlay: false });
    // Force a specific background color to ensure the status bar is solid
    await StatusBar.setBackgroundColor({ color: "#0F1115" });
  } catch (e) {
    console.warn("[Native] StatusBar overlay setup failed", e);
  }
}

// Dynamically update status bar based on theme
export async function updateStatusBar(theme: "light" | "dark") {
  if (!isNative()) return;
  try {
    const StatusBar = await getStatusBar();
    const { Style } = await import("@capacitor/status-bar");
    if (theme === "dark") {
      await StatusBar.setStyle({ style: Style.Dark });
      await StatusBar.setBackgroundColor({ color: "#0F1115" }); // Matches dark background
    } else {
      await StatusBar.setStyle({ style: Style.Light });
      await StatusBar.setBackgroundColor({ color: "#F9FAFB" }); // Matches light background
    }
    console.log(`[Native] Status bar updated for ${theme} mode`);
  } catch (e) {
    console.warn("[Native] updateStatusBar failed", e);
  }
}

/**
 * Performs a full sync of all active tasks/reminders to the system calendar.
 */
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

