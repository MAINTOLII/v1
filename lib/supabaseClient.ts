// /lib/supabaseClient.ts
import { createClient } from "@supabase/supabase-js";

let _client: ReturnType<typeof createClient> | null = null;

export function getSupabase() {
  // During Next.js prerender/SSR, window is undefined.
  // Never crash the build because env vars aren't available there.
  if (typeof window === "undefined") return null;

  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    // In the browser we DO want to see a clear error
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY (check Vercel env vars)."
    );
  }

  _client = createClient(url, anon);
  return _client;
}