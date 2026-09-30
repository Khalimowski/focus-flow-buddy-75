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
import { mergeRemoteStats } from "./stats";

const SYNC_KEYS: string[] = [
  STORAGE_KEYS.tasks,
  STORAGE_KEYS.reminders,
  // Recurring events (every 5 weeks, every year). A vaccination date is worth
  // as much on the tablet as on the phone, so it travels like the lists do.
  STORAGE_KEYS.recurring,
  STORAGE_KEYS.streak,
  STORAGE_KEYS.todo,
  STORAGE_KEYS.profile,
  // Carries the premium entitlement, which is how a purchase made on the phone
  // reaches the browser build. premium.ts only ever writes grants and explicit
  // revocations, so last-writer-wins can't clear it by accident.
  STORAGE_KEYS.premium,
  // Whether Gmail import / Calendar push are wanted — an account-level choice,
  // unlike the Google OAuth token, which stays on the device that granted it.
  STORAGE_KEYS.googlePrefs,
  // The Insights counters. Recorded on every device, read on the web — see the
  // merge exemption below, which is why this one key doesn't obey LWW.
  STORAGE_KEYS.stats,
];

/**
 * Keys that are *merged* with the local value on pull instead of replacing it.
 *
 * Last-writer-wins is right for the lists — one of the two edits genuinely is
 * the newer one. It is not right for counters: whichever device pushed last
 * would erase the other's tally for the same day. Each merger folds the pulled
 * row into local state and reports which side ended up out of date.
 */
const MERGE_ON_PULL: Record<
  string,
  (remoteValue: unknown) => { merged: unknown; changedLocal: boolean; changedRemote: boolean }
> = {
  [STORAGE_KEYS.stats]: mergeRemoteStats,
};

/**
 * Lists of `{ id, … }` items that are *merged* item by item when both sides
 * changed since the last sync, instead of one whole list replacing the other.
 *
 * Plain last-writer-wins on a whole list loses data the moment two devices
 * write between syncs: a task added on the laptop disappeared as soon as the
 * phone pushed its own (older) copy of the list — from the phone, the other
 * laptop, and the cloud alike. See mergeIdLists for the rules.
 */
const MERGE_LISTS = new Set<string>([
  STORAGE_KEYS.tasks,
  STORAGE_KEYS.todo,
  STORAGE_KEYS.reminders,
  STORAGE_KEYS.recurring,
]);

const META_KEY = "ff.sync.meta.v1";
// Keys saved locally but not yet confirmed by the server. Persisted, not just
// held in memory: a tab closed inside the push debounce, or a push that failed
// offline, used to forget the edit on reload — and the next pull then
// overwrote it with the server's copy.
const DIRTY_KEY = "ff.sync.dirty.v1";
// The last value of each MERGE_LISTS key known to match the server — the
// common ancestor mergeIdLists needs to tell "deleted here" from "added there".
const BASE_KEY = "ff.sync.base.v1";

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

type UserDataRow = { user_id?: string; key: string; value: unknown; updated_at: string };

let currentUser: SyncUser | null = null;
let initialized = false;
let lastPullAt = 0;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
// False until initSync has asked the server who is signed in. Saves made
// before that (the widget applying ticks at boot) still count as local edits.
let sessionResolved = false;

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function loadMeta(): Record<string, string> {
  return readJSON<Record<string, string>>(META_KEY, {});
}

function saveMeta(meta: Record<string, string>) {
  window.localStorage.setItem(META_KEY, JSON.stringify(meta));
}

// A Set whose every change is written through to localStorage.
const dirty = {
  load(): Set<string> {
    return new Set(readJSON<string[]>(DIRTY_KEY, []));
  },
  write(s: Set<string>) {
    window.localStorage.setItem(DIRTY_KEY, JSON.stringify([...s]));
  },
  has(key: string) {
    return this.load().has(key);
  },
  add(key: string) {
    const s = this.load();
    if (s.has(key)) return;
    s.add(key);
    this.write(s);
  },
  delete(key: string) {
    const s = this.load();
    if (!s.delete(key)) return;
    this.write(s);
  },
  keys(): string[] {
    return [...this.load()];
  },
  get size() {
    return this.load().size;
  },
  clear() {
    window.localStorage.removeItem(DIRTY_KEY);
  },
};

