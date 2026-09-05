# FlowDay Premium

Unlocks two things:

- **the browser version** — the web build refuses to run without it
- **no AdMob banner** in the Android app

Android itself stays free and ad-supported. That's deliberate: the phone app is
the shop window, and it's the only place Play Billing can run.

## Two ways to pay

| Plan | Price | Play product | Play type |
| --- | --- | --- | --- |
| Monthly | 14,99 zł / month | `focus_flow_premium_monthly` (base plan `monthly`) | subscription |
| One-off | 150 zł once | `focus_flow_premium` | one-time product |

They unlock **exactly the same things**. No feature anywhere asks which plan is
running — every gate goes through `isPremium()` / `usePremium()`, and the plan
is recorded only so Settings can say what the customer is on and link a
subscriber to Play to manage it.

The prices in `PLAN_LIST_PRICE` (`premium.ts`) are what the Play products are
configured with. Play's own localized price wins wherever it is available; the
constants are the fallback for the browser build, which has no Play Billing, and
for the moment before Play answers on Android. **Change one and change the
other**, or the app quotes a price that checkout then contradicts.

150 zł is a little under ten months of the subscription, which is why the
one-off carries a plain "best value" note. That is the only steer between the
two — no countdown, no crossed-out price.

## Early access: premium is currently free for everyone

`PREMIUM_FREE_FOR_ALL` in `premium.ts` is **on**. The app is not on Play
production yet, so nobody can buy the product — gating features behind it would
leave most of the app untestable for testers.

What the switch does:

- `isPremium()` / `usePremium()` return a stand-in entitlement with
  `source: "free"`, so the web `PremiumGate` never appears and dictation works
  for everyone.
- **Nothing is written to storage**, so no synthetic entitlement reaches sync.
  Flipping the switch off returns every account to its real state, and real
  purchases made meanwhile are untouched.
- The AdMob banner is *not* affected: `ads.ts` asks `hasPurchasedPremium()`,
  which only a real purchase satisfies. The free tier keeps looking the way it
  will ship, and the banner keeps getting exercised.
- Settings shows an "Everything is unlocked" card instead of a buy button —
  offering to sell what's currently free would be misleading. Restore stays
  available on Android.

To end early access: set `VITE_PREMIUM_FREE_FOR_ALL=false` (build env) or change
the default in `premium.ts`. Everything below describes the paid behaviour that
returns when it's off.

## How an unlock travels

```
Android: Play checkout -> BillingPlugin.java -> billing.ts -> grantPremium()
             (either plan; same entitlement)
             writes ff.premium.v1 in localStorage
                        |
             sync.ts pushes the key to user_data (Neon)
                        |
Browser:     sync.ts pulls it (15s poll / focus / "Check again")
             usePremium() re-reads -> PremiumGate unmounts
```

No new server is involved in that path — the entitlement rides the same
last-writer-wins localStorage mirror as tasks and habits. Both devices must be
signed in to the **same account**; a guest install has nowhere to sync to, which
is why guest mode is Android-only — the browser build shows `AuthGate` with no
way past it, so anyone reaching `PremiumGate` is already signed in.

### Why a stale local entitlement is never pushed

localStorage outlives a sign-out — `signOut()` deliberately leaves task data on
the device. That made the entitlement leak between accounts: user A is premium,
signs out, user B signs in, and `doFullSync`'s "local data the server has never
seen" branch pushed A's leftover `ff.premium.v1` into **B's** cloud row as a
genuine purchase. It then propagated to every device B signed in on.

Three things now prevent it:

1. `signOut()` deletes `ff.premium.v1` — the entitlement belongs to the account,
   not the device.
2. The "first device" push branch skips premium entirely. An entitlement may
   only be created by a Play purchase (which pushes through the save listener)
   or by an admin writing the row; never inferred from local state.
3. On a pull where the server has no premium row, the web build deletes any
   local one. On the web the server is its only possible source, so that is
   conclusive. Android is exempt — an offline purchase legitimately exists
   locally before it can be pushed, and Play is the authority there.

### Why the entitlement is never written as `false`

Sync is last-writer-wins per key. If a fresh browser wrote
`{active: false}` on boot, it would overwrite a real purchase in the cloud.
So `premium.ts` only ever writes:

- a **grant**, on purchase or restore
- a **revocation tombstone**, on an explicit Play refund signal

Absence of the key means "not premium". An empty `restore()` result is likewise
never treated as a revocation — offline and never-purchased look identical from
the client.

## Files

| File | Role |
| --- | --- |
| `src/lib/premium.ts` | Entitlement state, storage, unlock-service calls, `usePremium()` |
| `src/lib/billing.ts` | JS side of Play Billing; turns purchases into entitlements |
| `android/…/BillingPlugin.java` | Play Billing client, purchase flow, acknowledgement |
| `src/components/Premium.tsx` | Settings section: buy / restore / link / email |
| `src/components/PremiumGate.tsx` | Full-screen lock for the browser build |
| `src/lib/ads.ts` | Skips and removes the banner when premium is active |
| `workers/premium-unlock/` | Optional: Play verification + welcome email |

