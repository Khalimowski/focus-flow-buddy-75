# Premium unlock service

Optional Cloudflare Worker behind `VITE_PREMIUM_UNLOCK_URL`. It does the two
things the client can't do for itself:

1. **Verify** a Play purchase token against the Play Developer API.
2. **Email** the customer the link to the browser version.

**The app works without it.** Leave `VITE_PREMIUM_UNLOCK_URL` empty and
purchases are trusted client-side, the entitlement still syncs to the browser,
and the link is shown in Settings instead of being mailed. Deploying this
upgrades a client-trusted unlock into a Play-verified one.

It is deliberately **not** wired into the app's Vite/Nitro build — that pipeline
is fragile and has to keep emitting a static SPA for Capacitor (see CLAUDE.md).
This is a separate Worker with its own `wrangler.toml`.

## Status

Written but **not deployed or exercised against live Play/Resend credentials**.
Treat the first deploy as the real test: buy the product on an internal test
track and watch the Worker logs.

## Setup

### 1. Play Developer API access

- Google Cloud console → create a service account, download its JSON key.
- Play Console → **Users and permissions** → invite that service account's
  email, grant **View financial data** on the app.
- Propagation takes a few minutes; until then the API answers 401.

### 2. Email sending

Any HTTP mail API works; the Worker ships with [Resend](https://resend.com).
Verify your sending domain, create an API key, and set `MAIL_FROM` to an address
on that domain. To use a different provider, replace `sendWelcomeEmail()`.

### 3. Deploy

```bash
cd workers/premium-unlock
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON   # paste the whole JSON file
npx wrangler secret put RESEND_API_KEY
npx wrangler deploy
```

### 4. Point the app at it

In `.env`:

```
VITE_PREMIUM_UNLOCK_URL=https://focus-flow-premium-unlock.<subdomain>.workers.dev
```

Rebuild the web bundle and the Android APK — the value is baked in at build time.

## Contract

`POST` with JSON:

```jsonc
{
  "email": "user@example.com",   // signed-in Neon Auth address; the recipient
  "productId": "focus_flow_premium",
  "plan": "lifetime",             // "monthly" for the subscription; optional
  "purchaseToken": "...",         // from Play Billing
  "orderId": "GPA.1234-...",
  "appUrl": "https://…",          // link to put in the email
  "sendEmail": true               // false when the welcome mail already went out
}
```

`plan` picks which Play endpoint the token is checked against: `lifetime` goes
to `purchases.products`, `monthly` to `purchases.subscriptionsv2`. It is
optional — a request without it is routed by `productId` instead, so a client
built before subscriptions existed still verifies correctly.

Replies:

| Response | Meaning | App behaviour |
| --- | --- | --- |
| `{ "verified": true, "emailSent": true }` | Play confirms the purchase | Entitlement marked verified |
| `{ "verified": false, "error": "verification_unavailable" }` | Play or config problem | Entitlement kept, retried at next launch |
| `{ "revoked": true }` | Play says the token is cancelled/refunded/expired/unknown | Entitlement removed |

Subscription replies also carry `expiresAt` (ISO, end of the paid period) and
`autoRenewing`. The app stores both: `autoRenewing` decides whether Settings
says "renews on" or "ends on", and `expiresAt` is what tells it when asking
again is worthwhile. Neither is a gate — a date that has passed does not lock
anyone out on its own, because a renewal we simply haven't heard about looks
exactly the same. Only a `revoked` reply withdraws access.

Which subscription states count as revoked:

| `subscriptionState` | Verdict |
| --- | --- |
| `ACTIVE`, `IN_GRACE_PERIOD` | entitled |
| `CANCELED` | entitled until `expiryTime` — auto-renew is off, the period is not over |
| `ON_HOLD`, `PAUSED`, `EXPIRED`, `PENDING_PURCHASE_CANCELED` | revoked |
| `PENDING`, anything unrecognised | pending — changes nothing |

`ON_HOLD` and `PAUSED` are recoverable: once the customer fixes payment or
resumes, Play lists the subscription again, the Android app's restore re-grants
it, and sync carries that back to their other devices.

`revoked` is the only response that takes access away. Outages, misconfiguration
and rate limits all fall back to "keep the customer unlocked, retry later" — a
paying user must never be locked out because this service had a bad day.
