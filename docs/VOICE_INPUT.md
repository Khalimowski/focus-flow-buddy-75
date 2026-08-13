# Voice input (offline dictation)

The mic next to the add button on the **Tasks** tab dictates a task title.
Recognition is [Vosk](https://alphacephei.com/vosk/) — a WASM build of Kaldi via
[`vosk-browser`](https://github.com/ccoreilly/vosk-browser) — running inside the
page. Nothing is sent anywhere: after the one-time model download, dictation
works with the phone in airplane mode.

Code: `src/lib/speech.ts` (engine), `src/components/MicButton.tsx` (UI),
wired into `src/components/TaskList.tsx`.

## How a session runs

1. First tap fetches the language model (~40 MB) with a progress readout, stores
   it in Cache Storage (`ff-vosk-models-v1`), and hands it to Vosk as a blob URL.
   Later taps skip straight to step 2 — including after a restart.
2. `getUserMedia` → `AudioContext` → `ScriptProcessorNode` feeds the recogniser.
   The processor is routed through a **muted** gain node, because a
   ScriptProcessorNode only runs while it reaches the destination and wiring the
   mic to the speakers would feed back.
3. Interim results stream into the field as you talk, appended to whatever was
   already typed.
4. It stops **2 s after the recogniser last picked up a word**, or on a second
   tap, or after 8 s if you never said anything, or at a 60 s ceiling.

"Quiet" is measured as *no new words recognised*, not as raw loudness. A
volume threshold never trips in a café or a car; word stagnation still ends the
session the moment you stop talking.

The loaded model holds ~50 MB in its worker, so it is terminated after 3 minutes
idle and reloaded (from cache, no network) on the next tap.

## Why the model is not bundled

`vosk-browser` itself is ~5.6 MB because it inlines its worker and the Kaldi
WASM as base64, and the model is another ~40 MB. Both would be dead weight in
the APK and on `flowday.day` for a button many users never press, so the library
is behind a dynamic import and the model is fetched on demand.

## Language support

| App language | Model | Size | Host |
| --- | --- | --- | --- |
| English | `vosk-model-small-en-us-0.15` | 41 MB | `ccoreilly.github.io` (third party) |
| Polish | `vosk-model-small-pl-0.22` | 53 MB | Cloudflare R2 bucket `flowday-models` |

The mic renders only when a model exists for the active language, so a language
with no model shows no broken button rather than transcribing through the wrong
acoustic model.

The Polish model is served from our own R2 bucket, repacked from Vosk's `.zip`
by the recipe below. The English one is still on a third-party GitHub Pages site
— moving it into the same bucket is a `wrangler r2 object put` plus setting
`VITE_VOSK_MODEL_URL_EN`, and would drop the last external dependency.

### How the Polish model was produced

Vosk publishes `vosk-model-small-pl-0.22`, but only as a `.zip`, and
`vosk-browser` wants a tar — so it has to be repacked and self-hosted. On
Windows use the system `tar.exe` (bsdtar) to unpack the zip; Git Bash's GNU tar
cannot read zips:

```bash
curl -O https://alphacephei.com/vosk/models/vosk-model-small-pl-0.22.zip
/c/Windows/System32/tar.exe -xf vosk-model-small-pl-0.22.zip
tar czf vosk-model-small-pl-0.22.tar.gz vosk-model-small-pl-0.22
```

Verified sizes and checksums of that exact procedure:

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `vosk-model-small-pl-0.22.zip` | 52,979,372 | `c4cd16498ea544f446f9e9a55cbd602b71cfe5a2b6f2b0834d81e1b6fce15f0d` |
| `vosk-model-small-pl-0.22.tar.gz` | 52,980,237 | `2453249e7cff6c907cda8e731082052f4a082ce40b45fe3036fa0c9b1654de44` |

The archive must hold a single top-level `vosk-model-small-pl-0.22/` directory
with `am/`, `conf/`, `graph/`, `ivector/` inside — the same shape as the English
tarball.

Then point the app at it and rebuild:

```
VITE_VOSK_MODEL_URL_PL=https://<host>/vosk-model-small-pl-0.22.tar.gz
```

#### What the host has to do

- Send `Access-Control-Allow-Origin` for `https://flowday.day` **and**
  `https://localhost` (Capacitor's origin on Android). Without the latter the
  APK cannot fetch it.
- Serve the file as an opaque binary — `Content-Type: application/gzip`, and
  **no `Content-Encoding: gzip`**. A host that sets that header makes the
  browser transparently decompress the tar, so every device downloads and caches
  **96 MB instead of 53 MB**. (Vosk itself accepts either form, so this fails
  silently as pure waste rather than as an error.)
- Support ranged/streamed responses if you want the progress readout to be
  accurate; it falls back to the hardcoded size otherwise.

#### Hosting it on Cloudflare R2

`wrangler login` first — the rest is non-interactive. `--content-encoding` is
deliberately never set, for the reason above.

```bash
wrangler r2 bucket create flowday-models
wrangler r2 object put flowday-models/vosk-model-small-pl-0.22.tar.gz --remote --file vosk-model-small-pl-0.22.tar.gz --content-type application/gzip --cache-control "public, max-age=31536000, immutable"
wrangler r2 bucket cors set flowday-models --file r2-cors.json
```

with `r2-cors.json`:

```json
[
  {
    "AllowedOrigins": [
      "https://flowday.day",
      "https://focus-flow-buddy-75.lovable.app",
      "https://focus-flow-buddy-75.kacper-szymanski1990.workers.dev",
      "https://localhost",
      "http://localhost:8080"
    ],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["Content-Length", "Content-Type"],
    "MaxAgeSeconds": 86400
  }
]
```

`https://localhost` is Capacitor's origin and is what lets the APK fetch it.

Then expose the bucket. Prefer a custom domain over the `r2.dev` dev URL —
Cloudflare rate-limits `r2.dev` and does not intend it for production traffic,
which matters for a 53 MB file:

```bash
wrangler r2 bucket domain add flowday-models --domain models.flowday.day --zone-id <zone>
# or, for a quick test only:
wrangler r2 bucket dev-url enable flowday-models
```

Two hosts that do **not** work:

- **Workers Static Assets** caps files at 25 MiB, so the model cannot ride along
  in the app's own Worker deploy.
- **GitHub release assets** are served from Azure Blob storage and send no
  `Access-Control-Allow-Origin` at all, so `fetch()` cannot read them. GitHub
  *Pages* does send `*` — that is what the English model relies on.

`VITE_VOSK_MODEL_URL_EN` overrides the English model the same way; set it to
move off the third-party host, which is a personal GitHub Pages site and the
one piece of this feature that depends on someone else staying online.

## Android

`getUserMedia` in the Capacitor WebView goes through
`BridgeWebChromeClient.onPermissionRequest`, which requests **both**
`RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS` — both are declared in
`AndroidManifest.xml` or the runtime prompt fails silently.

`RECORD_AUDIO` also makes Play imply a *required* microphone, which would hide
the app from devices without one, so the manifest opts back out with
`<uses-feature android:name="android.hardware.microphone" android:required="false" />`.