function setBase(key: string, value: unknown) {
  if (!MERGE_LISTS.has(key)) return;
  const base = readJSON<Record<string, unknown>>(BASE_KEY, {});
  base[key] = value;
  window.localStorage.setItem(BASE_KEY, JSON.stringify(base));
}

function getBase(key: string): unknown {
  return readJSON<Record<string, unknown>>(BASE_KEY, {})[key];
}

/** JSON with object keys sorted, so a jsonb round trip (which reorders keys) compares equal. */
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

type IdItem = { id: string | number };
function isIdList(v: unknown): v is IdItem[] {
  return (
    Array.isArray(v) &&
    v.every(
      (x) => x && typeof x === "object" && (typeof x.id === "string" || typeof x.id === "number"),
    )
  );
}

/**
 * Three-way merge of two edited copies of an id-keyed list against the copy
 * both started from (`base`, undefined for installs that predate it):
 *
 * - on both sides: this device's version if it edited the item, else the
 *   server's;
 * - only on the server: kept, unless this device deleted it and nobody has
 *   touched it since;
 * - only here: kept, unless another device deleted it and it's unchanged here.
 *
 * Without a base nothing can be told apart from a deletion, so it keeps the
 * union — an un-deleted item beats a lost one.
 */
export function mergeIdLists(base: unknown, local: unknown, remote: unknown): unknown {
  if (!isIdList(local) || !isIdList(remote)) return local;
  const baseById = isIdList(base) ? new Map(base.map((x) => [x.id, stableStringify(x)])) : null;
  const localById = new Map(local.map((x) => [x.id, x]));
  const remoteIds = new Set(remote.map((x) => x.id));
  const unchangedSinceBase = (x: IdItem) => baseById?.get(x.id) === stableStringify(x);

  const out: IdItem[] = [];
  for (const r of remote) {
    const l = localById.get(r.id);
    if (l) out.push(unchangedSinceBase(l) ? r : l);
    else if (!unchangedSinceBase(r)) out.push(r);
  }
  for (const l of local) {
    if (remoteIds.has(l.id)) continue;
    if (!unchangedSinceBase(l)) out.push(l);
  }
  return out;
}

// --- Sync status, for Settings ------------------------------------------------

export const SYNC_STATUS_EVENT = "ff.sync-status";
export type SyncStatus = { lastOkAt: number | null; failing: boolean };
let status: SyncStatus = { lastOkAt: null, failing: false };

export function getSyncStatus(): SyncStatus {
  return status;
}

function setStatus(ok: boolean) {
  status = ok ? { lastOkAt: Date.now(), failing: false } : { ...status, failing: true };
  window.dispatchEvent(new CustomEvent(SYNC_STATUS_EVENT));
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
    // A push that lost a race (another device wrote first) leaves its key
    // dirty and asks for another pass, which merges and pushes again.
    for (let pass = 0; pass < 3; pass++) {
      if (!(await doFullSync(client))) break;
    }
  } finally {
    syncInFlight = false;
  }
}

