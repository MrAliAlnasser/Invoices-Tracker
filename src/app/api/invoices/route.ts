import { NextRequest, NextResponse } from "next/server";
import { computeDashboardKpis } from "@/lib/invoices/kpis";
import {
  buildServerAiAnalyzer,
  getOrCreateUserSettings,
  listUserInvoices,
} from "@/lib/invoices/repository";
import { requireApiUser } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const auth = await requireApiUser();
  if ("errorResponse" in auth) return auth.errorResponse;

  const { supabase, user } = auth;
  const searchParams = request.nextUrl.searchParams;
  const q = searchParams.get("q") ?? undefined;
  const status = searchParams.get("status") ?? undefined;
  const ocrStatus = searchParams.get("ocr_status") ?? undefined;

  try {
    const analyzer = buildServerAiAnalyzer(supabase);
    const [invoices, settings, aiStatus] = await Promise.all([
      listUserInvoices(supabase, user.id, { q, status, ocr_status: ocrStatus }),
      getOrCreateUserSettings(supabase, user.id),
      analyzer.getStatus(),
    ]);

    return NextResponse.json({
      invoices,
      kpis: computeDashboardKpis(invoices),
      settings,
      ai_status: aiStatus,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "فشل جلب الفواتير." },
      { status: 500 }
    );
  }
}
