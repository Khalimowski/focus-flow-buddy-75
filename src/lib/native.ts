import { LocalNotifications } from "@capacitor/local-notifications";
import { StatusBar, Style } from "@capacitor/status-bar";

// Capacitor runtime helpers — safe in browser & SSR (lazy imports)

export const isNative = (): boolean => {
  if (typeof window === "undefined") return false;
  const cap = (window as any).Capacitor;
  return !!cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform();
};

let permissionGranted = false;

export async function ensureNativeNotifPermission(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const cur = await LocalNotifications.checkPermissions();

    if (cur.display !== "granted") {
      const req = await LocalNotifications.requestPermissions();
      if (req.display !== "granted") return false;
    }

    // Check exact alarm permission for Android 12+
    const exact = await LocalNotifications.checkExactNotificationSetting();
    if (exact.exact_alarm !== "granted") {
      console.log("Requesting exact alarm permission...");
      await LocalNotifications.changeExactNotificationSetting();
    }

    permissionGranted = true;
    return true;
  } catch (e) {
    console.error("Permission check failed", e);
    return false;
  }
}

async function ensureChannel() {
  if (!isNative()) return;
  try {
    await LocalNotifications.createChannel({
      id: "boink_channel_v5",
      name: "Nudge Notifications",
      description: "Channel for your calm nudges and reminders",
      importance: 5, // high
      visibility: 1, // public
      sound: "boink",
      vibration: true,
    });
  } catch (e) {
    console.error("Channel creation failed", e);
  }
}

// Fire an immediate native notification
export async function nativeNotify(title: string, body?: string) {
  if (!isNative()) return;
  try {
    await ensureChannel();
    await LocalNotifications.schedule({
      notifications: [
        {
          id: hashId(title + Date.now()),
          title,
          body: body ?? "",
          schedule: { at: new Date(Date.now() + 500), allowWhileIdle: true },
          channelId: "boink_channel_v5",
          smallIcon: "ic_stat_icon",
          sound: "boink",
        },
      ],
    });
  } catch (e) {
    console.error("nativeNotify failed", e);
  }
}

// Schedule a one-shot notification at a future date
export async function scheduleNativeAt(id: number, title: string, body: string, at: Date) {
  if (!isNative()) return;
  try {
    await ensureChannel();
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
  } catch (e) {
    console.error("scheduleNativeAt failed", e);
  }
}

// Schedule a daily-repeating notification at HH:mm
export async function scheduleNativeDaily(id: number, title: string, body: string, hour: number, minute: number) {
  if (!isNative()) return;
  try {
    await ensureChannel();
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
  } catch (e) {
    console.error("scheduleNativeDaily failed", e);
  }
}

export async function cancelNative(ids: number[]) {
  if (!isNative() || ids.length === 0) return;
  try {
    await LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) });
  } catch {
    /* ignore */
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
  await ensureNativeNotifPermission();
  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#0F1115" });
  } catch {
    /* ignore */
  }
}
