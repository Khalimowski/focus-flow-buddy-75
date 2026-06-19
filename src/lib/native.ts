// Capacitor runtime helpers — safe in browser & SSR (lazy imports)

export const isNative = (): boolean => {
  if (typeof window === "undefined") return false;
  const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform();
};

let permissionGranted = false;
let nativeInitialized = false;

const NOTIFICATION_CHANNEL_ID = "focus_flow_alerts";

async function getLocalNotifications() {
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  return LocalNotifications;
}

async function ensureNativeNotificationSetup() {
  if (!isNative() || nativeInitialized) return;
  const LocalNotifications = await getLocalNotifications();

  try {
    await LocalNotifications.createChannel({
      id: NOTIFICATION_CHANNEL_ID,
      name: "Focus Flow alerts",
      description: "Focus timer, task, and reminder nudges",
      importance: 4,
      visibility: 1,
      lights: true,
      lightColor: "#7C9CFF",
      vibration: true,
    });
  } catch {
    /* channel may already exist, or platform may not support channels */
  }

  nativeInitialized = true;
}

export async function ensureNativeNotifPermission(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const LocalNotifications = await getLocalNotifications();
    const cur = await LocalNotifications.checkPermissions();
    if (cur.display === "granted") {
      permissionGranted = true;
      await ensureNativeNotificationSetup();
      return true;
    }
    const req = await LocalNotifications.requestPermissions();
    permissionGranted = req.display === "granted";
    if (permissionGranted) await ensureNativeNotificationSetup();
    return permissionGranted;
  } catch {
    return false;
  }
}

async function checkExactAlarmSetting() {
  if (!isNative()) return;
  try {
    const LocalNotifications = await getLocalNotifications();
    const settings = await LocalNotifications.checkExactNotificationSetting();
    if (settings.exact_alarm === "denied") {
      console.warn(
        "Exact alarm notifications are disabled for Focus Flow; scheduled notifications may be delayed.",
      );
    }
  } catch {
    /* exact alarm settings are Android-specific */
  }
}

// Fire an immediate native notification
export async function nativeNotify(title: string, body?: string) {
  if (!isNative()) return;
  try {
    if (!permissionGranted) await ensureNativeNotifPermission();
    if (!permissionGranted) return;
    const LocalNotifications = await getLocalNotifications();
    await LocalNotifications.schedule({
      notifications: [
        {
          id: Math.floor(Math.random() * 2_000_000_000),
          title,
          body: body ?? "",
          channelId: NOTIFICATION_CHANNEL_ID,
          schedule: { at: new Date(Date.now() + 1), allowWhileIdle: true },
        },
      ],
    });
  } catch {
    /* ignore */
  }
}

// Schedule a one-shot notification at a future date
export async function scheduleNativeAt(id: number, title: string, body: string, at: Date) {
  if (!isNative()) return;
  try {
    if (!permissionGranted) await ensureNativeNotifPermission();
    if (!permissionGranted) return;
    const LocalNotifications = await getLocalNotifications();
    await checkExactAlarmSetting();
    await LocalNotifications.schedule({
      notifications: [
        {
          id,
          title,
          body,
          channelId: NOTIFICATION_CHANNEL_ID,
          schedule: { at, allowWhileIdle: true },
        },
      ],
    });
  } catch {
    /* ignore */
  }
}

// Schedule a daily-repeating notification at HH:mm
export async function scheduleNativeDaily(
  id: number,
  title: string,
  body: string,
  hour: number,
  minute: number,
) {
  if (!isNative()) return;
  try {
    if (!permissionGranted) await ensureNativeNotifPermission();
    if (!permissionGranted) return;
    const LocalNotifications = await getLocalNotifications();
    await checkExactAlarmSetting();
    await LocalNotifications.schedule({
      notifications: [
        {
          id,
          title,
          body,
          channelId: NOTIFICATION_CHANNEL_ID,
          schedule: { on: { hour, minute }, repeats: true, allowWhileIdle: true },
        },
      ],
    });
  } catch {
    /* ignore */
  }
}

export async function cancelNative(ids: number[]) {
  if (!isNative() || ids.length === 0) return;
  try {
    const LocalNotifications = await getLocalNotifications();
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
  await checkExactAlarmSetting();
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#0F1115" });
  } catch {
    /* ignore */
  }
}
