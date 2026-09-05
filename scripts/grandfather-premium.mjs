// Grandfather every existing account into free FlowDay Premium.
//
// Run this ONCE, when early access ends — and run it BEFORE the build with
// PREMIUM_FREE_FOR_ALL off reaches anyone. Until it has run, the people who
// have been using FlowDay all along have no record of it anywhere: the early-access
// unlock deliberately wrote nothing to storage or to sync, so the moment that
// switch goes off every account reads as "never paid". This script is what
// turns "was here during early access" into durable state.
//
//   node scripts/grandfather-premium.mjs            # dry run, writes nothing
//   node scripts/grandfather-premium.mjs --apply    # actually write the rows
//
// It writes the same `ff.premium.v1` row a purchase would, with
// `source: "grandfathered"`, so it travels to every device the account signs in
// on through the ordinary sync path. That is the sanctioned way to create an
// entitlement — sync.ts refuses to invent one from local state, and the browser
// deletes any local entitlement the server doesn't know about.
//
// Two things it will NOT do:
//   - overwrite an existing entitlement (a real purchase keeps its own record)
//   - overwrite a revocation tombstone, which would hand access back to someone
//     whose purchase was refunded
// Both fall out of `on conflict do nothing`: this only ever fills in accounts
// that have no premium row at all.
//
// Uses DATABASE_URL from .env.local, same as grant-premium.mjs / list-premium.mjs.
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const PREMIUM_KEY = "ff.premium.v1";
const PRODUCT_ID = "focus_flow_premium";

const apply = process.argv.includes("--apply");

// .env.local is gitignored — it holds admin credentials, so a fresh clone
// never has one. Fall back to the environment so this can also be run as
// DATABASE_URL=... node scripts/grandfather-premium.mjs.
function readEnvFile(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.includes("="))
        .map((l) => [
          l.slice(0, l.indexOf("=")),
          l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, ""),
        ])
    );
  } catch {
    return {};
  }
}

const databaseUrl = process.env.DATABASE_URL || readEnvFile(".env.local").DATABASE_URL;

if (!databaseUrl) {
  console.error("No DATABASE_URL found.");
  console.error("Put it in .env.local (same file setup-neon.mjs and grant-premium.mjs use),");
  console.error("or pass it inline:  DATABASE_URL=... node scripts/grandfather-premium.mjs");
  process.exit(1);
}

const sql = neon(databaseUrl);

// Matches the Entitlement shape in src/lib/premium.ts. verified/emailSent are
// pre-set so the client never asks the unlock service to check a Play purchase
// token that does not exist; plan "lifetime" keeps it out of the subscription
// re-check path for the same reason.
const entitlement = {
  active: true,
  source: "grandfathered",
  productId: PRODUCT_ID,
  plan: "lifetime",
  orderId: null,
  purchasedAt: new Date().toISOString(),
  verified: true,
  emailSent: true,
};

// neon_auth."user" — "user" is a reserved word, so the quotes are mandatory.
// user_data.user_id is text while u.id is a uuid, hence the explicit cast.
const missing = `
  from neon_auth."user" u
  where not exists (
    select 1 from public.user_data ud
     where ud.user_id = u.id::text and ud.key = $1
  )`;

const [{ count: total }] = await sql.query(`select count(*)::int as count from neon_auth."user"`);
const [{ count: pending }] = await sql.query(`select count(*)::int as count ${missing}`, [
  PREMIUM_KEY,
]);
const existing = total - pending;

console.log(`Accounts:                 ${total}`);
console.log(`Already have a premium row: ${existing}  (left untouched)`);
console.log(`Would be grandfathered:     ${pending}`);

if (!apply) {
  console.log("\nDry run — nothing written. Re-run with --apply to write these rows.");
  process.exit(0);
}

const written = await sql.query(
  `insert into public.user_data (user_id, key, value)
   select u.id::text, $1, $2::jsonb
   ${missing}
   on conflict (user_id, key) do nothing
   returning user_id`,
  [PREMIUM_KEY, JSON.stringify(entitlement)]
);

console.log(`\nGrandfathered ${written.length} account(s).`);
console.log("They keep Premium free; every other account now needs to buy it.");
