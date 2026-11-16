"use client";

import { createBrowserClient } from "@supabase/ssr";
import { requirePublicSupabaseEnv } from "@/lib/env";

let cachedClient: ReturnType<typeof createBrowserClient> | null = null;

export function createSupabaseBrowserClient() {
  if (cachedClient) {
    return cachedClient;
  }
  const { url, anonKey } = requirePublicSupabaseEnv();
  cachedClient = createBrowserClient(url, anonKey);
  return cachedClient;
}
