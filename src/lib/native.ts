import { LocalNotifications } from "@capacitor/local-notifications";
import { StatusBar, Style } from "@capacitor/status-bar";

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

async function ensureChannel() {
  if (!isNative() || channelEnsured) return;
  try {
    console.log("Ensuring notification channel v5...");
    await LocalNotifications.createChannel({
      id: "boink_channel_v5",
      name: "Nudge Notifications",
      description: "Channel for your calm nudges and reminders",
      importance: 5, // high
      visibility: 1, // public
      sound: "boink",
      vibration: true,
    });
    channelEnsured = true;
    console.log("Notification channel v5 ensured.");
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
          channelId: "boink_channel_v5",
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
export async function scheduleNativeAt(id: number, title: string, body: string, at: Date) {
  if (!isNative()) return;
  try {
    await ensureChannel();
    console.log(`Scheduling notification at ${at.toISOString()}: ${title} (id: ${id})`);
    await LocalNotifications.schedule({
      notifications: [
        {
          id,
          title,
          body,
          schedule: { at, allowWhileIdle: true },
          channelId: "boink_channel_v5",
          smallIcon: "ic_stat_icon",
          sound: "boink",
        }
      ],
    });
    console.log(`Notification ${id} scheduled.`);
  } catch (e) {
    console.error("scheduleNativeAt failed", e);
  }
}

// Schedule a daily-repeating notification at HH:mm
export async function scheduleNativeDaily(id: number, title: string, body: string, hour: number, minute: number) {
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
          channelId: "boink_channel_v5",
          smallIcon: "ic_stat_icon",
          sound: "boink",
        },
      ],
    });
    console.log(`Daily notification ${id} scheduled.`);
  } catch (e) {
    console.error("scheduleNativeDaily failed", e);
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
