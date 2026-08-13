// 24-hour time for the web build.
//
// Browsers render <input type="time"> (and toLocaleTimeString) in the *browser*
// locale, so an en-US browser shows "3:00 PM" no matter what the app wants. The
// native app is left alone — Android already has a system-wide 12/24h setting
// and its picker follows it — so everything here is gated on !isNative().

import { isNative } from "./native";

/** Web builds pin time to 24h; native follows the device's own setting. */
export const force24Hour = (): boolean => !isNative();

/** True when the browser's locale would render times with AM/PM. */
const browserUses12Hour = (): boolean => {
  try {
    const resolved = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
    }).resolvedOptions() as Intl.ResolvedDateTimeFormatOptions & { hourCycle?: string };
    if (resolved.hourCycle) return resolved.hourCycle === "h11" || resolved.hourCycle === "h12";
    return resolved.hour12 === true;
  } catch {
    return false;
  }
};

let maskedInput: boolean | null = null;

/**
 * Whether TimeInput has to replace the browser's native picker with a typed
 * HH:MM field. Only when the browser would otherwise render AM/PM — 24h locales
 * keep the native picker (and its calendar-style UI on phones).
 */
export const usesMaskedTimeInput = (): boolean => {
  if (maskedInput === null) {
    maskedInput = typeof window !== "undefined" && force24Hour() && browserUses12Hour();
  }
  return maskedInput;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

const clamp = (n: number, max: number) => (Number.isNaN(n) ? 0 : Math.min(Math.max(n, 0), max));

/** Splits any partially typed value into its hour / minute digits. */
const segments = (raw: string): [string, string] => {
  const cleaned = raw.replace(/[^\d:]/g, "");
  if (cleaned.includes(":")) {
    const [h, m = ""] = cleaned.split(":");
    return [h.slice(0, 2), m.replace(/:/g, "").slice(0, 2)];
  }
  // A second digit that can't belong to the hour means the first one was the
  // whole hour: typing 9 then 3 is 09:3, not 93 clamped down to 23.
  const digits = cleaned.length >= 2 && cleaned[0] > "2" ? `0${cleaned}` : cleaned;
  return [digits.slice(0, 2), digits.slice(2, 4)];
};

/**
 * Keeps a half-typed value legal while the user types: digits only, colon after
 * the hour, and no impossible segment (25:99 can never appear on screen).
 */
export const maskTimeDraft = (raw: string): string => {
  let [h, m] = segments(raw);
  if (h.length === 2) h = pad2(clamp(Number(h), 23));
  if (m.length === 2) m = pad2(clamp(Number(m), 59));
  if (m === "" && !raw.includes(":")) return h;
  return `${h}:${m}`;
};

/** Turns a draft into a storable "HH:MM" (or "" when nothing was entered). */
export const normalizeTimeDraft = (raw: string): string => {
  const [h, m] = segments(raw);
  if (h === "" && m === "") return "";
  return `${pad2(clamp(Number(h || "0"), 23))}:${pad2(clamp(Number(m || "0"), 59))}`;
};

/** True once a draft is a complete HH:MM and can be handed to the parent. */
export const isCompleteTime = (raw: string): boolean => /^\d{2}:\d{2}$/.test(raw);

/** Clock label for a timestamp — 24h on web, device locale on native. */
export const formatTimeOfDay = (value: Date | number | string): string => {
  const d = value instanceof Date ? value : new Date(value);
  if (force24Hour()) return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
