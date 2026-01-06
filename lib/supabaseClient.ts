// lib/supabaseClient.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let _client: ReturnType<typeof createClient<any>> | null = null;

export function getSupabase() {
  if (!_client) _client = createClient<any>(supabaseUrl, supabaseAnonKey);
  return _client;
}

// ✅ so `import { supabase } from "@/lib/supabaseClient"` works
export const supabase = getSupabase();