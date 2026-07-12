// One-time Neon setup for cross-device sync.
// Creates the user_data table with row-level security so each signed-in
// user (via Neon Auth) can only read/write their own rows through the Data API.
//
// Run with: node scripts/setup-neon.mjs
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

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

// Sanity checks: the Data API roles and Neon Auth helper must exist.
const roles = await sql.query(
  "select rolname from pg_roles where rolname in ('authenticated', 'anonymous')"
);
console.log("Data API roles found:", roles.map((r) => r.rolname).join(", ") || "(none)");

const authFn = await sql.query(
  "select 1 from pg_proc p join pg_namespace n on p.pronamespace = n.oid where n.nspname = 'auth' and p.proname = 'user_id'"
);
console.log("auth.user_id() available:", authFn.length > 0);

if (roles.length === 0 || authFn.length === 0) {
  console.error(
    "Missing Data API roles or auth.user_id(). Enable the Data API and Neon Auth in the Neon console first."
  );
  process.exit(1);
}

await sql.query(`
  create table if not exists public.user_data (
    user_id text not null default (auth.user_id()),
    key text not null,
    value jsonb not null,
    updated_at timestamptz not null default now(),
    primary key (user_id, key)
  )
`);

await sql.query(`
  create or replace function public.user_data_set_updated_at() returns trigger as $$
  begin
    new.updated_at = now();
    return new;
  end
  $$ language plpgsql
`);

await sql.query(`drop trigger if exists user_data_updated_at on public.user_data`);
await sql.query(`
  create trigger user_data_updated_at
  before update on public.user_data
  for each row execute function public.user_data_set_updated_at()
`);

await sql.query(`alter table public.user_data enable row level security`);

await sql.query(`drop policy if exists user_data_own_rows on public.user_data`);
await sql.query(`
  create policy user_data_own_rows on public.user_data
  to authenticated
  using (user_id = (select auth.user_id()))
  with check (user_id = (select auth.user_id()))
`);

await sql.query(`grant usage on schema public to authenticated`);
await sql.query(`grant select, insert, update, delete on public.user_data to authenticated`);

console.log("Done: user_data table, trigger, RLS policy, and grants are in place.");
