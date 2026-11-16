import { NextResponse } from "next/server";
import {
  buildServerAiAnalyzer,
  getOrCreateUserSettings,
  getRawUserSettingsRow,
  sanitizeUserSettingsRow,
} from "@/lib/invoices/repository";
import { SettingsUpdateSchema } from "@/lib/invoices/schema";
import { requireApiUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiUser();
  if ("errorResponse" in auth) return auth.errorResponse;

  const { supabase, user } = auth;
  const analyzer = await buildServerAiAnalyzer(supabase, user.id);
  const [settings, aiStatus] = await Promise.all([
    getOrCreateUserSettings(supabase, user.id),
    analyzer.getStatus(),
  ]);
  return NextResponse.json({ settings, ai_status: aiStatus });
}

export async function PATCH(request: Request) {
  const auth = await requireApiUser();
  if ("errorResponse" in auth) return auth.errorResponse;

  const { supabase, user } = auth;
  const body: unknown = await request.json().catch(() => null);
  const parsed = SettingsUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "قيم الإعدادات المرسلة غير صالحة." },
      { status: 400 }
    );
  }

  const rawCurrent = await getRawUserSettingsRow(supabase, user.id);
  const nextSettings: Record<string, unknown> = {
    user_id: user.id,
    require_line_by_line_review:
      parsed.data.require_line_by_line_review ??
      Boolean(rawCurrent.require_line_by_line_review ?? true),
    default_currency:
      parsed.data.default_currency ??
      String(rawCurrent.default_currency ?? "SAR"),
    auto_delete_days:
      parsed.data.auto_delete_days !== undefined
        ? parsed.data.auto_delete_days
        : (rawCurrent.auto_delete_days ?? null),
  };

  if (parsed.data.custom_gemini_api_key !== undefined) {
    const cleanedKey = (parsed.data.custom_gemini_api_key ?? "").trim();
    nextSettings.custom_gemini_api_key = cleanedKey || null;
  }

  const { data, error } = await supabase
    .from("user_settings")
    .upsert(nextSettings, { onConflict: "user_id" })
    .select("*")
    .single();

  if (error || !data) {
    const msg = error?.message ?? "تعذر حفظ الإعدادات.";
    if (msg.toLowerCase().includes("custom_gemini_api_key")) {
      return NextResponse.json(
        {
          error:
            "عمود custom_gemini_api_key غير مضاف بعد في قاعدة Supabase. شغّل أمر التحديث التالي في SQL Editor أو أضف GEMINI_API_KEY في Vercel: ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS custom_gemini_api_key TEXT NULL;",
          migrationRequired: true,
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const analyzer = await buildServerAiAnalyzer(supabase, user.id);
  const aiStatus =
    parsed.data.custom_gemini_api_key !== undefined
      ? await analyzer.probeQuota()
      : await analyzer.getStatus();

  return NextResponse.json({
    settings: sanitizeUserSettingsRow(data as Record<string, unknown>),
    ai_status: aiStatus,
  });
}
