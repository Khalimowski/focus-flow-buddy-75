import { SocialLogin } from "@capgo/capacitor-social-login";
import { loadJSON, saveJSON } from "./storage";
import { useI18nStore } from "./i18n";

// Google integrations (Gmail import + Google Calendar push), client-only.
// Auth runs through @capgo/capacitor-social-login: a popup OAuth flow on web,
// native Credential Manager on Android — same API surface for both. Tokens are
// stored under keys that are NOT in sync.ts SYNC_KEYS on purpose: they must
// stay on this device, never mirrored to the cloud.
//
// Setup: create an OAuth "Web application" client in Google Cloud Console,
// enable the Gmail and Calendar APIs, add every origin serving the app
// (localhost:8080, *.workers.dev, *.lovable.app) to Authorized JavaScript
// origins AND Authorized redirect URIs, then put the client id in
// VITE_GOOGLE_WEB_CLIENT_ID (.env). Gmail is a restricted scope: until Google
// verifies the app, add yourself under "Test users" on the OAuth consent
// screen or sign-in fails with 403: access_denied.

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID as string | undefined) || "";

export const GOOGLE_SCOPES = {
  gmail: "https://www.googleapis.com/auth/gmail.readonly",
  calendar: "https://www.googleapis.com/auth/calendar.events",
};

const CONN_KEY = "ff.google.v1";
// taskId -> Google Calendar event id, so edits/completions clean up after themselves
const CALMAP_KEY = "ff.google.calmap.v1";

type GoogleConnection = {
  email: string | null;
  accessToken: string;
  expiresAt: number; // epoch ms
  scopes: string[];
};

export function isGoogleConfigured(): boolean {
  return CLIENT_ID.length > 0;
}

export function getGoogleConnection(): GoogleConnection | null {
  return loadJSON<GoogleConnection | null>(CONN_KEY, null);
}

let initialized = false;
async function ensureInit() {
  if (initialized) return;
  await SocialLogin.initialize({ google: { webClientId: CLIENT_ID } });
  initialized = true;
}

// Interactive sign-in. Must run from a user gesture on web (popup blockers).
// Requests both feature scopes up front so one consent covers everything.
export async function connectGoogle(): Promise<GoogleConnection> {
  if (!isGoogleConfigured()) throw new Error("Google client id not configured");
  await ensureInit();
  const scopes = [GOOGLE_SCOPES.gmail, GOOGLE_SCOPES.calendar];
  const res = await SocialLogin.login({
    provider: "google",
    options: { scopes, forceRefreshToken: true },
  });
  const result = res.result as {
    accessToken?: { token: string; expires?: string } | null;
    profile?: { email: string | null };
  };
  const token = result.accessToken?.token;
  if (!token) throw new Error("Google login returned no access token");

  const expiresRaw = result.accessToken?.expires;
  const parsed = expiresRaw ? Date.parse(expiresRaw) : NaN;
  const conn: GoogleConnection = {
    email: result.profile?.email ?? null,
    accessToken: token,
    // Fall back to 55 min (Google tokens last ~1h) when expiry is absent
    expiresAt: Number.isFinite(parsed) ? parsed : Date.now() + 55 * 60 * 1000,
    scopes,
  };
  saveJSON(CONN_KEY, conn);
  window.dispatchEvent(new CustomEvent("ff.google-changed"));
  return conn;
}

// Basic-profile login used for *account sign-in* (no Gmail/Calendar scopes).
// Returns the Google ID token, which sync.ts exchanges with Neon Auth for a
// session — no browser redirect, so it also works inside Capacitor.
export async function googleAuthLogin(): Promise<{
  idToken: string;
  accessToken?: string;
  email: string | null;
}> {
  if (!isGoogleConfigured()) throw new Error("Google client id not configured");
  await ensureInit();
  const res = await SocialLogin.login({ provider: "google", options: {} });
  const result = res.result as {
    idToken?: string | null;
    accessToken?: { token: string } | null;
    profile?: { email: string | null };
  };
  if (!result.idToken) throw new Error("Google login returned no ID token");
  return {
    idToken: result.idToken,
    accessToken: result.accessToken?.token,
    email: result.profile?.email ?? null,
  };
}

export async function disconnectGoogle() {
  try {
    await ensureInit();
    await SocialLogin.logout({ provider: "google" });
  } catch (e) {
    console.warn("[Google] logout failed (clearing local state anyway)", e);
  }
  window.localStorage.removeItem(CONN_KEY);
  window.localStorage.removeItem(CALMAP_KEY);
  window.dispatchEvent(new CustomEvent("ff.google-changed"));
}