/** Returns true when a push hit a conflict and another pass is needed. */
async function doFullSync(client: NonNullable<ReturnType<typeof getNeonClient>>): Promise<boolean> {
  if (!currentUser) return false;
  lastPullAt = Date.now();

  // user_id is filtered explicitly and selected back deliberately. RLS already
  // scopes this to the signed-in user, but relying on it alone means a policy
  // that ever fails open silently hands every account everyone else's data —
  // including the premium entitlement, which would look like "everyone is
  // suddenly premium". Belt and braces on both sides of the wire.
  const { data, error } = await client
    .from("user_data")
    .select("user_id,key,value,updated_at")
    .eq("user_id", currentUser.id)
    .in("key", SYNC_KEYS);
  if (error) {
    console.error("[Sync] Pull failed:", error);
    setStatus(false);
    return false;
  }
  setStatus(true);

  const rows = (data ?? []) as UserDataRow[];
  const meta = loadMeta();
  const serverKeys = new Set<string>();
  let changed = false;

  for (const row of rows) {
    // Never write another account's row into this device's storage.
    if (row.user_id !== undefined && row.user_id !== currentUser.id) {
      console.error(
        "[Sync] Discarded a row belonging to another user — check the RLS policy on user_data",
        { key: row.key },
      );
      continue;
    }
    serverKeys.add(row.key);

    const merge = MERGE_ON_PULL[row.key];
    if (merge) {
      // Unlike the LWW path this runs even with unpushed local edits — that's
      // the whole point: both sides' counts have to survive.
      if (meta[row.key] === row.updated_at && !dirty.has(row.key)) continue;
      const { merged, changedLocal, changedRemote } = merge(row.value);
      if (changedLocal) {
        window.localStorage.setItem(row.key, JSON.stringify(merged));
        changed = true;
      }
      meta[row.key] = row.updated_at;
      // Anything the server's copy was missing goes straight back up; after
      // that round trip both sides agree and this stops firing.
      if (changedRemote) dirty.add(row.key);
      else dirty.delete(row.key);
      continue;
    }

    // Nothing new on the server since we last synced this key.
    if (meta[row.key] === row.updated_at) continue;

    if (dirty.has(row.key)) {
      // Both sides changed. Lists merge item by item; anything else keeps
      // the local edit (LWW — it's the newer one). Either way, adopting the
      // server's updated_at is what lets the push below pass its check.
      if (MERGE_LISTS.has(row.key)) {
        const local = readJSON<unknown>(row.key, null);
        const merged = mergeIdLists(getBase(row.key), local, row.value);
        if (stableStringify(merged) !== stableStringify(local)) {
          window.localStorage.setItem(row.key, JSON.stringify(merged));
          changed = true;
          if (row.key === STORAGE_KEYS.tasks)
            window.dispatchEvent(new CustomEvent("ff.tasks_saved"));
        }
        setBase(row.key, row.value);
        if (stableStringify(merged) === stableStringify(row.value)) dirty.delete(row.key);
      }
      meta[row.key] = row.updated_at;
      continue;
    }

    window.localStorage.setItem(row.key, JSON.stringify(row.value));
    meta[row.key] = row.updated_at;
    setBase(row.key, row.value);
    changed = true;
    if (row.key === STORAGE_KEYS.tasks) {
      window.dispatchEvent(new CustomEvent("ff.tasks_saved"));
    }
  }
  // A row we remember that the server no longer has (account data deleted
  // elsewhere) must be inserted afresh, not updated against a stale stamp.
  for (const key of Object.keys(meta)) {
    if (SYNC_KEYS.includes(key) && !serverKeys.has(key)) delete meta[key];
  }
  saveMeta(meta);

  // The entitlement is account-scoped, and localStorage outlives a sign-out.
  // Without this, a leftover entitlement from whoever used this device before
  // would unlock the app for the current user — and the "first device" push
  // below would then write it into their cloud row as a real purchase.
  //
  // On the web the server is its only possible source (Play can't run here), so
  // "no server row" is conclusive. On Android it isn't: a purchase made offline
  // legitimately exists locally before it can be pushed, and Play itself is the
  // authority there (reconcilePurchases re-grants at boot), so leave it alone.
  if (!serverKeys.has(STORAGE_KEYS.premium)) {
    const { isNative } = await import("./native");
    if (!isNative() && window.localStorage.getItem(STORAGE_KEYS.premium) !== null) {
      window.localStorage.removeItem(STORAGE_KEYS.premium);
      dirty.delete(STORAGE_KEYS.premium);
      changed = true;
      window.dispatchEvent(new CustomEvent("ff.premium-changed"));
      console.log("[Sync] Dropped a local entitlement this account doesn't own");
    }
  }

  // First device / new keys: local data the server has never seen.
  for (const key of SYNC_KEYS) {
    // Never here for premium: an entitlement may only be created by a Play
    // purchase (which pushes via the save listener) or by an admin writing the
    // row directly. Inferring one from stale local state is how it leaks.
    if (key === STORAGE_KEYS.premium) continue;
    if (!serverKeys.has(key) && window.localStorage.getItem(key) !== null) {
      dirty.add(key);
    }
  }
  const conflicted = dirty.size > 0 ? await pushDirty() : false;

  if (changed) {
    console.log("[Sync] Applied remote changes");
    window.dispatchEvent(new CustomEvent(REMOTE_UPDATE_EVENT));
    // Items created/completed on another device: align this device's
    // scheduled notifications with the fresh data (no-op on web).
    void import("./native").then((m) => m.reconcileNotifications());
    // Same for Google Calendar: drop events for tasks/habits that were
    // deleted or completed on another device (no-op without a fresh token).
    void import("./google").then((m) => m.reconcileGoogleCalendar());
  }
  return conflicted;
}

