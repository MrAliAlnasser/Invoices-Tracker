import { NextResponse } from "next/server";
import { buildServerAiAnalyzer } from "@/lib/invoices/repository";
import { requireApiUser } from "@/lib/supabase/server";

export async function POST() {
  const auth = await requireApiUser();
  if ("errorResponse" in auth) return auth.errorResponse;

  const analyzer = buildServerAiAnalyzer(auth.supabase);
  const status = await analyzer.probeQuota();
  return NextResponse.json(status);
}
