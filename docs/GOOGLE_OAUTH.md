# Google OAuth setup (and `redirect_uri_mismatch`)

FlowDay talks to Google on two independent paths. They use **different**
redirect URIs, and each one has to be registered separately in the Google Cloud
console — the same `Error 400: redirect_uri_mismatch` page comes out of both, so
the first job when it appears is working out which path produced it.

| Path | Triggered by | Who sends `redirect_uri` |
| --- | --- | --- |
| **Account sign-in** | "Continue with Google" on the login screen (`AuthGate.tsx` → `signInWithGoogle` in `src/lib/sync.ts`) | Neon Auth's hosted server |
| **Gmail / Calendar** | "Connect" under Google integrations in Settings (`src/lib/google.ts`) | The app itself, in the browser |

Which one you hit is visible in the failing URL: expand the address bar on the
error page and look at the `redirect_uri=` parameter. If it points at
`*.neonauth.*.neon.tech`, it's account sign-in. If it points at the app's own
origin (`https://flowday.day/`), it's the Gmail/Calendar connect.

Everything below lives in **Google Cloud console → APIs & Services →
Credentials → the OAuth 2.0 "Web application" client** whose id is in
`VITE_GOOGLE_WEB_CLIENT_ID` (`.env`).

## 1. Gmail / Calendar connect (client-side flow)

`ensureInit()` in `src/lib/google.ts` pins the redirect target to the app root
via `googleRedirectUri()` — `window.location.origin + "/"`. Without that pin the
plugin would derive it from `origin + pathname`, which changes with the current
route and needs a separate console entry per route.

Register these, exactly, **with the trailing slash**, under both **Authorized
JavaScript origins** (origin only, no slash) and **Authorized redirect URIs**
(with slash):

| Authorized JavaScript origin | Authorized redirect URI |
| --- | --- |
| `https://flowday.day` | `https://flowday.day/` |
| `https://focus-flow-buddy-75.lovable.app` | `https://focus-flow-buddy-75.lovable.app/` |
| `https://focus-flow-buddy-75.kacper-szymanski1990.workers.dev` | `https://focus-flow-buddy-75.kacper-szymanski1990.workers.dev/` |
| `http://localhost:8080` | `http://localhost:8080/` |

Any other host that serves the app (a new custom domain, a Lovable preview
deploy on a different subdomain) needs its own pair — Google matches these
strings exactly, `www.` and a bare domain are different entries, and `http` and
`https` are different entries.

To confirm what the running app is actually asking for, open the browser console
before pressing Connect: the app logs

```
[Google] OAuth redirect_uri: https://flowday.day/
```

That string is what belongs in Authorized redirect URIs, character for
character. Console changes can take a few minutes to propagate.

Android does **not** use any of this — Credential Manager signs in against the
Android OAuth client (package name + SHA-1 fingerprint), with no redirect URI
involved.

## 2. Account sign-in (Neon Auth hosted flow)

On web, `signInWithGoogle()` hands off to Neon Auth, which runs the OAuth
exchange server-side. The `redirect_uri` Google sees is **Neon's callback**, not
the app's URL, so adding `https://flowday.day/` does nothing for this path.

Register Neon Auth's callback URL under Authorized redirect URIs. Neon shows the
exact value in its console next to the Google provider settings; with the
current `VITE_NEON_AUTH_URL` it is the auth base URL plus `/callback/google`:

```
https://ep-square-tree-asb1wx01.neonauth.c-4.eu-central-1.aws.neon.tech/neondb/auth/callback/google
```

Copy it from the Neon console rather than typing it from here — if the project's
auth endpoint ever moves, this document goes stale and the console does not.

Two related settings sit on the Neon side, and both produce *different* errors
worth not confusing with a mismatch:

- The Google **client id and client secret** are pasted into Neon Auth's Google
  provider. If Neon has its own development keys there instead, the mismatch has
  to be fixed against *that* client, not the one in `.env`.
- Every origin serving the app must be in `neon_auth.project_config.trusted_origins`,
  or sign-in fails earlier with "Invalid origin" (see CLAUDE.md).

## Checklist when the error comes back

1. Read `redirect_uri=` off the failing Google URL → identifies the path.
2. Compare it character for character with the console entry (scheme, `www.`,
   port, trailing slash).
3. Confirm you are editing the OAuth client whose id matches — `.env` for the
   Gmail/Calendar path, whatever is pasted into Neon Auth for sign-in.
4. Wait a few minutes, then retry in a fresh tab.