/**
 * Push every dirty key — but only over the server copy we last saw. The old
 * unconditional upsert let a device that hadn't pulled yet replace the whole
 * list with its stale copy. Now such a write matches no row, the key stays
 * dirty, and the caller runs a full sync that merges first.
 *
 * Returns true if any key lost that race.
 */
async function pushDirty(): Promise<boolean> {
  const client = getNeonClient();
  if (!client || !currentUser) return false;

  const keys = dirty.keys();
  if (keys.length === 0) return false;
  const meta = loadMeta();
  const pushed: string[] = [];
  let conflicted = false;
  let failed = false;

  for (const key of keys) {
    const raw = window.localStorage.getItem(key);
    if (raw === null) {
      dirty.delete(key);
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      dirty.delete(key);
      continue;
    }
    const since = meta[key];
    const { data, error } = since
      ? await client
          .from("user_data")
          .update({ value })
          .eq("user_id", currentUser.id)
          .eq("key", key)
          .eq("updated_at", since)
          .select("updated_at")
      : await client
          .from("user_data")
          .upsert({ key, value }, { onConflict: "user_id,key", ignoreDuplicates: true })
          .select("updated_at");
    if (error) {
      console.error(`[Sync] Push failed for ${key}:`, error);
      failed = true; // stays dirty: retried on next save/focus/poll, even after a reload
      continue;
    }
    const updatedAt = (data as { updated_at: string }[] | null)?.[0]?.updated_at;
    if (!updatedAt) {
      // Someone else wrote this key since our last pull.
      console.log(`[Sync] ${key} changed on the server, merging before pushing`);
      conflicted = true;
      continue;
    }
    // Only clear if nothing was saved while the request was in flight.
    if (window.localStorage.getItem(key) === raw) dirty.delete(key);
    meta[key] = updatedAt;
    setBase(key, value);
    pushed.push(key);
  }
  saveMeta(meta);
  setStatus(!failed);
  if (pushed.length) console.log("[Sync] Pushed:", pushed.join(", "));
  return conflicted;
}

function onLocalSave(key: string) {
  if (!SYNC_KEYS.includes(key)) return;
  // Before the session check a save may still belong to a signed-in user;
  // initSync drops the mark again if nobody turns out to be.
  if (!currentUser && sessionResolved) return;
  dirty.add(key);
  if (!currentUser) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushDirty().then((conflicted) => {
      if (conflicted) void fullSync();
    });
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
  sessionResolved = true;
  if (currentUser) await fullSync();
  else dirty.clear(); // guest: nothing to push, and nothing to hold back a later sign-in's pull
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
  const user = await fetchSessionUser();
  if (!user) {
    return signIn(email, password);
  }
  currentUser = user;
  await fullSync();
  notifyAuthChanged();
  return user;
}

/**
 * Thrown when the native Google picker succeeded but Neon Auth could not turn
 * the ID token into a session (its managed service currently ignores the
 * idToken field on /sign-in/social and answers with its hosted redirect flow,
 * which cannot complete from inside Capacitor). Carries the picked account's
 * email so the caller can fall back to email-code sign-in.
 */
export class GoogleTokenSignInUnsupportedError extends Error {
  constructor(public email: string | null) {
    super("Neon Auth did not accept the Google ID token");
  }
}

