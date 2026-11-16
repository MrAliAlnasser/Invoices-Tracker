import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getPublicSupabaseEnv, requirePublicSupabaseEnv } from "@/lib/env";

export async function createSupabaseServerClient() {
  const { url, anonKey } = requirePublicSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component read-only render pass; proxy.ts handles cookie persistence.
        }
      },
    },
  });
}

export async function getOptionalServerUser(): Promise<{
  configured: boolean;
  user: User | null;
}> {
  if (!getPublicSupabaseEnv().configured) {
    return { configured: false, user: null };
  }
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { configured: true, user: user ?? null };
}

export async function requireApiUser() {
  if (!getPublicSupabaseEnv().configured) {
    return {
      errorResponse: NextResponse.json(
        { error: "إعدادات Supabase غير مكتملة على الخادم." },
        { status: 503 }
      ),
    } as const;
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      errorResponse: NextResponse.json(
        { error: "يرجى تسجيل الدخول للمتابعة." },
        { status: 401 }
      ),
    } as const;
  }

  return { supabase, user } as const;
}
