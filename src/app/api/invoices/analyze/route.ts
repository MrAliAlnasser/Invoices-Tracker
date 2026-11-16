import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerEnv } from "@/lib/env";
import {
  AiQuotaExhaustedError,
  AiUnsupportedFileError,
} from "@/lib/gemini/client";
import {
  buildServerAiAnalyzer,
  getOrCreateUserSettings,
  getUserInvoiceById,
} from "@/lib/invoices/repository";
import { reconcileInvoiceMath } from "@/lib/invoices/schema";
import { requireApiUser } from "@/lib/supabase/server";

const AnalyzeRequestSchema = z.union([
  z.object({
    invoiceId: z.string().uuid(),
  }),
  z.object({
    filePath: z.string().min(3),
    fileName: z.string().min(1),
    mimeType: z.string().nullable().optional(),
    fileSize: z.number().int().nonnegative(),
  }),
]);

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if ("errorResponse" in auth) return auth.errorResponse;

  const { supabase, user } = auth;
  const env = getServerEnv();

  const body: unknown = await request.json().catch(() => null);
  const parsed = AnalyzeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "طلب تحليل الفاتورة غير مكتمل." },
      { status: 400 }
    );
  }

  const isRetry = "invoiceId" in parsed.data;
  const settings = await getOrCreateUserSettings(supabase, user.id);
  const analyzer = buildServerAiAnalyzer(supabase);

  let targetPath: string;
  let fileName: string;
  let mimeType: string | null;
  let fileSize: number;

  if ("invoiceId" in parsed.data) {
    const existing = await getUserInvoiceById(supabase, user.id, parsed.data.invoiceId);
    if (!existing) {
      return NextResponse.json({ error: "الفاتورة غير موجودة." }, { status: 404 });
    }
    targetPath = existing.file_path;
    fileName = existing.file_name;
    mimeType = existing.mime_type;
    fileSize = existing.file_size;
  } else {
    targetPath = parsed.data.filePath;
    if (!targetPath.startsWith(`${user.id}/`)) {
      return NextResponse.json({ error: "مسار ملف غير مصرح به." }, { status: 403 });
    }
    fileName = parsed.data.fileName;
    mimeType = parsed.data.mimeType ?? null;
    fileSize = parsed.data.fileSize;
  }

  const { data: blob, error: downloadErr } = await supabase.storage
    .from(env.storageBucket)
    .download(targetPath);

  if (downloadErr || !blob) {
    return NextResponse.json(
      { error: "تعذر قراءة ملف الفاتورة من التخزين السحابي." },
      { status: 404 }
    );
  }

  const arrayBuffer = await blob.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);

  try {
    const { model, extraction } = await analyzer.analyzeArabicInvoice({
      fileName,
      mimeType,
      bytes,
    });

    const math = reconcileInvoiceMath({
      subtotal: extraction.subtotal,
      discount_amount: extraction.discount_amount,
      vat_amount: extraction.vat_amount,
      grand_total: extraction.grand_total,
      items: extraction.items,
    });

    const verificationStatus = settings.require_line_by_line_review
      ? "pending_review"
      : "auto_saved";

    const invoicePayload = {
      user_id: user.id,
      file_path: targetPath,
      file_name: fileName,
      mime_type: mimeType,
      file_size: fileSize,
      vendor_name: extraction.vendor_name,
      vendor_tax_number: extraction.vendor_tax_number,
      invoice_number: extraction.invoice_number,
      invoice_date: extraction.invoice_date,
      currency: extraction.currency || settings.default_currency || "SAR",
      subtotal: extraction.subtotal,
      discount_amount: extraction.discount_amount,
      vat_amount: extraction.vat_amount,
      grand_total: extraction.grand_total,
      category: extraction.category,
      notes: extraction.notes,
      raw_extracted_text: extraction.raw_extracted_text,
      ocr_status: "analyzed" as const,
      verification_status: verificationStatus,
      processing_mode: `gemini_ai_studio:${model}`,
      ai_model: model,
      field_approvals: {},
      math_consistent: math.consistent,
      math_difference: math.difference,
    };

    let savedInvoiceId: string;
    if ("invoiceId" in parsed.data) {
      savedInvoiceId = parsed.data.invoiceId;
      const { error: updErr } = await supabase
        .from("invoices")
        .update(invoicePayload)
        .eq("id", savedInvoiceId)
        .eq("user_id", user.id);
      if (updErr) {
        return NextResponse.json({ error: updErr.message }, { status: 500 });
      }
      await supabase
        .from("invoice_items")
        .delete()
        .eq("invoice_id", savedInvoiceId)
        .eq("user_id", user.id);
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from("invoices")
        .insert(invoicePayload)
        .select("id")
        .single();
      if (insErr || !inserted) {
        return NextResponse.json(
          { error: insErr?.message ?? "تعذر حفظ بيانات الفاتورة." },
          { status: 500 }
        );
      }
      savedInvoiceId = String(inserted.id);
    }

    if (extraction.items.length > 0) {
      const itemRows = extraction.items.map((item, idx) => ({
        invoice_id: savedInvoiceId,
        user_id: user.id,
        line_index: idx,
        item_name: item.item_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        tax_amount: item.tax_amount,
        line_total: item.line_total,
        review_status: "pending" as const,
      }));
      await supabase.from("invoice_items").insert(itemRows);
    }

    const [hydrated, aiStatus] = await Promise.all([
      getUserInvoiceById(supabase, user.id, savedInvoiceId),
      analyzer.getStatus(),
    ]);

    return NextResponse.json({
      invoice: hydrated,
      needsReview: settings.require_line_by_line_review,
      quotaExhausted: false,
      ai_status: aiStatus,
    });
  } catch (err) {
    if (err instanceof AiUnsupportedFileError) {
      if (isRetry) {
        return NextResponse.json(
          { error: err.message, ai_status: await analyzer.getStatus() },
          { status: 422 }
        );
      }
      // Fresh upload of unreadable/rejected file: persist metadata cleanly so user isn't blocked.
      const { data: inserted } = await supabase
        .from("invoices")
        .insert({
          user_id: user.id,
          file_path: targetPath,
          file_name: fileName,
          mime_type: mimeType,
          file_size: fileSize,
          currency: settings.default_currency || "SAR",
          ocr_status: "unsupported",
          verification_status: settings.require_line_by_line_review ? "pending_review" : "auto_saved",
          processing_mode: "unsupported",
          notes: err.message,
        })
        .select("id")
        .single();

      const hydrated = inserted
        ? await getUserInvoiceById(supabase, user.id, String(inserted.id))
        : null;
      return NextResponse.json({
        invoice: hydrated,
        needsReview: settings.require_line_by_line_review,
        quotaExhausted: false,
        ai_status: await analyzer.getStatus(),
      });
    }

    if (err instanceof AiQuotaExhaustedError) {
      if (isRetry) {
        return NextResponse.json(
          { error: err.message, ai_status: err.status },
          { status: 429 }
        );
      }

      // Fresh upload during API outage: preserve invoice record as pending_ai immediately.
      const { data: inserted, error: insErr } = await supabase
        .from("invoices")
        .insert({
          user_id: user.id,
          file_path: targetPath,
          file_name: fileName,
          mime_type: mimeType,
          file_size: fileSize,
          currency: settings.default_currency || "SAR",
          ocr_status: "pending_ai",
          verification_status: settings.require_line_by_line_review ? "pending_review" : "auto_saved",
          processing_mode: "pending_ai",
          notes: "تم رفع الفاتورة وحفظها بانتظار تجدد رصيد AI أو التعديل اليدوي.",
        })
        .select("id")
        .single();

      if (insErr || !inserted) {
        return NextResponse.json(
          { error: insErr?.message ?? "تعذر حفظ الفاتورة." },
          { status: 500 }
        );
      }

      const hydrated = await getUserInvoiceById(supabase, user.id, String(inserted.id));
      return NextResponse.json({
        invoice: hydrated,
        needsReview: settings.require_line_by_line_review,
        quotaExhausted: true,
        ai_status: err.status,
      });
    }

    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "فشل تحليل الفاتورة.",
        ai_status: await analyzer.getStatus(),
      },
      { status: 500 }
    );
  }
}