/**
 * Google sign-in. Native: Credential Manager picker → ID token exchanged with
 * Neon Auth (no redirect, works inside Capacitor's https://localhost); throws
 * GoogleTokenSignInUnsupportedError if Neon answers with a redirect instead.
 * Web: standard OAuth redirect through Neon Auth — returns null because the
 * page navigates away; initSync picks up the session when the callback lands.
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
        disableRedirect?: boolean;
        idToken?: { token: string; accessToken?: string };
      }) => Promise<{ data?: { url?: string } | null; error?: { message?: string } | null }>;
    };
  };

  const { isNative } = await import("./native");
  if (isNative()) {
    const { googleAuthLogin } = await import("./google");
    const { idToken, accessToken, email } = await googleAuthLogin();
    // disableRedirect keeps the SDK from popping the hosted OAuth flow in an
    // external browser when the server ignores the idToken (see error above).
    const res = await auth.signIn.social({
      provider: "google",
      disableRedirect: true,
      idToken: { token: idToken, accessToken },
    });
    if (res?.error) throw new Error(res.error.message || "Google sign-in failed");
    if (res?.data?.url) throw new GoogleTokenSignInUnsupportedError(email);
    const user = await fetchSessionUser();
    if (!user) throw new GoogleTokenSignInUnsupportedError(email);
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

/** Email a 6-digit sign-in code to the given address (passwordless login). */
export async function requestSignInOtp(email: string): Promise<void> {
  const client = getNeonClient();
  if (!client) throw new Error("Not available during SSR");
  const auth = client.auth as unknown as {
    emailOtp: {
      sendVerificationOtp: (d: { email: string; type: "sign-in" }) => Promise<{ error?: { message?: string } | null }>;
    };
  };
  const res = await auth.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
  if (res?.error) throw new Error(res.error.message || "Could not send sign-in code");
}

/** Complete a passwordless sign-in with the emailed code. */
export async function signInWithEmailOtp(email: string, otp: string): Promise<SyncUser> {
  const client = getNeonClient();
  if (!client) throw new Error("Not available during SSR");
  const auth = client.auth as unknown as {
    signIn: {
      emailOtp: (d: { email: string; otp: string }) => Promise<{ error?: { message?: string } | null }>;
    };
  };
  const res = await auth.signIn.emailOtp({ email, otp });
  if (res?.error) throw new Error(res.error.message || "Sign-in failed");
  const user = await fetchSessionUser();
  if (!user) throw new Error("Sign-in failed");
  currentUser = user;
  // Same ordering constraint as signIn: pull BEFORE announcing.
  await fullSync();
  notifyAuthChanged();
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

  const session = await fetchSessionUser();
  if (!session) throw new Error("Sign-in failed");

  // Scope the delete explicitly, exactly like the pull in doFullSync. RLS
  // should already confine this to the signed-in user, but an unfiltered
  // DELETE is the one statement where a policy that ever failed open would
  // wipe every account's data instead of just leaking it.
  const del = await client.from("user_data").delete().eq("user_id", session.id);
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
  window.localStorage.removeItem(BASE_KEY);
  // Wipe the local copy too. Leaving it behind meant the deleted account's
  // tasks were still on the device — and the next account signed in here would
  // have pushed them to the cloud as its own via the "first device" branch.
  for (const key of SYNC_KEYS) window.localStorage.removeItem(key);
  window.localStorage.removeItem(STORAGE_KEYS.inAppNotifs);
  window.dispatchEvent(new CustomEvent("ff.premium-changed"));
  window.dispatchEvent(new CustomEvent(REMOTE_UPDATE_EVENT));
  notifyAuthChanged();
  return { accountDeleted };
}

export async function signOut(): Promise<void> {
  const client = getNeonClient();
  if (!client) return;
  // Last chance for edits still waiting on the debounce or a flaky network.
  try {
    await pushDirty();
  } catch {
    /* offline: signing out still has to work */
  }
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
  window.localStorage.removeItem(BASE_KEY);
  // The entitlement is the exception: it belongs to the account, not the
  // device, so leaving it behind would hand premium to whoever signs in next.
  window.localStorage.removeItem(STORAGE_KEYS.premium);
  window.dispatchEvent(new CustomEvent("ff.premium-changed"));
  notifyAuthChanged();
}
