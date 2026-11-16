import { NextResponse } from "next/server";
import { getOrCreateUserSettings } from "@/lib/invoices/repository";
import { SettingsUpdateSchema } from "@/lib/invoices/schema";
import { requireApiUser } from "@/lib/supabase/server";

export async function GET() {
  const auth = await requireApiUser();
  if ("errorResponse" in auth) return auth.errorResponse;

  const { supabase, user } = auth;
  const settings = await getOrCreateUserSettings(supabase, user.id);
  return NextResponse.json({ settings });
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

  const current = await getOrCreateUserSettings(supabase, user.id);
  const nextSettings = {
    user_id: user.id,
    require_line_by_line_review:
      parsed.data.require_line_by_line_review ?? current.require_line_by_line_review,
    default_currency: parsed.data.default_currency ?? current.default_currency,
    auto_delete_days:
      parsed.data.auto_delete_days !== undefined
        ? parsed.data.auto_delete_days
        : current.auto_delete_days,
  };

  const { data, error } = await supabase
    .from("user_settings")
    .upsert(nextSettings, { onConflict: "user_id" })
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "تعذر حفظ الإعدادات." },
      { status: 500 }
    );
  }

  return NextResponse.json({ settings: data });
}
