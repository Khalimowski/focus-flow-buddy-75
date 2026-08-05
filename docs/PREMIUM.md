# Focus Flow Premium

One-time Play purchase that unlocks two things:

- **the browser version** — the web build refuses to run without it
- **no AdMob banner** in the Android app

Android itself stays free and ad-supported. That's deliberate: the phone app is
the shop window, and it's the only place Play Billing can run.

## How an unlock travels

```
Android: Play checkout -> BillingPlugin.java -> billing.ts -> grantPremium()
             writes ff.premium.v1 in localStorage
                        |
             sync.ts pushes the key to user_data (Neon)
                        |
Browser:     sync.ts pulls it (15s poll / focus / "Check again")
             usePremium() re-reads -> PremiumGate unmounts
```

No new server is involved in that path — the entitlement rides the same
last-writer-wins localStorage mirror as tasks and nudges. Both devices must be
signed in to the **same account**; a guest install has nowhere to sync to, which
is why PremiumGate tells guests to sign in first.

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

1. **Monetize → In-app products** → create a product with id
   `focus_flow_premium` (must match `PREMIUM_PRODUCT_ID` in `premium.ts`),
   type *one-time*, and **activate** it.
2. Upload a build signed with the upload key to at least an internal test
   track. `queryProductDetailsAsync` returns nothing for unsigned/unpublished
   builds — that's the usual cause of "Product not found in Play Console".
3. Add testers under **License testing** so they can buy without being charged.

Billing Library is pinned to **7.1.1** in `android/gradle/libs.versions.toml`.
Play enforces a minimum library version on a rolling deadline; when that moves
past 7.x, bumping to 8.x also requires updating the
`queryProductDetailsAsync` callback in `BillingPlugin.java` (8.0 changed it to
return a `QueryProductDetailsResult` instead of a `List<ProductDetails>`).

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

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_WEB_APP_URL` | workers.dev URL | Link shown in Settings and sent by email |
| `VITE_PREMIUM_UNLOCK_URL` | *(empty)* | Unlock service; empty = trust locally, no email |
| `VITE_PREMIUM_WEB_GATE` | `true` | `false` leaves the browser build open (demo deploys) |

All three are baked into the bundle at build time — changing one needs a rebuild
of both the web bundle and the APK.

## Testing checklist

- [ ] Android, non-premium: banner shows, Settings offers the price from Play
- [ ] Android, buy: Play sheet completes, banner disappears without a restart
- [ ] Android, reinstall: "Restore purchase" re-unlocks
- [ ] Browser, non-premium: `PremiumGate` blocks the app
- [ ] Browser, same account after a phone purchase: unlocks within ~15s, or
      immediately via "Check again"
- [ ] Browser, guest: gate points at signing in
- [ ] Play refund → unlock service returns `revoked` → access is withdrawn
