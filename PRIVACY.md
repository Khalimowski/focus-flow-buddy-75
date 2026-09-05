# Privacy Policy — FlowDay

_Last updated: August 25, 2026_

> The version users and Play reviewers read is served by the app itself at
> [flowday.day/privacy](https://flowday.day/privacy), in English and Polish.
> This file is the same policy in the repo; the two are kept in step by hand, so
> **change both together** (the page lives in `src/routes/privacy.tsx`).

FlowDay ("the app") is a task, reminder and focus app designed for ADHD brains.
It ships as an Android app and as a web app at
[flowday.day](https://flowday.day/). This policy explains what the app stores,
what leaves your device, and who else is involved.

FlowDay is made by an independent developer. Questions, requests or complaints:
**khalim163@gmail.com**.

## The short version

- **Guest mode keeps everything on your phone.** No account, no server, nothing
  transmitted. It is available on Android only.
- **With an account, your task data syncs** to a private row in our database in
  the EU so your phone and your browser stay in step. We do not read, mine,
  profile or sell it.
- **There is no analytics SDK and no crash-reporting SDK.** The Insights screen
  is calculated on your device from your own data.
- **The free Android version shows ads** (Google AdMob), which use the Android
  advertising ID. Premium removes them.
- **Google Calendar/Gmail and voice dictation are optional and off by default.**

## Guest mode vs. an account

**Guest mode (Android only).** Tap "continue as guest" and the app never
contacts our servers at all. Everything under "Data stored on your device"
applies; nothing under "Data that syncs to the cloud" does. Uninstalling the app
deletes the data.

**With an account.** Signing in exists so the same tasks appear on your phone and
in the browser. The browser version always requires an account — there is no
guest mode on the web.

## Data stored on your device

Saved in the app's private storage (Android) or your browser's local storage:

- Tasks, to-do items, and habits (recurring reminders) you create
- Your streak, and per-day activity counters that power the Insights screen
- The short "AI coach" profile you can fill in: life stage, usual work or school
  hours, and which sports you do on which days
- App preferences (theme, language, notification, calendar and vibration
  settings)
- AI-coach suggestion history and in-app notifications
- Your Premium entitlement, if you bought it
- Your Google access token, if you connected Google (see below)

You can inspect what the coach has recorded under **Settings → AI Insights →
Inspect AI Memory**.

## Data that syncs to the cloud (accounts only)

When you are signed in, these values are mirrored to your own row in our
database and pulled back onto your other devices:

- Tasks, to-do items, habits, and your streak
- The AI-coach profile answers listed above
- The Insights activity counters
- Your Premium entitlement
- Whether the Google Calendar/Gmail features are switched on

**Where it lives.** A managed Postgres database run by Neon, hosted on AWS in
`eu-central-1` (Frankfurt, EU). Every row is protected by Postgres row-level
security keyed to your account, so one account cannot read another's data. The
values are stored exactly as your device wrote them — they are not analysed,
enriched, or shared with anyone.

**There is no application server.** The app talks to the database directly from
your device, which is also why the same code can run inside the Android app.

**Deliberately not synced:** your Google access token, your theme and language,
device-local prompts, and anything to do with dictation.

## Your account

Accounts are handled by Neon Auth. We store your **email address** and a
**hashed password** (we never see the password itself), plus the session that
keeps you signed in. Your email address is used to sign you in, to send a
one-time code if you reset your password, and — if you buy Premium — to send you
the link to the browser version. It is not used for marketing and is not shared.

## Permissions the app requests and why

- **Notifications** — to show the task reminders and daily habits you schedule.
  Optional.
- **Exact alarms** — so reminders fire at the exact time you chose, even when the
  app is closed.
- **Calendar (read/write)** — only if you enable "Sync to Calendar" in Settings,
  to add and remove your own tasks and habits in your device calendar. Optional;
  off by default.
- **Microphone** — only for voice dictation, which runs offline (see below).
  Optional; decline it and the dictation button stays hidden.
- **Run at startup** — to re-register your scheduled reminders after the phone
  reboots.
- **Advertising ID** — used by the ad banner in the free version only.
- **Internet** — for cloud sync, the optional Google features, the update check,
  and ads.

## Optional: Google Calendar and Gmail

Off by default. If you turn them on in Settings, the app asks Google for
permission and then:

- **Calendar** (`calendar.events`) — creates, updates and removes calendar events
  for the tasks and habits *you* made in FlowDay. It does not read the rest of
  your calendar.
- **Gmail** (`gmail.readonly`) — reads only the **Subject, From and Date headers**
  of recent inbox messages, so you can turn an email into a task. The app
  requests message metadata only; message bodies and attachments are never
  fetched.

Nothing from Google is sent to our servers. It is fetched by the app on your
device, and a task you create from it is treated like any other task you typed.
Your Google access token stays on the device that granted it and is never
synced. You can revoke access at any time at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions).

FlowDay's use of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements.

## Optional: voice dictation

Speech recognition runs **offline, inside the app**, using a WebAssembly build of
Vosk. Your audio is never uploaded, never recorded and never stored — it is
turned into text on the device and discarded.

The first time you use dictation, the app downloads a speech model (tens of
megabytes) from a public static host (`ccoreilly.github.io`, GitHub Pages). That
host sees an ordinary file download — IP address and user agent, as any web
server does. No audio and no personal data are sent with it.

## Ads (free Android version)

The free Android version shows a banner from **Google AdMob**. AdMob uses the
Android **advertising ID** and standard ad-request data (IP address, device and
app information) to select and measure ads; that processing is Google's and is
governed by [Google's privacy policy](https://policies.google.com/privacy).
Where the law requires it, Google's consent prompt is shown before personalised
ads are requested.

You can reset or delete your advertising ID in Android **Settings → Privacy →
Ads**. Buying Premium removes the banner entirely. The web version has no ads.

## Purchases

Premium is sold through **Google Play**, either as a monthly subscription or
as a one-time purchase — both unlock exactly the same thing. Google handles
the payment; we never see your card or billing details. A subscription renews
until you cancel it, which you can do at any time in Google Play; cancelling
stops future charges and Premium runs to the end of the period you have
already paid for.

To confirm that a purchase is genuine and to email you the link to the browser
version, the app can send your **purchase token, order id, product id and
account email** to a small service we run on Cloudflare Workers. That service
checks the token against Google Play's API and sends you a single email through
the delivery provider Resend. The address is not added to any list and is not
used for anything else.

## Update check

The Android app fetches a small public `version.json` file from GitHub
(`raw.githubusercontent.com`) to tell you when a newer build exists. GitHub logs
standard connection metadata such as your IP address, as any web server does. No
personal data is sent with the request.

## Analytics and tracking

**None.** The app contains no analytics SDK, no crash-reporting SDK and no
tracking pixels. The Insights and streak screens are computed on your device
from data you already have. The only third party that receives device-level
advertising data is AdMob, described above, and only in the free Android
version.

One exception worth naming: a preview build of the web app is hosted on Lovable
at `focus-flow-buddy-75.lovable.app`, and that hosting environment can capture
JavaScript error reports. The Google Play app and `flowday.day` do not.

## Hosting

The web app is served by Cloudflare Workers, which processes standard request
logs (IP address, user agent, requested URL) as part of delivering the site.

## Children

FlowDay is not directed at children under 13, and we do not knowingly collect
personal data from them. If you believe a child has created an account, email us
and we will delete it.

## Deleting your data

- **Delete your account and everything in it:**
  [flowday.day/delete-account](https://flowday.day/delete-account). It works
  without installing the app. You confirm with your email and password; the page
  then deletes every synced row, deletes the account itself, and wipes the copy
  on the device you used.
- **Guest mode / local data:** uninstalling the app — or clearing site data in
  the browser — removes it. There is nothing else to delete.
- **Prefer email?** Write to khalim163@gmail.com and we will delete your account
  for you.

## Retention

Synced rows stay until you change them, delete them, or delete your account. Our
database provider keeps short-lived automatic backups as part of its service;
those expire on the provider's own schedule and are not used for anything else.

## Your rights

If you are in the EU/EEA or the UK, you have the right to access, correct,
export or delete your personal data, and to object to its processing. The
deletion page above covers the common case immediately; for anything else, email
khalim163@gmail.com.

We do not sell personal data, and we do not share it with advertisers or data
brokers.

## Changes

If this policy changes, the updated version is published at the same URL with a
new date.

## Contact

Questions about this policy: khalim163@gmail.com
