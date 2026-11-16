import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPublicSupabaseEnv } from "@/lib/env";

export function createSupabaseAdminClient(): SupabaseClient | null {
  const { url, configured } = getPublicSupabaseEnv();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!configured || !serviceRoleKey) {
    return null;
  }
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
