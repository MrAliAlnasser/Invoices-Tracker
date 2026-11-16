import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AiQuotaExhaustedError,
  AiUnsupportedFileError,
} from "@/lib/gemini/client";
import { buildServerAiAnalyzer } from "@/lib/invoices/repository";
import { requireApiUser } from "@/lib/supabase/server";

const SpeakRequestSchema = z.object({
  text: z.string().trim().min(1).max(1500),
  voiceName: z.string().trim().min(1).max(40).optional(),
});

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("errorResponse" in auth) return auth.errorResponse;

  const body: unknown = await request.json().catch(() => null);
  const parsed = SpeakRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "النص المطلوب تحويله لصوت غير صالح.", fallbackToBrowserTts: true },
      { status: 400 }
    );
  }

  const analyzer = buildServerAiAnalyzer(auth.supabase);

  try {
    const { audioBuffer, mimeType, model } = await analyzer.synthesizeArabicSpeech({
      text: parsed.data.text,
      voiceName: parsed.data.voiceName,
    });

    return new NextResponse(new Uint8Array(audioBuffer), {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "X-TTS-Model": model,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const status =
      err instanceof AiQuotaExhaustedError
        ? 429
        : err instanceof AiUnsupportedFileError
          ? 400
          : 503;
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "تعذر توليد الصوت من Gemini.",
        fallbackToBrowserTts: true,
      },
      { status }
    );
  }
}
