# Voice input (offline dictation)

**Dictation is a Premium feature** (`premium_perk_voice` in the perk list).
`MicButton` checks `usePremium()`; without an entitlement the button still
renders — a paid feature nobody can see is one nobody buys, and a control that
vanishes reads as a bug — but tapping it shows `voice_premium_locked` instead
of starting a session, and a sparkle marks it as locked rather than broken.
Because the check is `usePremium()` it re-reads on `ff.premium-changed` and on a
sync pull, so a purchase made on the phone unlocks the mic without a restart.

In practice this only bites on Android, which is otherwise free and
ad-supported; the browser build is behind `PremiumGate` in its entirety, so
anyone who can see the composer already has premium.

The mic next to the add button on the **Tasks** tab dictates a task title.
Recognition is [Vosk](https://alphacephei.com/vosk/) — a WASM build of Kaldi via
[`vosk-browser`](https://github.com/ccoreilly/vosk-browser) — running inside the
page. Nothing is sent anywhere: after the one-time model download, dictation
works with the phone in airplane mode.

Code: `src/lib/speech.ts` (engine), `src/components/MicButton.tsx` (UI),
`src/lib/voice-time.ts` (spoken times and dates), wired into
`src/components/TaskList.tsx`.

`MicButton` fires exactly one of two callbacks per session: `onTranscript` when
words were recognised, or `onEmpty` when none were. That pairing is what lets
the caller clear the field on `onStart` without risking the user's text.

## How a session runs

1. First tap fetches the language model (~40 MB) with a progress readout, stores
   it in Cache Storage (`ff-vosk-models-v1`), and hands it to Vosk as a blob URL.
   Later taps skip straight to step 2 — including after a restart.
2. `getUserMedia` → `AudioContext` → `ScriptProcessorNode` feeds the recogniser.
   The processor is routed through a **muted** gain node, because a
   ScriptProcessorNode only runs while it reaches the destination and wiring the
   mic to the speakers would feed back.
3. The field is cleared the moment you tap, and interim results stream into it
   as you talk — so each take replaces the last instead of piling onto it. The
   old text is kept in a ref and put back if the session ends having produced
   nothing at all (silence, a refused mic, a failed download, or a cancel
   before it started listening), so a failed dictation costs nothing.
4. It stops **2 s after the recogniser last picked up a word**, or on a second
   tap, or after 8 s if you never said anything, or at a 60 s ceiling.

"Quiet" is measured as *no new words recognised*, not as raw loudness. A
volume threshold never trips in a café or a car; word stagnation still ends the
session the moment you stop talking.

The loaded model holds ~50 MB in its worker, so it is terminated after 3 minutes
idle and reloaded (from cache, no network) on the next tap.

## Spoken times and dates

`src/lib/voice-time.ts` pulls the *when* out of the finished transcript, so
"dentist tomorrow at half past four" sets the day to tomorrow, the time picker
to 16:30, and leaves "Dentist" as the title. Without it every spoken time
stayed baked into the title and the task got no reminder at all.

`extractSchedule()` returns `{ time, date, title }`, either of the first two
possibly null. **Time and date are matched independently**, each claiming its
own span of words, so they can come in either order and either can be absent —
a date with no time is just a task on that day with no reminder. The date scan
skips any word the time scan already claimed, so "at four" in "in four days at
four" can't be read twice.

`now` is injectable (`extractSchedule(text, lang, now)`) so the relative forms
can be tested against a fixed day.

It runs **only on the final transcript**, never on interim results — those
rewrite their own tail every word or two, so "at four" would set 16:00 a moment
before "at four thirty" arrives.

English and Polish get **separate matchers**, not one table of translated
words, because they don't share a grammar:

| | English | Polish |
| --- | --- | --- |
| Hour | preposition + cardinal: `at four` | inflected ordinal: `o piątej`, `o siedemnastej` |
| Minutes | `four thirty`, `four oh five` | `piątej trzydzieści` |
| Half hour | `half past four` = 4:30 | `wpół do piątej` = **4:30**, counting *toward* five |
| Quarter | `quarter past/to four` | `kwadrans po piątej`, `za kwadrans piąta` |
| Absolute | `noon`, `midday`, `midnight` | `w południe`, `o północy` |
| Part of day | `am`/`pm`/`a m`/`p m`, `in the morning`, `in the evening`, `tonight` | `rano`, `nad ranem`, `po południu`, `wieczorem`, `w nocy` |
| Lead-ins | `at`, `around`, `by` | `o`, `około`, `na` |

`7:30` and 24-hour forms (`seventeen thirty`, `o siedemnastej`) work in both.

Dates, same split:

| | English | Polish |
| --- | --- | --- |
| Named days | `today`, `tomorrow`, `(the) day after tomorrow` | `dziś`/`dzisiaj`, `jutro`, `pojutrze` |
| Counted ahead | `in three days`, `in a week`, `in two weeks` | `za trzy dni`, `za tydzień`, `za dwa tygodnie` |
| Next period | `next week`, `next month` | `w przyszłym tygodniu`, `w przyszłym miesiącu` |
| Weekday | `on monday`, `by friday`, `this saturday`, `Monday standup` | `w poniedziałek`, `we wtorek`, `na poniedziałek`, `w przyszły poniedziałek` |
| Day of month | `on the fifteenth`, `on the twenty first`, `on the 30th` | `piętnastego`, `dwudziestego pierwszego` |
| With a month | `on the third of september`, `on march fifteenth` | `trzeciego września`, `piętnastego marca` |

A weekday resolves to the **next one strictly ahead** — "Monday" said on a
Monday means the coming Monday, since someone who means today has a shorter
word for it. A day of the month walks forward to the next month (or year) that
actually has that day, so "the 31st" never lands on the 1st.

Polish diacritics are **folded away** before matching (ą→a, ł→l, ś→s …), so one
spelling in the tables covers a model — or a keyboard — that drops them. It
also collapses the accusative "piątą" onto the nominative "piąta" for free,
which is why "na piątą" needs no third inflection table.

Four rules worth knowing before changing any of it:

- **A bare number is never a time.** In English it needs a lead-in, an am/pm, a
  clock word (`o'clock`, `hundred`, `7:30`), or a `past`/`to` structure —
  otherwise "email twenty people" books 20:00. Hours past twelve count alone
  only when *typed as digits*: "17" is deliberate, "twenty" is counting
  something.
- **Polish `na` is the weak one.** "na piątą" is a time but "na drugą stronę" is
  an ordinary noun phrase built identically, and folding makes them the same
  string. After `na` the hour must end the sentence or carry minutes or a part
  of the day; anything still trailing means it was modifying a noun. `o` is left
  permissive, because "o piątej z Anią" is normal and the locative ordinal is
  almost never anything but a clock.
- **A weekday mid-sentence is describing, not scheduling.** "review Monday
  notes" must not move the task a week, so a bare weekday counts only at the
  start or end of the transcript, or after `on`/`by`/`this`/`next`/`for` (`w`,
  `we`, `na` in Polish). Both edges are allowed because "Monday standup" and
  "call Mark by Friday" are equally natural.
- **Never read the tail of a compound as a number.** The scan tries every
  starting word, so without a guard "the thirty first of September" — a day
  September hasn't got — falls through to matching "first of September" and
  books the wrong date. It now declines the whole phrase instead, which is the
  right answer for an impossible date.
- **"Night" is not a synonym for pm.** "eleven at night" is 23:00 but "two at
  night" is 02:00, and `w nocy` behaves the same way — hence the three-way
  `DayPart` rather than a boolean.
- **The half of the day is fixed, not clever.** An unqualified 1–6 becomes the
  afternoon (so "at five" and "o piątej" are both 17:00); 7–12 stay as spoken. A
  rule that shifted with the current clock would give the same sentence
  different meanings at different times of day, and a wrong time you can predict
  beats one you can't.

Getting it wrong in the safe direction costs one tap on the time picker;
inventing a time nobody said produces a reminder at the wrong hour, so the
matcher declines anything ambiguous.

There is no test suite in this repo; the matcher was checked by importing
`/src/lib/voice-time.ts` in the dev server, passing a fixed `now`, and
asserting against a table of phrasings per language — including the ones that
must *not* match ("kupić pięć jabłek", "przejść na drugą stronę", "za pięć minut
wyjść", "review Monday notes", "the thirty first of September").

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
