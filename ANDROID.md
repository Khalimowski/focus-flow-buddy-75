# Building Focus Flow as a native Android app

The web app is fully prepped for [Capacitor](https://capacitorjs.com). On Android,
reminders schedule as real **system alarms** via `@capacitor/local-notifications`,
so they fire even when the app is fully closed.

## One-time setup (on your own machine)

You need **Node 20+**, **Java 21**, and **Android Studio**. Lovable's sandbox
can't produce an `.apk` — Android builds need the Android SDK locally.

```bash
# 1. Clone the project from Lovable (Github export or git clone)
git clone <your-repo> && cd <your-repo>
bun install            # or: npm install

# 2. Build the web bundle
bun run build          # outputs dist/client

# 3. Add the Android platform (only the first time)
bunx cap add android

# 4. Copy the latest web build into the native project
bunx cap sync android

# 5. Open in Android Studio
bunx cap open android
```

In Android Studio: **Build → Build Bundle(s)/APK → Build APK(s)**.
The signed `.apk` lands in `android/app/build/outputs/apk/`.

## After any code change

```bash
bun run build && bunx cap sync android
```

## Releasing a new version (in-app update check)

The app checks `version.json` (repo root) on every launch — if its `versionCode`
is higher than the installed build, users see an "Update available" banner
linking to `url`. To ship a release:

1. Bump `versionCode` / `versionName` in `android/app/build.gradle`.
2. Build the signed APK and upload it somewhere reachable (GitHub Release asset, etc.).
3. Update `version.json` at the repo root with the new `versionCode`,
   `versionName`, the download `url`, and optional `notes`.
4. Commit and push `version.json` to `main` — the app reads it from
   `raw.githubusercontent.com`, so no rebuild is needed for existing installs
   to see the banner.

## Notes

- App id: `com.khalimowski.focusflow` (Play Store package name; set in
  `capacitor.config.ts` and as `applicationId` in `android/app/build.gradle` —
  the Java `namespace` stays `app.lovable.focusflow` on purpose).
- Daily reminders use `repeats: true` so they keep firing without the app open.
- Task reminders are scheduled as one-shot alarms at the chosen time.
- On Android 13+, the app requests `POST_NOTIFICATIONS` on first launch — tap **Allow**.
- For exact alarms on Android 14+, users may need to enable
  *Alarms & reminders* in system settings.
