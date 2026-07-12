import { createClient } from "@neondatabase/neon-js";

// Browser-only singleton. The client talks directly to Neon Auth (sessions)
// and the Neon Data API (Postgres over REST, guarded by RLS), so it works
// identically on the web and inside the Capacitor app — no app server needed.
let client: ReturnType<typeof createClient> | null = null;

export function getNeonClient() {
  if (typeof window === "undefined") return null;
  if (!client) {
    client = createClient({
      auth: { url: import.meta.env.VITE_NEON_AUTH_URL as string },
      dataApi: { url: import.meta.env.VITE_NEON_DATA_API_URL as string },
    });
  }
  return client;
}
