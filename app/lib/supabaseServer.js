import { createClient } from "@supabase/supabase-js";

let supabaseClient = null;

export function getSupabaseServerClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  if (!supabaseClient) {
    supabaseClient = createClient(url, key, {
      auth: {
        persistSession: false,
      },
    });
  }

  return supabaseClient;
}
