# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

FlowDay: an ADHD-friendly task/reminder app. One codebase ships to three targets:
- **Web**: TanStack Start in SPA mode, deployed to Cloudflare Workers at `flowday.day` (custom domain; the generated `focus-flow-buddy-75.kacper-szymanski1990.workers.dev` still resolves as a fallback) and Lovable (`focus-flow-buddy-75.lovable.app`).
- **Android**: Capacitor wraps the static `dist/client` bundle (no server on the phone).

## Commands

```bash
npm run dev          # vite dev server on port 8080 (not 3000)
npm run build        # prebuild -> vite build -> postbuild; static site in dist/client
npm run lint         # eslint
npx tsc --noEmit     # type-check (no test suite exists)
node scripts/setup-neon.mjs   # one-time DB setup (user_data table, RLS) — idempotent
sync-android.bat     # rebuild web bundle + copy into android/ (then build APK in Android Studio)
```

Bun is the primary package manager (`bun.lock`); npm works for scripts.

## Version bump rule (user request — always follow)

Every session that changes app code MUST, before finishing, bump `versionCode`
(+1, mandatory — Play rejects a reused number) and `versionName` in
`android/app/build.gradle`, and keep `APP_VERSION` in `src/lib/changelog.ts`
equal to `versionName` — that constant is what the Settings footer shows and
what the release-notes popup compares against. This keeps the next Play upload
from being rejected over a stale version code.

While you're in `changelog.ts`, add a `CHANGELOG` entry at the top for the new
version, in **both `en` and `pl`**, describing the change in user-facing terms
(skip anything invisible to them — refactors, build fixes). That entry is the
"what's new" dialog users see on their first launch after updating; a version
with no entry shows nothing.

## Git rules (Lovable-connected repo)

- **Never rewrite pushed history** (no force-push/rebase/amend of pushed commits) — it corrupts the Lovable side.
- Lovable's desktop tooling **auto-commits and pushes** local changes with generic messages ("updated logo", "Changes"), sometimes mid-session. Expect the working tree and remote to move underneath you; check `git status`/`git log` before assuming state, and `git pull --rebase` before pushing.
- Pushing to `main` auto-triggers both Lovable sync and a Cloudflare Workers build/deploy.
- Pushing requires `git -c credential.helper=manager push` (Windows credential manager).

## Architecture

### Data layer: localStorage is the source of truth
All app data lives in localStorage under keys in `src/lib/storage.ts` (`STORAGE_KEYS`: tasks, reminders, streak, todo, …). Components load on mount via `loadJSON` and persist via `saveJSON`. Two zustand-persisted stores exist separately: app settings incl. `guestMode` (`src/lib/i18n.ts`, key `focus-flow-settings`) and AI-coach history (`src/lib/history.ts`).

The settings store is device-local (theme, language, guest mode, native calendar/vibration) with one exception: the three **Google integration toggles** are mirrored into `STORAGE_KEYS.googlePrefs`, which *is* in `SYNC_KEYS`, so the choice follows the account across devices. Publish with `publishGooglePrefs()` and only for changes the user made — a disconnect or a failed enable is local, and publishing it would switch the feature off everywhere (sync is last-writer-wins). The OAuth token itself is never synced.

### Cloud sync (src/lib/sync.ts)
Cross-device sync mirrors whole localStorage values to one Postgres row per (user, key) in `public.user_data` on Neon, reached **directly from the client** via Neon Data API (PostgREST) with RLS (`auth.user_id()`), authenticated by Neon Auth (hosted better-auth, cookie sessions). There is deliberately **no app server** — that's what makes the same bundle work in Capacitor.

- Conflict model: last-writer-wins **per key** (whole list replaced, not per item).
- Pull triggers: sign-in, app launch, refocus (5s throttle), 15s polling while visible. Push: debounced ~800ms after any `saveJSON` (via `registerSaveListener`).
- Events: `ff.remote-update` (remote data applied → tab components re-read storage in place; **never remount the tabs for this** — that wipes in-progress input like a half-typed task title), `ff.auth-changed` (sign in/out → AuthGate/Settings re-evaluate), `ff.tasks_saved` (task writes → Android widget mirror).
- **Ordering constraint**: in `signIn`/`signUp`, `fullSync()` must complete **before** `notifyAuthChanged()`. The app mounts on auth-changed; mounting mid-pull lets components save empty state over the user's cloud data (this bug shipped once).

