# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Focus Flow: an ADHD-friendly task/reminder app. One codebase ships to three targets:
- **Web**: TanStack Start in SPA mode, deployed to Cloudflare Workers (`focus-flow-buddy-75.kacper-szymanski1990.workers.dev`) and Lovable (`focus-flow-buddy-75.lovable.app`).
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

## Git rules (Lovable-connected repo)

- **Never rewrite pushed history** (no force-push/rebase/amend of pushed commits) — it corrupts the Lovable side.
- Lovable's desktop tooling **auto-commits and pushes** local changes with generic messages ("updated logo", "Changes"), sometimes mid-session. Expect the working tree and remote to move underneath you; check `git status`/`git log` before assuming state, and `git pull --rebase` before pushing.
- Pushing to `main` auto-triggers both Lovable sync and a Cloudflare Workers build/deploy.
- Pushing requires `git -c credential.helper=manager push` (Windows credential manager).

## Architecture

### Data layer: localStorage is the source of truth
All app data lives in localStorage under keys in `src/lib/storage.ts` (`STORAGE_KEYS`: tasks, reminders, streak, todo, …). Components load on mount via `loadJSON` and persist via `saveJSON`. Two zustand-persisted stores exist separately: app settings incl. `guestMode` (`src/lib/i18n.ts`, key `focus-flow-settings`) and AI-coach history (`src/lib/history.ts`).

### Cloud sync (src/lib/sync.ts)
Cross-device sync mirrors whole localStorage values to one Postgres row per (user, key) in `public.user_data` on Neon, reached **directly from the client** via Neon Data API (PostgREST) with RLS (`auth.user_id()`), authenticated by Neon Auth (hosted better-auth, cookie sessions). There is deliberately **no app server** — that's what makes the same bundle work in Capacitor.

- Conflict model: last-writer-wins **per key** (whole list replaced, not per item).
- Pull triggers: sign-in, app launch, refocus (5s throttle), 15s polling while visible. Push: debounced ~800ms after any `saveJSON` (via `registerSaveListener`).
- Events: `ff.remote-update` (remote data applied → Home bumps `syncEpoch` to remount tabs; components re-read storage), `ff.auth-changed` (sign in/out → AuthGate/Settings re-evaluate), `ff.tasks_saved` (task writes → Android widget mirror).
- **Ordering constraint**: in `signIn`/`signUp`, `fullSync()` must complete **before** `notifyAuthChanged()`. The app mounts on auth-changed; mounting mid-pull lets components save empty state over the user's cloud data (this bug shipped once).

### Auth flow
`AuthGate.tsx` renders full-screen when there's no session and `guestMode` is false: sign in / sign up / forgot-password (email OTP: `forgetPassword.emailOtp` → `emailOtp.resetPassword`) / continue-as-guest. Settings (`AccountSync.tsx`) has change-password and sign-out. The neon-js client (`src/lib/neon.ts`) is a browser-only singleton; plugin methods not in its TS surface are accessed via typed casts in sync.ts.

**Any new domain serving the app must be added to Neon Auth trusted origins** (`neon_auth.project_config.trusted_origins`, updatable via SQL over `DATABASE_URL` or the Neon console) or sign-in fails with "Invalid origin". Capacitor's `https://localhost` is covered by `allow_localhost`.

### Notifications (src/lib/native.ts)
All native APIs are guarded by `isNative()` and no-op on web. Notification id conventions: tasks `hashId("task:" + id)` (one-shot at `remindAt`), nudges `hashId("rem:" + id + ":" + timeIdx)` (daily repeating). Postponed notifications use throwaway ids and must not be cancelled by cleanup logic. `reconcileNotifications()` aligns pending notifications with storage after sync pulls and at boot. An Android home-screen widget mirrors open tasks via `WidgetBridge` (custom plugin in `android/`).

### i18n
`t()` keys are typed against the `en` dictionary in `src/lib/i18n.ts`; **every key must exist in both `en` and `pl`** or tsc fails. The Polish language picker is currently disabled (see comment in Settings.tsx) but the dict is maintained.

### Build pipeline (fragile — read before touching)
`vite.config.ts` uses `@lovable.dev/vite-tanstack-config`, which bundles tanstackStart/react/tailwind/nitro — do not add those plugins manually. Known trap: newer config versions enable the **nitro deploy plugin** on every build, which retargets output to `.output/` and breaks TanStack's SPA prerender (expects `dist/server/server.js`). Current defenses: `nitro: false` when `CF_PAGES`/`WORKERS_CI` env vars are set (Cloudflare builders), explicit `nitro.output` dirs pinned to `dist/`, a `resilientServerEntry` shim plugin, and `scripts/prebuild.js`/`postbuild.js` (placeholder server entry; `_shell.html` → `index.html` copy that Capacitor and static hosting require). Verify both `npm run build` and `WORKERS_CI=1 npm run build` still produce `dist/client/index.html` after changing any of this.

### Environment files
- `.env` (committed): public `VITE_NEON_AUTH_URL` / `VITE_NEON_DATA_API_URL`, baked into client bundles.
- `.env.local` (gitignored): `DATABASE_URL` etc. — admin credentials used only by local scripts, never by app code.
