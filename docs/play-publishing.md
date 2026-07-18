# Publishing to Google Play from CI

`.github/workflows/play-release.yml` builds the web bundle, packages it into a
signed Android App Bundle, and uploads it to Google Play — no Android Studio
needed. One-time setup below; after that, releasing is just pushing a tag.

## One-time setup

### 1. Create a Play API service account

1. In [Google Cloud Console](https://console.cloud.google.com/), pick (or create)
   a project → **IAM & Admin → Service Accounts → Create service account**
   (name it e.g. `play-publisher`). No project roles needed.
2. On the new account: **Keys → Add key → Create new key → JSON**. Download the
   file — its full contents become the `PLAY_SERVICE_ACCOUNT_JSON` secret.
3. In [Play Console](https://play.google.com/console): **Users and permissions →
   Invite new users** → enter the service account's email → grant access to the
   Focus Flow app with the **Release to testing tracks / production** permissions
   (or "Admin" on the app for simplicity).

### 2. Add the GitHub repository secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | base64 of your upload keystore: `certutil -encodehex -f keystore.jks tmp.b64 0x40000001` on Windows (or `base64 -w0 keystore.jks` in Git Bash), then paste the file contents |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | the key alias (shown by Android Studio's signing dialog) |
| `ANDROID_KEY_PASSWORD` | the key password (often same as keystore password) |
| `PLAY_SERVICE_ACCOUNT_JSON` | full contents of the service-account JSON key |

This must be the **same keystore** you've signed previous releases with (the
upload key) — Play rejects bundles signed with any other key.

## Releasing

1. Bump `versionCode` (+1, mandatory) and `versionName` in
   `android/app/build.gradle`, and the version label in
   `src/components/Settings.tsx`. Commit to `main`.
2. Tag and push:

   ```bash
   git tag v1.2
   git -c credential.helper=manager push origin v1.2
   ```

   A tag push publishes to the **internal** track. To release to another track
   (including production), use GitHub → **Actions → Publish to Google Play →
   Run workflow** and pick the track — or promote the internal build inside
   Play Console, which also lets you add release notes.

## Notes

- Local builds are unaffected: the CI signing config in
  `android/app/build.gradle` only activates when the keystore env vars are set.
- Play rejects a `versionCode` it has already seen — forgetting the bump is the
  most common failure.
- The built `.aab` is also attached to the workflow run as an artifact, so you
  can download it and upload manually if you prefer.
- The Play API can't create the app listing or send a release for review on a
  brand-new app — the first-ever upload of an app must happen in Play Console
  by hand (already done for Focus Flow).
