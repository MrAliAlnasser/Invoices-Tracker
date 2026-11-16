import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";
import {
  GeminiArabicInvoiceAnalyzer,
  isGeminiSupportedInvoiceFile,
  SupabaseCooldownStore,
} from "@/lib/gemini/client";
import { parseFlexibleNumber } from "@/lib/invoices/arabic-utils";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type {
  FieldApprovalsMap,
  InvoiceItemRecord,
  InvoiceRecord,
  UserSettings,
} from "@/types/invoice";

export function buildServerAiAnalyzer(readClient: SupabaseClient): GeminiArabicInvoiceAnalyzer {
  const env = getServerEnv();
  const adminClient = createSupabaseAdminClient();
  return new GeminiArabicInvoiceAnalyzer({
    apiKey: env.geminiApiKey,
    models: env.geminiModels,
    ttsModels: env.geminiTtsModels,
    ttsVoice: env.geminiTtsVoice,
    cooldownSeconds: env.cooldownSeconds,
    store: new SupabaseCooldownStore(readClient, adminClient),
  });
}

export async function getOrCreateUserSettings(
  supabase: SupabaseClient,
  userId: string
): Promise<UserSettings> {
  const { data } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (data) {
    return data as UserSettings;
  }

  const defaults: UserSettings = {
    user_id: userId,
    require_line_by_line_review: true,
    default_currency: "SAR",
    auto_delete_days: null,
    updated_at: new Date().toISOString(),
  };

  const { data: inserted } = await supabase
    .from("user_settings")
    .upsert(defaults, { onConflict: "user_id" })
    .select("*")
    .single();

  return (inserted as UserSettings | null) ?? defaults;
}

function mapRawInvoiceRow(
  raw: Record<string, unknown>,
  rawItems: Record<string, unknown>[],
  maxFileSizeBytes: number
): InvoiceRecord {
  const items: InvoiceItemRecord[] = rawItems
    .map((it) => ({
      id: String(it.id),
      invoice_id: String(it.invoice_id),
      user_id: String(it.user_id),
      line_index: Number(it.line_index ?? 0),
      item_name: String(it.item_name ?? ""),
      quantity: parseFlexibleNumber(it.quantity, 1, 3),
      unit_price: parseFlexibleNumber(it.unit_price, 0, 2),
      tax_amount: parseFlexibleNumber(it.tax_amount, 0, 2),
      line_total: parseFlexibleNumber(it.line_total, 0, 2),
      review_status: (it.review_status as InvoiceItemRecord["review_status"]) ?? "pending",
      review_note: typeof it.review_note === "string" ? it.review_note : null,
      created_at: String(it.created_at ?? ""),
    }))
    .sort((a, b) => a.line_index - b.line_index);

  const fileName = String(raw.file_name ?? "");
  const mimeType = typeof raw.mime_type === "string" ? raw.mime_type : null;
  const fileSize = Number(raw.file_size ?? 0);

  return {
    id: String(raw.id),
    user_id: String(raw.user_id),
    file_path: String(raw.file_path ?? ""),
    file_name: fileName,
    mime_type: mimeType,
    file_size: fileSize,
    vendor_name: typeof raw.vendor_name === "string" ? raw.vendor_name : null,
    vendor_tax_number: typeof raw.vendor_tax_number === "string" ? raw.vendor_tax_number : null,
    invoice_number: typeof raw.invoice_number === "string" ? raw.invoice_number : null,
    invoice_date: typeof raw.invoice_date === "string" ? raw.invoice_date : null,
    currency: String(raw.currency ?? "SAR"),
    subtotal: parseFlexibleNumber(raw.subtotal, 0, 2),
    vat_amount: parseFlexibleNumber(raw.vat_amount, 0, 2),
    discount_amount: parseFlexibleNumber(raw.discount_amount, 0, 2),
    grand_total: parseFlexibleNumber(raw.grand_total, 0, 2),
    category: typeof raw.category === "string" ? raw.category : null,
    notes: typeof raw.notes === "string" ? raw.notes : null,
    raw_extracted_text:
      typeof raw.raw_extracted_text === "string" ? raw.raw_extracted_text : null,
    ocr_status: (raw.ocr_status as InvoiceRecord["ocr_status"]) ?? "pending_ai",
    verification_status:
      (raw.verification_status as InvoiceRecord["verification_status"]) ?? "pending_review",
    processing_mode: String(raw.processing_mode ?? "pending_ai"),
    ai_model: typeof raw.ai_model === "string" ? raw.ai_model : null,
    field_approvals: (raw.field_approvals as FieldApprovalsMap) ?? {},
    math_consistent: Boolean(raw.math_consistent ?? true),
    math_difference: parseFlexibleNumber(raw.math_difference, 0, 2),
    created_at: String(raw.created_at ?? ""),
    updated_at: String(raw.updated_at ?? ""),
    items,
    ai_analyzable: isGeminiSupportedInvoiceFile(fileName, mimeType, fileSize, maxFileSizeBytes),
  };
}

export async function listUserInvoices(
  supabase: SupabaseClient,
  userId: string,
  filters?: { q?: string; status?: string; ocr_status?: string }
): Promise<InvoiceRecord[]> {
  const { maxFileSizeBytes } = getServerEnv();
  let query = supabase
    .from("invoices")
    .select("*, invoice_items(*)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (filters?.status) {
    query = query.eq("verification_status", filters.status);
  }
  if (filters?.ocr_status) {
    query = query.eq("ocr_status", filters.ocr_status);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`فشل جلب الفواتير: ${error.message}`);
  }

  const rows = ((data ?? []) as Array<Record<string, unknown>>).map((row) =>
    mapRawInvoiceRow(
      row,
      Array.isArray(row.invoice_items)
        ? (row.invoice_items as Record<string, unknown>[])
        : [],
      maxFileSizeBytes
    )
  );

  const search = filters?.q?.trim().toLowerCase();
  if (!search) {
    return rows;
  }

  return rows.filter((inv) => {
    const haystack = [
      inv.vendor_name,
      inv.vendor_tax_number,
      inv.invoice_number,
      inv.file_name,
      inv.category,
      ...inv.items.map((it) => it.item_name),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(search);
  });
}

export async function getUserInvoiceById(
  supabase: SupabaseClient,
  userId: string,
  invoiceId: string
): Promise<InvoiceRecord | null> {
  const { maxFileSizeBytes } = getServerEnv();
  const { data, error } = await supabase
    .from("invoices")
    .select("*, invoice_items(*)")
    .eq("id", invoiceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const row = data as Record<string, unknown>;
  return mapRawInvoiceRow(
    row,
    Array.isArray(row.invoice_items)
      ? (row.invoice_items as Record<string, unknown>[])
      : [],
    maxFileSizeBytes
  );
}