## Play Console setup

Both products have to exist and be **active**, or the plan they back shows the
fallback list price and its button fails at checkout with "Product not found in
Play Console".

1. **Monetize → In-app products** → create a product with id
   `focus_flow_premium` (must match `PREMIUM_PRODUCT_ID` in `premium.ts`),
   type *one-time*, price **150 zł**, and **activate** it.
2. **Monetize → Subscriptions** → create a subscription with id
   `focus_flow_premium_monthly` (`PREMIUM_SUBSCRIPTION_ID`), then add a base
   plan with id `monthly` (`PREMIUM_BASE_PLAN_ID`): **auto-renewing**, monthly,
   **14,99 zł**. Activate both the subscription and the base plan — a
   subscription with no active base plan returns no offers, and the app refuses
   to open checkout rather than guessing one.
   The base plan must be *auto-renewing*, not prepaid: `BillingPlugin.load()`
   enables pending purchases for one-time products only, and a prepaid plan
   additionally needs `enablePrepaidPlans()`.
3. Upload a build signed with the upload key to at least an internal test
   track. `queryProductDetailsAsync` returns nothing for unsigned/unpublished
   builds — that's the usual cause of "Product not found in Play Console".
4. Add testers under **License testing** so they can buy without being charged.
   Test subscriptions renew on an accelerated clock (a monthly plan renews
   every few minutes), which is how to exercise renewal and expiry.

### What the app does with each

`BillingPlugin.java` carries the product *type* on every call, because Play
keeps the two apart everywhere: separate `queryProductDetails` queries,
separate `queryPurchases` queries (`restore()` asks for both and merges), and
subscriptions additionally need an **offer token** naming the base plan being
bought. The token is resolved inside the plugin from the same query that
launches checkout — it is only valid for the `ProductDetails` it came from, so
it is deliberately not passed in from JS.

A customer holding both keeps the one-time entitlement: `restorePremium()`
prefers it, because it is the one that never needs re-checking.

Billing Library is pinned to **9.1.0** in `android/gradle/libs.versions.toml`.
Play enforces a minimum library version on a rolling deadline — 8.0.0+ from
31 Aug 2026, which is why this moved off 7.1.1. Everything `BillingPlugin.java`
uses has the same shape in 8.x and 9.x, so 9.1.0 also covers the next deadline.
The one API that changed is the `queryProductDetailsAsync` callback: since 8.0
its second argument is a `QueryProductDetailsResult` (call
`getProductDetailsList()`) rather than a bare `List<ProductDetails>`.

## Subscription lifetime

A one-time purchase is settled once and never changes. A subscription does, and
the client cannot see that on its own — Play's on-device `queryPurchases` says
only "this is currently valid", with no expiry attached. So:

- The unlock service reports `expiresAt` and `autoRenewing` from
  `purchases.subscriptionsv2`, and the entitlement stores both.
- Those fields are **informational, never a gate**. A date in the past does not
  lock anyone out: a renewal we haven't heard about yet is indistinguishable
  from a lapse, and this codebase's standing rule is that a paying customer is
  never locked out by our uncertainty.
- What *does* end access is the service answering `revoked`, exactly as it does
  for a refund. `syncEntitlementWithService()` re-asks once the recorded period
  is inside its last day, which is what turns a real cancellation into a
  tombstone that syncs to every device.
- With no `VITE_PREMIUM_UNLOCK_URL` configured there is no `expiresAt` and no
  `revoked` answer, so subscriptions are trusted client-side for as long as
  they sit in local storage. That is the same trade already made for one-time
  purchases without the service, and it's why the service is worth deploying
  once subscriptions are live.
- A subscription keeps its purchase token across renewals, so `grantPremium()`
  treats a re-grant as the same purchase. It drops a recorded expiry that has
  already passed: Play only hands back a subscription it still considers live,
  so being re-granted with a stale date means the period rolled over.

Settings shows a subscriber "Renews on …" (or "Ends on …" once auto-renew is
off) and a link to Play, which is where cancelling and changing plans happens.
Play policy requires that link; the app never cancels on a customer's behalf.

## Verification and the welcome email

Without `VITE_PREMIUM_UNLOCK_URL` set, purchases are trusted **client-side** and
no email is sent. That is honest but spoofable — someone who can write
localStorage can grant themselves premium. The cost of a forged unlock is one
free web session, not access to anyone else's data (RLS still governs that).

Setting `VITE_PREMIUM_UNLOCK_URL` to the deployed
`workers/premium-unlock/` Worker upgrades this: every purchase token is checked
against the Play Developer API, and the customer is emailed the browser link.
See that directory's README for setup. It is a **separate** Worker — the app's
own Vite/Nitro pipeline is fragile and must keep emitting a static SPA for
Capacitor, so nothing was added to it.

## Who has premium?