### Auth flow
`AuthGate.tsx` renders full-screen when there's no session and `guestMode` is false: sign in / sign up / forgot-password (email OTP: `forgetPassword.emailOtp` → `emailOtp.resetPassword`) / continue-as-guest. Settings (`AccountSync.tsx`) has change-password and sign-out. The neon-js client (`src/lib/neon.ts`) is a browser-only singleton; plugin methods not in its TS surface are accessed via typed casts in sync.ts.

**Any new domain serving the app must be added to Neon Auth trusted origins** (`neon_auth.project_config.trusted_origins`, updatable via SQL over `DATABASE_URL` or the Neon console) or sign-in fails with "Invalid origin". Capacitor's `https://localhost` is covered by `allow_localhost`.

### Notifications (src/lib/native.ts)
All native APIs are guarded by `isNative()` and no-op on web. Notification id conventions: tasks `hashId("task:" + id)` (one-shot at `remindAt`), nudges `hashId("rem:" + id + ":" + timeIdx)` (daily repeating). Postponed notifications use throwaway ids and must not be cancelled by cleanup logic. `reconcileNotifications()` aligns pending notifications with storage after sync pulls and at boot. An Android home-screen widget mirrors open tasks via `WidgetBridge` (custom plugin in `android/`).

### Premium (src/lib/premium.ts, src/lib/billing.ts)
One-time Play purchase (`focus_flow_premium`) that unlocks the **browser
version** (`PremiumGate` blocks the web build without it) and removes the AdMob
banner on Android. Android stays free/ad-supported — it's also the only place
Play Billing runs, via the custom `BillingPlugin.java` (same pattern as
`WidgetBridgePlugin`).

The entitlement is just another synced localStorage key (`ff.premium.v1` in
SYNC_KEYS), so a phone purchase reaches the browser through the existing sync —
no new server on that path. **Never write a "false" entitlement**: sync is
last-writer-wins, so a browser saving `{active:false}` would wipe a real
purchase in the cloud. Only grants and explicit revocation tombstones are
written, and an empty Play `restore()` is never treated as a revocation.

Play verification and the post-purchase email need a server, so they live in a
**standalone** Worker (`workers/premium-unlock/`, wired via
`VITE_PREMIUM_UNLOCK_URL`) rather than in the app's fragile Vite/Nitro build.
Unset = purchases trusted client-side, no email. Full notes: `docs/PREMIUM.md`.

### i18n
`t()` keys are typed against the `en` dictionary in `src/lib/i18n.ts`; **every key must exist in both `en` and `pl`** or tsc fails. The Polish language picker is live in Settings, and `values-pl` ships in the APK (no `resConfigs` filter), so native strings need a Polish entry too.

### Build pipeline (fragile — read before touching)
`vite.config.ts` uses `@lovable.dev/vite-tanstack-config`, which bundles tanstackStart/react/tailwind/nitro — do not add those plugins manually. Known trap: newer config versions enable the **nitro deploy plugin** on every build, which retargets output to `.output/` and breaks TanStack's SPA prerender (expects `dist/server/server.js`). Current defenses: `nitro: false` when `CF_PAGES`/`WORKERS_CI` env vars are set (Cloudflare builders), explicit `nitro.output` dirs pinned to `dist/`, a `resilientServerEntry` shim plugin, and `scripts/prebuild.js`/`postbuild.js` (placeholder server entry; `_shell.html` → `index.html` copy that Capacitor and static hosting require). Verify both `npm run build` and `WORKERS_CI=1 npm run build` still produce `dist/client/index.html` after changing any of this.

### Environment files
- `.env` (committed): public `VITE_NEON_AUTH_URL` / `VITE_NEON_DATA_API_URL`, baked into client bundles.
- `.env.local` (gitignored): `DATABASE_URL` etc. — admin credentials used only by local scripts, never by app code.
