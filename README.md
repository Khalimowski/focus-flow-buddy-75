# FlowDay

**An ADHD-friendly task and reminder app that meets you where your attention actually is.**

FlowDay is built around a simple idea: the hard part of a to-do list isn't writing it, it's
coming back to it. So FlowDay keeps the list short, nudges you at the right moment, and makes
finishing something feel like it counted.

🌐 [flowday.day](https://flowday.day) · 📱 Android (Capacitor)

---

## Features

- **Tasks with real reminders** — one-shot notifications at the time you set, not a badge you'll ignore.
- **Recurring habits** — daily repeating prompts for the things that keep slipping.
- **A dead-simple to-do list** — quick capture, no projects, no tags, no ceremony. Finished items collapse into a Done section so the list stays short.
- **Timeline & calendar views** — see the day laid out, or drop tasks straight into your native calendar.
- **Streaks** — a gentle "don't break the chain" counter for showing up.
- **End-of-day review** — a short look back that turns a messy day into a closed one.
- **AI coach** — talk through what to do next when the list feels like a wall.
- **Voice capture** — dictate a task instead of typing it (on-device speech, no upload).
- **Gmail import** — pull actionable mail into tasks instead of leaving it in the inbox.
- **Analytics** — lightweight charts on what you actually completed.
- **Android home-screen widget** — open tasks visible without opening the app.
- **English & Polish** throughout, including native Android strings.
- **Cross-device sync** — sign in and your data follows you; or stay in guest mode and keep everything local.

## Tech

One codebase, three targets.

| | |
|---|---|
| **UI** | React 19, TanStack Router/Start (SPA mode), Tailwind 4, Radix UI, Framer Motion |
| **State** | localStorage as the source of truth, Zustand for settings and coach history |
| **Data** | Neon Postgres via the Neon Data API (PostgREST) with RLS, hit **directly from the client** |
| **Auth** | Neon Auth (hosted better-auth, cookie sessions) — email/password, OTP password reset |
| **Web** | Cloudflare Workers → [flowday.day](https://flowday.day) |
| **Android** | Capacitor wrapping the static bundle; local notifications, calendar, billing, widget |

There is deliberately **no app server**. Every feature that could have needed one either runs in
the browser or talks to Neon under row-level security — which is exactly what lets the same bundle
run inside Capacitor with no backend on the phone. The only server-side code is a small standalone
Worker for Play purchase verification.

Sync is last-writer-wins per storage key: whole values are mirrored to one Postgres row per
(user, key), pulled on launch/refocus/poll and pushed debounced after any write.

## Getting started

```bash
bun install
npm run dev
```

The dev server runs on **port 8080**.

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server (port 8080) |
| `npm run build` | Static site in `dist/client` |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Type-check |
| `sync-android.bat` | Rebuild the web bundle and copy it into `android/` |

Public config (`VITE_NEON_AUTH_URL`, `VITE_NEON_DATA_API_URL`) lives in the committed `.env`.
Admin credentials belong in `.env.local`, which is gitignored and never read by app code.

### Android

`sync-android.bat`, then open `android/` in Android Studio and build. Notes in
[ANDROID.md](ANDROID.md).

## Documentation

- [CLAUDE.md](CLAUDE.md) — architecture, build pipeline traps, contribution rules
- [ANDROID.md](ANDROID.md) — the native build
- [docs/PREMIUM.md](docs/PREMIUM.md) — entitlements and Play billing
- [PRIVACY.md](PRIVACY.md) — privacy policy

## Privacy

Your data is yours. Guest mode keeps everything on the device and talks to nothing.
If you sign in, data syncs to your own row in Postgres behind row-level security —
no analytics pipeline, no profile-building, no third party reading your tasks.
Speech recognition runs on-device; audio never leaves the phone.