// Token if present and fresh; null means the caller needs connectGoogle()
// (interactive) or should skip quietly (background paths).
function getValidToken(): string | null {
  const conn = getGoogleConnection();
  if (!conn) return null;
  if (Date.now() > conn.expiresAt - 60 * 1000) return null;
  return conn.accessToken;
}

// Valid token, reconnecting interactively if needed. Only call from a user
// gesture (button/toggle handlers).
export async function ensureGoogleToken(): Promise<string> {
  const token = getValidToken();
  if (token) return token;
  const conn = await connectGoogle();
  return conn.accessToken;
}

async function gFetch(url: string, token: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (res.status === 401) {
    // Token revoked or expired early — force the next call through reconnect
    const conn = getGoogleConnection();
    if (conn) saveJSON(CONN_KEY, { ...conn, expiresAt: 0 });
    throw new Error("Google token rejected (401)");
  }
  return res;
}

// --- Gmail -> tasks ---

export type GmailMessage = {
  id: string;
  subject: string;
  from: string;
  date: string;
};

export async function listRecentEmails(token: string, max = 15): Promise<GmailMessage[]> {
  const listRes = await gFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=in:inbox`,
    token,
  );
  if (!listRes.ok) throw new Error(`Gmail list failed: ${listRes.status}`);
  const list = (await listRes.json()) as { messages?: { id: string }[] };
  const ids = (list.messages ?? []).map((m) => m.id);

  const details = await Promise.all(
    ids.map(async (id) => {
      const res = await gFetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        token,
      );
      if (!res.ok) return null;
      const msg = (await res.json()) as {
        id: string;
        payload?: { headers?: { name: string; value: string }[] };
      };
      const header = (name: string) =>
        msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
      // "Jane Doe <jane@x.com>" -> "Jane Doe"
      const from = header("From")
        .replace(/\s*<[^>]*>\s*$/, "")
        .replace(/^"|"$/g, "");
      return {
        id: msg.id,
        subject: header("Subject") || "(no subject)",
        from,
        date: header("Date"),
      };
    }),
  );
  return details.filter((d): d is GmailMessage => d !== null);
}

// --- Tasks -> Google Calendar ---
// Mirrors the device-calendar sync in native.ts, but over the Calendar API so
// it also works on web. Background paths no-op without a fresh token rather
// than popping auth UI mid-save.

type CalTask = { id: string; title: string; remindAt?: string | null; done?: boolean };

function loadCalMap(): Record<string, string> {
  return loadJSON<Record<string, string>>(CALMAP_KEY, {});
}

function calendarSyncEnabled(): boolean {
  return useI18nStore.getState().googleCalendarSync;
}

async function deleteEvent(token: string, eventId: string) {
  const res = await gFetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
    token,
    { method: "DELETE" },
  );
  // 404/410 = already gone; that's fine
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    console.warn(`[Google] Event delete failed: ${res.status}`);
  }
}

export async function pushTaskToGoogleCalendar(task: CalTask) {
  if (!calendarSyncEnabled() || !task.remindAt) return;
  const token = getValidToken();
  if (!token) return;
  try {
    const map = loadCalMap();
    if (map[task.id]) {
      await deleteEvent(token, map[task.id]);
      delete map[task.id];
      saveJSON(CALMAP_KEY, map);
    }
    const start = new Date(task.remindAt);
    const end = new Date(start.getTime() + 15 * 60 * 1000);
    const res = await gFetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      token,
      {
        method: "POST",
        body: JSON.stringify({
          summary: task.title,
          start: { dateTime: start.toISOString() },
          end: { dateTime: end.toISOString() },
        }),
      },
    );
    if (!res.ok) {
      console.warn(`[Google] Event insert failed: ${res.status}`);
      return;
    }
    const event = (await res.json()) as { id: string };
    map[task.id] = event.id;
    saveJSON(CALMAP_KEY, map);
    console.log(`[Google] Calendar event created for task ${task.id}`);
  } catch (e) {
    console.warn("[Google] pushTaskToGoogleCalendar failed", e);
  }
}

export async function removeTaskFromGoogleCalendar(taskId: string) {
  const map = loadCalMap();
  const eventId = map[taskId];
  if (!eventId) return;
  const token = getValidToken();
  if (!token) return;
  try {
    await deleteEvent(token, eventId);
    delete map[taskId];
    saveJSON(CALMAP_KEY, map);
  } catch (e) {
    console.warn("[Google] removeTaskFromGoogleCalendar failed", e);
  }
}

// Called when the Settings toggle turns on — pushes every open task that has a
// reminder, same shape as native.ts syncAllToCalendar.
export async function syncAllTasksToGoogleCalendar(tasks: CalTask[]) {
  for (const task of tasks) {
    if (!task.done && task.remindAt) {
      await pushTaskToGoogleCalendar(task);
    }
  }
}
