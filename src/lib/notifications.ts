// Notification helpers — system notifications + in-app event bus

export type InAppNotif = {
  id: string;
  title: string;
  body?: string;
  ts: number;
  read: boolean;
  kind: "task" | "reminder" | "timer" | "info";
};

type Listener = (n: InAppNotif) => void;
const listeners = new Set<Listener>();

export function subscribeNotif(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export async function ensurePermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) return "denied";
  if (Notification.permission === "default") {
    try {
      return await Notification.requestPermission();
    } catch {
      return "denied";
    }
  }
  return Notification.permission;
}

export function getPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export function notify(input: { title: string; body?: string; kind?: InAppNotif["kind"] }) {
  const n: InAppNotif = {
    id: crypto.randomUUID(),
    title: input.title,
    body: input.body,
    ts: Date.now(),
    read: false,
    kind: input.kind ?? "info",
  };
  // Fire in-app
  listeners.forEach((l) => l(n));
  // Fire system
  if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(input.title, {
        body: input.body,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: n.id,
        silent: false,
      });
    } catch {
      /* ignore */
    }
  }
  return n;
}
