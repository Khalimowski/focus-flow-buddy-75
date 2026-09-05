// Manually grant (or revoke) FlowDay Premium for one user.
//
// Writes the same `ff.premium.v1` row that a Play purchase would produce, so
// the entitlement reaches every device that account signs in on — the browser
// picks it up on its next sync pull (~15s, or immediately via "Check again").
//
//   node scripts/grant-premium.mjs someone@example.com
//   node scripts/grant-premium.mjs someone@example.com --revoke
//
// Uses DATABASE_URL from .env.local (admin credentials, never shipped in the
// app bundle) and bypasses RLS as the table owner, which is exactly why this
// is a local script and not something the app can do to itself.
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const PREMIUM_KEY = "ff.premium.v1";
const PRODUCT_ID = "focus_flow_premium";

const args = process.argv.slice(2);
const revoke = args.includes("--revoke");
const email = args.find((a) => !a.startsWith("--"));

if (!email) {
  console.error("Usage: node scripts/grant-premium.mjs <email> [--revoke]");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [
      l.slice(0, l.indexOf("=")),
      l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, ""),
    ])
);

if (!env.DATABASE_URL) {
  console.error("DATABASE_URL not found in .env.local");
  process.exit(1);
}

const sql = neon(env.DATABASE_URL);

// Neon Auth keeps accounts in neon_auth."user" — "user" is a reserved word in
// SQL, so it needs the quotes every time it's referenced.
const rows = await sql.query(
  `select id, email from neon_auth."user" where lower(email) = lower($1) limit 1`,
  [email]
);
const user = rows[0];

if (!user) {
  console.error(`No Neon Auth user found for ${email}.`);
  console.error("They must have signed up in the app before they can be granted premium.");
  process.exit(1);
}

console.log(`User: ${user.email}  id=${user.id}`);

// Matches the Entitlement / RevokedRecord shapes in src/lib/premium.ts.
// verified+emailSent are pre-set on a manual grant so the client never asks the
// unlock service to verify a purchase token that doesn't exist.
const value = revoke
  ? { active: false, revokedAt: new Date().toISOString(), reason: "manual admin revoke" }
  : {
      active: true,
      source: "manual",
      productId: PRODUCT_ID,
      // A comp never expires, so it is recorded as the one-time plan — that is
      // also what an entitlement with no plan reads as, but writing it makes
      // the admin view say so rather than leaving it to be inferred.
      plan: "lifetime",
      orderId: null,
      purchasedAt: new Date().toISOString(),
      verified: true,
      emailSent: true,
    };

await sql.query(
  `insert into public.user_data (user_id, key, value)
   values ($1, $2, $3::jsonb)
   on conflict (user_id, key) do update
     set value = excluded.value, updated_at = now()`,
  [user.id, PREMIUM_KEY, JSON.stringify(value)]
);

console.log(revoke ? `Revoked premium for ${user.email}.` : `Granted premium to ${user.email}.`);
console.log(
  "Their browser picks this up on the next sync pull (~15s while the tab is open),",
  "\nor immediately via the \"I've purchased — check again\" button on the lock screen."
);