There is no file and no admin screen. The entitlement is database state: one row
per user in `public.user_data` with `key = 'ff.premium.v1'`, holding the JSON
that `src/lib/premium.ts` defines. The key name lives in `src/lib/storage.ts`;
`src/lib/sync.ts` lists it in `SYNC_KEYS`, which is what makes it travel between
devices. Those files define the *shape* — the data itself is only in Neon.

```bash
node scripts/list-premium.mjs          # accounts with a premium record
node scripts/list-premium.mjs --all    # every account, premium or not
```

Or straight SQL. Accounts live in `neon_auth."user"` — `user` is a reserved
word, so the quotes are mandatory:

```sql
select u.email, ud.value, ud.updated_at
from public.user_data ud
left join neon_auth."user" u on u.id = ud.user_id
where ud.key = 'ff.premium.v1'
order by ud.updated_at desc;
```

### A browsable view

There is no `premium` column on the user table, and there shouldn't be —
`neon_auth` is managed by Neon Auth, and anything added there risks being
overwritten by its own sync. For a table you can just open in the Neon console,
create a view instead. It reads the same rows, so there's no second source of
truth to drift:

```sql
create or replace view public.premium_users
with (security_invoker = true) as
select u.email,
       u.id                             as user_id,
       coalesce((ud.value->>'active')::boolean, false) as premium,
       ud.value->>'source'              as source,
       -- Written since subscriptions arrived; older rows are all one-time.
       coalesce(ud.value->>'plan', 'lifetime') as plan,
       ud.value->>'expiresAt'           as expires_at,
       (ud.value->>'verified')::boolean as verified,
       ud.value->>'purchasedAt'         as purchased_at,
       ud.updated_at
from neon_auth."user" u
left join public.user_data ud
       on ud.user_id = u.id and ud.key = 'ff.premium.v1';
```

```sql
select * from public.premium_users where premium;
```

Deliberately not granted to the `authenticated` role, so the Data API can't
serve it — it's for admin use over `DATABASE_URL` only. `security_invoker` keeps
RLS applying to whoever queries it, rather than the view's owner.

A row is not automatically a customer: `active: true` is a grant, `active:
false` is a revocation tombstone. Check the flag, not the row's existence.

## Granting premium manually

For comps, testers, refunds handled out of band, or your own account:

```bash
node scripts/grant-premium.mjs someone@example.com
node scripts/grant-premium.mjs someone@example.com --revoke
```

It writes the same `ff.premium.v1` row a purchase would, straight into
`public.user_data` using `DATABASE_URL` from `.env.local` — so it reaches every
device that account signs in on, not just one browser. The person must have
signed up already; the script looks their id up in `neon_auth` and refuses if
there's no match.

Manual grants are stored with `source: "manual"` and `verified/emailSent`
pre-set, so the client never asks the unlock service to verify a Play purchase
token that doesn't exist. `reconcilePurchases()` on Android won't clear them
either — an empty Play `restore()` is never a revocation.

To unlock just one browser for a quick test, this in the devtools console does
it without touching the database:

```js
localStorage.setItem('ff.premium.v1', JSON.stringify({
  active: true, source: 'manual', productId: 'focus_flow_premium',
  plan: 'lifetime', orderId: null, purchasedAt: new Date().toISOString(),
  verified: true, emailSent: true,
}));
location.reload();
```

Note that this is not purely local: if that browser is signed in, sync sees a
key the server has never heard of and pushes it, so the grant propagates to the
account anyway. The browser has no guest mode to fall back on, so use a signed-out
Android install if you want a grant to stay on one machine.

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_WEB_APP_URL` | https://flowday.day/ | Link shown in Settings and sent by email |
| `VITE_PREMIUM_UNLOCK_URL` | *(empty)* | Unlock service; empty = trust locally, no email |
| `VITE_PREMIUM_WEB_GATE` | `true` | `false` leaves the browser build open (demo deploys) |

All three are baked into the bundle at build time — changing one needs a rebuild
of both the web bundle and the APK.

## Testing checklist

- [ ] Android, non-premium: banner shows, Settings offers both plans with the
      prices coming from Play (not the fallback constants)
- [ ] Android, buy monthly: Play sheet completes, banner disappears without a
      restart, Settings says "Monthly plan"
- [ ] Android, buy one-off: same, and Settings says "One-off purchase"
- [ ] Android, subscriber: "Manage subscription" opens the Play subscription page
- [ ] Android, reinstall: "Restore purchase" re-unlocks, on either plan
- [ ] Browser, non-premium: `PremiumGate` blocks the app
- [ ] Browser, same account after a phone purchase: unlocks within ~15s, or
      immediately via "Check again"
- [ ] Browser, signed out: `AuthGate` shows with no "continue as guest" option
- [ ] Play refund → unlock service returns `revoked` → access is withdrawn
- [ ] Subscription cancelled → Settings switches to "Ends on", access survives
      to the end of the paid period
- [ ] Subscription expired (test track's accelerated clock) → next launch
      re-checks, unlock service returns `revoked`, access is withdrawn
