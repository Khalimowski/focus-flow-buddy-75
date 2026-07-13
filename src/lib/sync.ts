// Cross-device sync via Neon (Auth + Data API).
//
// Strategy: the app keeps using localStorage as its source of truth. Each
// synced key's JSON blob is mirrored to one row in the `user_data` table
// (per user, per key), protected by row-level security. Conflicts resolve
// per key, last-writer-wins.
//
// - On launch / sign-in: pull server rows; rows the server changed since our
//   last sync overwrite local. Keys with local data but no server row are pushed.
// - On every local save: push that key (debounced).
// - When the app regains focus: pull again (throttled).
import { getNeonClient } from "./neon";
import { STORAGE_KEYS, registerSaveListener } from "./storage";

const SYNC_KEYS: string[] = [
  STORAGE_KEYS.tasks,
  STORAGE_KEYS.reminders,
  STORAGE_KEYS.streak,
  STORAGE_KEYS.todo,
];

const META_KEY = "ff.sync.meta.v1";

// Fired after remote data has been written into localStorage; the UI
// remounts the affected views so components re-read storage.
export const REMOTE_UPDATE_EVENT = "ff.remote-update";

// Fired whenever the signed-in user changes (sign in/up/out), so the auth
// gate and settings can re-evaluate.
export const AUTH_CHANGED_EVENT = "ff.auth-changed";

function notifyAuthChanged() {
  window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT));
}

export type SyncUser = { id: string; email: string };

type UserDataRow = { key: string; value: unknown; updated_at: string };

let currentUser: SyncUser | null = null;
let initialized = false;
let lastPullAt = 0;
const dirty = new Set<string>();
let pushTimer: ReturnType<typeof setTimeout> | null = null;

function loadMeta(): Record<string, string> {
  try {
    return JSON.parse(window.localStorage.getItem(META_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveMeta(meta: Record<string, string>) {
  window.localStorage.setItem(META_KEY, JSON.stringify(meta));
}

async function fetchSessionUser(): Promise<SyncUser | null> {
  const client = getNeonClient();
  if (!client) return null;
  try {
    const res = (await client.auth.getSession()) as {
      data?: { user?: { id: string; email: string } | null } | null;
    };
    const user = res?.data?.user;
    return user ? { id: user.id, email: user.email } : null;
  } catch (e) {
    console.error("[Sync] getSession failed:", e);
    return null;
  }
}

export function getSyncUser(): SyncUser | null {
  return currentUser;
}

/** Pull remote changes, then push local-only keys. Safe to call repeatedly. */
export async function fullSync(): Promise<void> {
  const client = getNeonClient();
  if (!client || !currentUser) return;
  lastPullAt = Date.now();

  const { data, error } = await client
    .from("user_data")
    .select("key,value,updated_at")
    .in("key", SYNC_KEYS);
  if (error) {
    console.error("[Sync] Pull failed:", error);
    return;
  }

  const rows = (data ?? []) as UserDataRow[];
  const meta = loadMeta();
  const serverKeys = new Set<string>();
  let changed = false;

  for (const row of rows) {
    serverKeys.add(row.key);
    // Skip keys with unpushed local edits — our push below wins (LWW).
    if (meta[row.key] === row.updated_at || dirty.has(row.key)) continue;
    window.localStorage.setItem(row.key, JSON.stringify(row.value));
    meta[row.key] = row.updated_at;
    changed = true;
    if (row.key === STORAGE_KEYS.tasks) {
      window.dispatchEvent(new CustomEvent("ff.tasks_saved"));
    }
  }
  saveMeta(meta);

  // First device / new keys: local data the server has never seen.
  for (const key of SYNC_KEYS) {
    if (!serverKeys.has(key) && window.localStorage.getItem(key) !== null) {
      dirty.add(key);
    }
  }
  if (dirty.size > 0) await pushDirty();

  if (changed) {
    console.log("[Sync] Applied remote changes");
    window.dispatchEvent(new CustomEvent(REMOTE_UPDATE_EVENT));
  }
}

async function pushDirty(): Promise<void> {
  const client = getNeonClient();
  if (!client || !currentUser || dirty.size === 0) return;

  const keys = [...dirty];
  dirty.clear();
  const meta = loadMeta();

  for (const key of keys) {
    const raw = window.localStorage.getItem(key);
    if (raw === null) continue;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      continue;
    }
    const { data, error } = await client
      .from("user_data")
      .upsert({ key, value }, { onConflict: "user_id,key" })
      .select("updated_at");
    if (error) {
      console.error(`[Sync] Push failed for ${key}:`, error);
      dirty.add(key); // retry on next save/focus
      continue;
    }
    const updatedAt = (data as { updated_at: string }[] | null)?.[0]?.updated_at;
    if (updatedAt) meta[key] = updatedAt;
  }
  saveMeta(meta);
  console.log("[Sync] Pushed:", keys.join(", "));
}

function onLocalSave(key: string) {
  if (!currentUser || !SYNC_KEYS.includes(key)) return;
  dirty.add(key);
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushDirty();
  }, 800);
}

/** Call once at app startup (browser only). Resolves with the session user, if any. */
export async function initSync(): Promise<SyncUser | null> {
  if (initialized || typeof window === "undefined") return currentUser;
  initialized = true;

  registerSaveListener(onLocalSave);

  // Re-pull when the app comes back to the foreground (other device may
  // have pushed changes), at most once per 30s.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && currentUser && Date.now() - lastPullAt > 30_000) {
      void fullSync();
    }
  });

  currentUser = await fetchSessionUser();
  if (currentUser) await fullSync();
  return currentUser;
}

