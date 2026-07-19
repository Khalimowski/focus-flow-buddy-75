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

let syncInFlight = false;

/** Pull remote changes, then push local-only keys. Safe to call repeatedly. */
export async function fullSync(): Promise<void> {
  const client = getNeonClient();
  if (!client || !currentUser || syncInFlight) return;
  syncInFlight = true;
  try {
    await doFullSync(client);
  } finally {
    syncInFlight = false;
  }
}

async function doFullSync(client: NonNullable<ReturnType<typeof getNeonClient>>): Promise<void> {
  if (!currentUser) return;
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
    // Items created/completed on another device: align this device's
    // scheduled notifications with the fresh data (no-op on web).
    void import("./native").then((m) => m.reconcileNotifications());
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
  // have pushed changes). Small throttle so rapid tab-switching doesn't spam.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && currentUser && Date.now() - lastPullAt > 5_000) {
      void fullSync();
    }
  });

  // Poll while the app is open and visible, so two devices used side by side
  // see each other's changes within ~15s without needing a refocus.
  const PULL_INTERVAL_MS = 15_000;
  setInterval(() => {
    if (
      document.visibilityState === "visible" &&
      currentUser &&
      Date.now() - lastPullAt >= PULL_INTERVAL_MS - 500
    ) {
      void fullSync();
    }
  }, PULL_INTERVAL_MS);

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
  // Pull remote data BEFORE announcing the sign-in: the app mounts on the
  // auth-changed event, and mounting mid-pull lets components save their
  // (still empty) state over the freshly signed-in user's cloud data.
  await fullSync();
  notifyAuthChanged();
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
  await fullSync();
  notifyAuthChanged();
  return user;
}

/**
 * Google sign-in. Native: Credential Manager picker → ID token exchanged with
 * Neon Auth (no redirect, works inside Capacitor's https://localhost). Web:
 * standard OAuth redirect through Neon Auth — returns null because the page
 * navigates away; initSync picks up the session when the callback lands.
 * Requires the Google provider to be enabled for the project in Neon Auth.
 */
export async function signInWithGoogle(): Promise<SyncUser | null> {
  const client = getNeonClient();
  if (!client) throw new Error("Not available during SSR");
  const auth = client.auth as unknown as {
    signIn: {
      social: (d: {
        provider: "google";
        callbackURL?: string;
        idToken?: { token: string; accessToken?: string };
      }) => Promise<{ data?: { url?: string } | null; error?: { message?: string } | null }>;
    };
  };

  const { isNative } = await import("./native");
  if (isNative()) {
    const { googleAuthLogin } = await import("./google");
    const { idToken, accessToken } = await googleAuthLogin();
    const res = await auth.signIn.social({
      provider: "google",
      idToken: { token: idToken, accessToken },
    });
    if (res?.error) throw new Error(res.error.message || "Google sign-in failed");
    const user = await fetchSessionUser();
    if (!user) throw new Error("Google sign-in failed");
    currentUser = user;
    // Same ordering constraint as signIn: pull BEFORE announcing, or mounting
    // components can save empty state over the user's cloud data.
    await fullSync();
    notifyAuthChanged();
    return user;
  }

  const res = await auth.signIn.social({
    provider: "google",
    callbackURL: window.location.origin,
  });
  if (res?.error) throw new Error(res.error.message || "Google sign-in failed");
  // The auth client normally redirects on its own; this is the fallback.
  if (res?.data?.url) window.location.assign(res.data.url);
  return null;
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

/**
 * Permanently delete a user's cloud data and account (self-service, used by
 * the public /delete-account page required by Google Play). Signs in with the
 * given credentials, removes every user_data row (while the session can still
 * pass RLS), then deletes the auth user itself. Returns whether the auth
 * account could be deleted — the hosted auth config may not expose
 * deleteUser, in which case the data is gone but the login remains and the
 * page shows an email fallback.
 */
export async function deleteAccount(email: string, password: string): Promise<{ accountDeleted: boolean }> {
  const client = getNeonClient();
  if (!client) throw new Error("Not available during SSR");

  const res = (await client.auth.signIn.email({ email, password })) as {
    error?: { message?: string } | null;
  };
  if (res?.error) throw new Error(res.error.message || "Sign-in failed");

  const del = await client.from("user_data").delete().neq("key", "");
  if (del.error) throw new Error(del.error.message || "Data deletion failed");

  let accountDeleted = false;
  try {
    const auth = client.auth as unknown as {
      deleteUser: (d: { password: string }) => Promise<{ error?: { message?: string } | null }>;
    };
    const delUser = await auth.deleteUser({ password });
    accountDeleted = !delUser?.error;
    if (delUser?.error) console.warn("[Sync] deleteUser refused:", delUser.error.message);
  } catch (e) {
    console.warn("[Sync] deleteUser not available:", e);
  }

  try {
    await client.auth.signOut(); // session may already be revoked by deleteUser
  } catch { /* ignore */ }
  currentUser = null;
  dirty.clear();
  window.localStorage.removeItem(META_KEY);
  notifyAuthChanged();
  return { accountDeleted };
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
