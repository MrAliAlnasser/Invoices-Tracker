import { NextRequest, NextResponse } from "next/server";
import { invoicesToCsvWithBom } from "@/lib/invoices/arabic-utils";
import { listUserInvoices } from "@/lib/invoices/repository";
import { requireApiUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireApiUser();
  if ("errorResponse" in auth) return auth.errorResponse;

  const { supabase, user } = auth;
  const q = request.nextUrl.searchParams.get("q") ?? undefined;
  const status = request.nextUrl.searchParams.get("status") ?? undefined;
  const category = request.nextUrl.searchParams.get("category") ?? undefined;

  const invoices = await listUserInvoices(supabase, user.id, { q, status, category });
  const csv = invoicesToCsvWithBom(invoices);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="arabic-purchase-invoices.csv"',
      "Cache-Control": "no-store",
    },
  });
}