export async function signIn(email: string, password: string): Promise<SyncUser> {
  const client = getNeonClient();
  if (!client) throw new Error("Not available during SSR");
  const res = (await client.auth.signIn.email({ email, password })) as {
    error?: { message?: string } | null;
  };
  if (res?.error) throw new Error(res.error.message || "Sign-in failed");
  const user = await fetchSessionUser();
  if (!user) throw new Error("Sign-in failed");
  currentUser = user;
  notifyAuthChanged();
  await fullSync();
  return user;
}

export async function signUp(email: string, password: string): Promise<SyncUser> {
  const client = getNeonClient();
  if (!client) throw new Error("Not available during SSR");
  const res = (await client.auth.signUp.email({ email, password, name: email.split("@")[0] })) as {
    error?: { message?: string } | null;
  };
  if (res?.error) throw new Error(res.error.message || "Sign-up failed");
  // Some configs auto-create a session on sign-up; if not, sign in explicitly.
  let user = await fetchSessionUser();
  if (!user) {
    return signIn(email, password);
  }
  currentUser = user;
  notifyAuthChanged();
  await fullSync();
  return user;
}

/** Email a 6-digit password-reset code to the given address. */
export async function requestPasswordReset(email: string): Promise<void> {
  const client = getNeonClient();
  if (!client) throw new Error("Not available during SSR");
  const auth = client.auth as unknown as {
    forgetPassword: { emailOtp: (d: { email: string }) => Promise<{ error?: { message?: string } | null }> };
  };
  const res = await auth.forgetPassword.emailOtp({ email });
  if (res?.error) throw new Error(res.error.message || "Could not send reset email");
}

/** Complete a password reset with the emailed code. */
export async function resetPassword(email: string, otp: string, password: string): Promise<void> {
  const client = getNeonClient();
  if (!client) throw new Error("Not available during SSR");
  const auth = client.auth as unknown as {
    emailOtp: {
      resetPassword: (d: { email: string; otp: string; password: string }) => Promise<{ error?: { message?: string } | null }>;
    };
  };
  const res = await auth.emailOtp.resetPassword({ email, otp, password });
  if (res?.error) throw new Error(res.error.message || "Password reset failed");
}

/** Change the signed-in user's password. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const client = getNeonClient();
  if (!client) throw new Error("Not available during SSR");
  const auth = client.auth as unknown as {
    changePassword: (d: {
      currentPassword: string;
      newPassword: string;
      revokeOtherSessions?: boolean;
    }) => Promise<{ error?: { message?: string } | null }>;
  };
  const res = await auth.changePassword({ currentPassword, newPassword });
  if (res?.error) throw new Error(res.error.message || "Password change failed");
}

export async function signOut(): Promise<void> {
  const client = getNeonClient();
  if (!client) return;
  try {
    await client.auth.signOut();
  } catch (e) {
    console.error("[Sync] signOut failed:", e);
  }
  currentUser = null;
  dirty.clear();
  // Local data stays on the device; forget sync bookkeeping so a different
  // account doesn't inherit it.
  window.localStorage.removeItem(META_KEY);
  notifyAuthChanged();
}
