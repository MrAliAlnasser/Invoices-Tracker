import { NextResponse } from "next/server";
import { buildServerAiAnalyzer } from "@/lib/invoices/repository";
import { requireApiUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiUser();
  if ("errorResponse" in auth) return auth.errorResponse;

  const analyzer = await buildServerAiAnalyzer(auth.supabase, auth.user.id);
  const status = await analyzer.getStatus();
  return NextResponse.json(status);
}
