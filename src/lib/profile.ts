// User profile collected by the AI coach's short interview. Lives under
// STORAGE_KEYS.profile and mirrors to the cloud like the other synced keys.
import { loadJSON, saveJSON, STORAGE_KEYS } from "./storage";

export type LifeStage = "student" | "working" | "shift" | "other";

export interface UserProfile {
  lifeStage: LifeStage | null;
  workStart: string | null; // "HH:mm" — start of the usual busy block (work/school)
  workEnd: string | null; // "HH:mm"
  sports: string[]; // canonical sport ids (see SPORT_OPTIONS in AICoach)
  sportDays: number[]; // JS getDay() numbers: 0 = Sunday … 6 = Saturday
  completedAt: number | null; // interview finished (possibly skipped); null = never taken
}

export function emptyProfile(): UserProfile {
  return {
    lifeStage: null,
    workStart: null,
    workEnd: null,
    sports: [],
    sportDays: [],
    completedAt: null,
  };
}

export function loadProfile(): UserProfile {
  // Spread over the empty shape so partial blobs from older versions keep all fields
  return { ...emptyProfile(), ...loadJSON<Partial<UserProfile>>(STORAGE_KEYS.profile, {}) };
}

export function saveProfile(profile: UserProfile): void {
  saveJSON(STORAGE_KEYS.profile, profile);
}

export function hasCompletedInterview(profile: UserProfile): boolean {
  return profile.completedAt !== null;
}

const toMinutes = (time: string): number => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

const toTime = (minutes: number): string => {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, minutes));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
};

/** "HH:mm" shifted by deltaMinutes, clamped to the same day. */
export function shiftTime(time: string, deltaMinutes: number): string {
  return toTime(toMinutes(time) + deltaMinutes);
}

/** Midpoint between two "HH:mm" times. */
export function midTime(a: string, b: string): string {
  return toTime(Math.round((toMinutes(a) + toMinutes(b)) / 2));
}

/** The earlier of two "HH:mm" times. */
export function minTime(a: string, b: string): string {
  return toMinutes(a) <= toMinutes(b) ? a : b;
}
