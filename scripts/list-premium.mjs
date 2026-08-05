// Who has Focus Flow Premium?
//
// There is no file holding this — the entitlement is one row per user in
// public.user_data with key 'ff.premium.v1'. This reads it back and joins it to
// the Neon Auth account so you get emails rather than opaque user ids.
//
//   node scripts/list-premium.mjs          # accounts with a premium record
//   node scripts/list-premium.mjs --all    # every account, premium or not
//
// Uses DATABASE_URL from .env.local, same as setup-neon.mjs / grant-premium.mjs.
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const PREMIUM_KEY = "ff.premium.v1";
const all = process.argv.includes("--all");

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
const users = `neon_auth."user"`;

// A row can be a grant (active:true) or a revocation tombstone (active:false),
// so report the flag rather than assuming any row means premium.
const rows = all
  ? await sql.query(
      `select u.email,
              ud.value->>'active' as active,
              ud.value->>'source'  as source,
              ud.value->>'verified' as verified,
              ud.updated_at
       from ${users} u
       left join public.user_data ud on ud.user_id = u.id and ud.key = $1
       order by (ud.value->>'active') = 'true' desc nulls last, u.email`,
      [PREMIUM_KEY]
    )
  : await sql.query(
      `select u.email,
              ud.value->>'active' as active,
              ud.value->>'source'  as source,
              ud.value->>'verified' as verified,
              ud.updated_at
       from public.user_data ud
       left join ${users} u on u.id = ud.user_id
       where ud.key = $1
       order by ud.updated_at desc`,
      [PREMIUM_KEY]
    );

if (rows.length === 0) {
  console.log("No premium records found.");
  process.exit(0);
}

const status = (r) => {
  if (r.active === "true") return `PREMIUM (${r.source}${r.verified === "true" ? ", verified" : ", unverified"})`;
  if (r.active === "false") return "revoked";
  return "free";
};

for (const r of rows) {
  const when = r.updated_at ? new Date(r.updated_at).toISOString().slice(0, 16).replace("T", " ") : "";
  console.log(`${(r.email ?? "(unknown user)").padEnd(36)} ${status(r).padEnd(34)} ${when}`);
}

const active = rows.filter((r) => r.active === "true").length;
console.log(`\n${active} active premium of ${rows.length} row(s) listed.`);
