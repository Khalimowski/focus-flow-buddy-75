import { LocalNotifications } from "@capacitor/local-notifications";
import { StatusBar, Style } from "@capacitor/status-bar";
import { CapacitorCalendar } from "capacitor-calendar";

// Capacitor runtime helpers — safe in browser & SSR (lazy imports)

export const isNative = (): boolean => {
  if (typeof window === "undefined") return false;
  const cap = (window as any).Capacitor;
  return !!cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform();
};

let permissionGranted = false;
let channelEnsured = false;

export async function ensureNativeNotifPermission(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    console.log("Checking notification permissions...");
    const cur = await LocalNotifications.checkPermissions();
    console.log("Current permissions:", JSON.stringify(cur));

    if (cur.display !== "granted") {
      console.log("Requesting display permissions...");
      const req = await LocalNotifications.requestPermissions();
      if (req.display !== "granted") {
        console.warn("Display permission denied");
        return false;
      }
    }

    // Check exact alarm permission for Android 12+
    try {
      const exact = await LocalNotifications.checkExactNotificationSetting();
      console.log("Exact alarm setting:", JSON.stringify(exact));
      if (exact.exact_alarm !== "granted") {
        console.log("Requesting exact alarm permission via settings...");
        await LocalNotifications.changeExactNotificationSetting();
      }
    } catch (exactErr) {
      console.warn("Failed to check/request exact alarm setting", exactErr);
    }

    permissionGranted = true;
    return true;
  } catch (e) {
    console.error("Permission check failed", e);
    return false;
  }
}

export async function ensureCalendarPermission(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    console.log("Checking calendar permissions...");
    const cur = await CapacitorCalendar.checkPermissions();
    console.log("Current calendar permissions:", JSON.stringify(cur));

    if (cur.calendar !== "granted") {
      console.log("Requesting calendar permissions...");
      const req = await CapacitorCalendar.requestPermissions();
      if (req.calendar !== "granted") {
        console.warn("Calendar permission denied");
        return false;
      }
    }
    return true;
  } catch (e) {
    console.error("Calendar permission check failed", e);
    return false;
  }
}

async function ensureChannel() {
  if (!isNative() || channelEnsured) return;
  try {
    console.log("Ensuring notification channel v8...");
    await LocalNotifications.createChannel({
      id: "boink_channel_v8",
      name: "Nudge Notifications",
      description: "Channel for your calm nudges and reminders",
      importance: 5, // high
      visibility: 1, // public
      sound: "boink",
      vibration: true,
    });
    channelEnsured = true;
    console.log("Notification channel v8 ensured.");
  } catch (e) {
    console.error("Channel creation failed", e);
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
    const hasPerm = await ensureCalendarPermission();
    if (!hasPerm) {
      console.warn("Cannot add to calendar: Permission not granted");
      return;
    }

    // End date is 15 minutes after start by default for a nudge
    const endDate = new Date(date.getTime() + 15 * 60 * 1000);

    console.log(`Adding event to calendar: ${title} at ${date.toISOString()}`);
    const res = await CapacitorCalendar.createEvent({
      title,
      startDate: date.getTime(),
      endDate: endDate.getTime(),
      notes: `Focus Flow: ${title}`,
    });
    console.log("Calendar event created successfully, id:", res.id);
    return res.id;
  } catch (e) {
    console.warn("Failed to create calendar event", e);
    return null;
  }
}

// Search and delete calendar events by title
export async function deleteFromCalendar(title: string) {
  if (!isNative()) return;
  try {
    const hasPerm = await ensureCalendarPermission();
    if (!hasPerm) {
      console.warn("[Calendar] Cannot delete: Permission not granted");
      return;
    }

    console.log(`[Calendar] Searching for events to delete with title: "${title}"`);
    // Search for events with this title in a broad range
    const searchRes = await CapacitorCalendar.findEvent({
      title,
      startDate: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days back
      endDate: Date.now() + 365 * 24 * 60 * 60 * 1000,   // 1 year forward
    });

    if (searchRes && searchRes.events && searchRes.events.length > 0) {
      console.log(`[Calendar] Found ${searchRes.events.length} events to delete`);
      for (const ev of searchRes.events) {
        if (ev.id) {
          console.log(`[Calendar] Deleting event ID: ${ev.id}`);
          await CapacitorCalendar.deleteEventById({ id: String(ev.id) });
        }
      }
      console.log("[Calendar] Deletion cleanup complete.");
    } else {
      console.log("[Calendar] No matching events found to delete.");
    }
  } catch (e) {
    console.error("[Calendar] deleteFromCalendar failed", e);
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

// Stable numeric id from a string (for plugin id field)
export function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 2_000_000_000;
}

// Call once at app boot
export async function initNative() {
  if (!isNative()) return;
  console.log("Initializing native features...");
  await ensureNativeNotifPermission();
  await ensureChannel();
  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#0F1115" });
    console.log("Status bar initialized.");
  } catch (e) {
    console.warn("StatusBar initialization failed", e);
  }
}
