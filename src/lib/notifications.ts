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

import { isNative, ensureNativeNotifPermission, nativeNotify } from "./native";

let audioContext: AudioContext | null = null;
let audioUnlocked = false;

function getAudioContext() {
  if (typeof window === "undefined") return null;
  const AudioContextCtor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  audioContext ??= new AudioContextCtor();
  return audioContext;
}

export async function unlockNotificationAudio() {
  const ctx = getAudioContext();
  if (!ctx) return false;
  if (ctx.state === "suspended") await ctx.resume();
  audioUnlocked = ctx.state === "running";
  return audioUnlocked;
}

function playNotificationSound() {
  const ctx = getAudioContext();
  if (!ctx || !audioUnlocked || ctx.state !== "running") return;

  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.16, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
  gain.connect(ctx.destination);

  [660, 880].forEach((frequency, index) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency, now + index * 0.11);
    osc.connect(gain);
    osc.start(now + index * 0.11);
    osc.stop(now + 0.34 + index * 0.08);
  });
}

export async function ensurePermission(): Promise<NotificationPermission> {
  void unlockNotificationAudio();
  if (isNative()) {
    const ok = await ensureNativeNotifPermission();
    return ok ? "granted" : "denied";
  }
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
  if (isNative()) return "granted";
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
  // Native (Android via Capacitor)
  if (isNative()) {
    void nativeNotify(input.title, input.body);
    return n;
  }
  playNotificationSound();
  // Fire system
  if (
    typeof window !== "undefined" &&
    "Notification" in window &&
    Notification.permission === "granted"
  ) {
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
