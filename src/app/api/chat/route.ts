import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AiQuotaExhaustedError,
  AiUnsupportedFileError,
} from "@/lib/gemini/client";
import { buildInvoicesChatContext } from "@/lib/invoices/chat-context";
import { buildServerAiAnalyzer, listUserInvoices } from "@/lib/invoices/repository";
import { requireApiUser } from "@/lib/supabase/server";

const MAX_VOICE_CLIP_BYTES = 4 * 1024 * 1024; // Keeps multipart payload within Vercel 4.5 MB limit

const HistoryItemSchema = z.object({
  role: z.enum(["user", "model"]),
  text: z.string().trim().min(1).max(3000),
});

const JsonChatSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  focusInvoiceId: z.string().uuid().nullable().optional(),
  history: z.array(HistoryItemSchema).max(20).optional().default([]),
});

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("errorResponse" in auth) return auth.errorResponse;

  const { supabase, user } = auth;
  const contentType = request.headers.get("content-type") ?? "";

  let message: string | null = null;
  let focusInvoiceId: string | null = null;
  let history: Array<{ role: "user" | "model"; text: string }> = [];
  let audio: { bytes: Buffer; mimeType: string } | null = null;

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json({ error: "تعذر قراءة بيانات الرسالة الصوتية." }, { status: 400 });
    }

    const rawMsg = formData.get("message");
    if (typeof rawMsg === "string" && rawMsg.trim()) {
      message = rawMsg.trim().slice(0, 4000);
    }

    const rawFocus = formData.get("focusInvoiceId");
    if (typeof rawFocus === "string" && rawFocus.trim()) {
      const uuidCheck = z.string().uuid().safeParse(rawFocus.trim());
      if (uuidCheck.success) focusInvoiceId = uuidCheck.data;
    }

    const rawHistory = formData.get("history");
    if (typeof rawHistory === "string" && rawHistory.trim()) {
      try {
        const parsedHist = z.array(HistoryItemSchema).max(20).safeParse(JSON.parse(rawHistory));
        if (parsedHist.success) history = parsedHist.data;
      } catch {
        // Ignore malformed optional history JSON cleanly.
      }
    }

    const audioFile = formData.get("audio");
    if (audioFile instanceof File && audioFile.size > 0) {
      if (audioFile.size > MAX_VOICE_CLIP_BYTES) {
        return NextResponse.json(
          { error: "التسجيل الصوتي طويل جدًا (الحد الأقصى 4 MB للمقطع الواحد)." },
          { status: 413 }
        );
      }
      const arr = await audioFile.arrayBuffer();
      audio = {
        bytes: Buffer.from(arr),
        mimeType: audioFile.type || "audio/webm",
      };
    }
  } else {
    const body: unknown = await request.json().catch(() => null);
    const parsed = JsonChatSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "يرجى إرسال نص سؤال صالح أو تسجيل صوتي." },
        { status: 400 }
      );
    }
    message = parsed.data.message;
    focusInvoiceId = parsed.data.focusInvoiceId ?? null;
    history = parsed.data.history;
  }

  if (!message && !audio) {
    return NextResponse.json(
      { error: "يرجى كتابة سؤال أو تسجيل رسالة صوتية." },
      { status: 400 }
    );
  }

  const analyzer = await buildServerAiAnalyzer(supabase, user.id);

  try {
    const invoices = await listUserInvoices(supabase, user.id);
    const { contextText, scopedInvoices } = buildInvoicesChatContext(invoices, focusInvoiceId);

    if (scopedInvoices.length === 0) {
      return NextResponse.json({
        transcript: audio ? message ?? "(سؤال صوتي)" : null,
        answer_text:
          "لا توجد فواتير محفوظة في حسابك حاليًا للإجابة عنها. ارفع أول فاتورة وسأتمكن فورًا من قراءتها والإجابة على أسئلتك نصيًا وصوتيًا!",
        spoken_summary:
          "لا توجد فواتير محفوظة في حسابك حاليًا. ارفع أول فاتورة وسأساعدك في تحليلها والإجابة عن تفاصيلها.",
        referencedInvoices: [],
        model: null,
        ai_status: await analyzer.getStatus(),
      });
    }

    const { model, turn } = await analyzer.chatWithInvoices({
      message,
      audio,
      history,
      contextText,
    });

    const byId = new Map(invoices.map((inv) => [inv.id, inv]));
    const referencedInvoices = turn.referenced_invoice_ids
      .map((id) => byId.get(id))
      .filter((inv): inv is NonNullable<typeof inv> => Boolean(inv))
      .slice(0, 6)
      .map((inv) => ({
        id: inv.id,
        vendor_name: inv.vendor_name,
        file_name: inv.file_name,
        grand_total: inv.grand_total,
        currency: inv.currency,
      }));

    return NextResponse.json({
      transcript: turn.transcript,
      answer_text: turn.answer_text,
      spoken_summary: turn.spoken_summary,
      referencedInvoices,
      model,
      ai_status: await analyzer.getStatus(),
    });
  } catch (err) {
    if (err instanceof AiQuotaExhaustedError) {
      return NextResponse.json(
        { error: err.message, ai_status: err.status },
        { status: 429 }
      );
    }
    if (err instanceof AiUnsupportedFileError) {
      return NextResponse.json(
        { error: err.message, ai_status: await analyzer.getStatus() },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "حدث خطأ أثناء محادثة المساعد.",
        ai_status: await analyzer.getStatus(),
      },
      { status: 500 }
    );
  }
}
