import { NextResponse } from "next/server";
import { getPublicSupabaseEnv } from "@/lib/env";

export async function GET() {
  const { configured } = getPublicSupabaseEnv();
  return NextResponse.json({
    status: "ok",
    service: "arabic-invoice-ocr-v2",
    supabase_configured: configured,
    gemini_configured: Boolean((process.env.GEMINI_API_KEY ?? "").trim()),
  });
}
