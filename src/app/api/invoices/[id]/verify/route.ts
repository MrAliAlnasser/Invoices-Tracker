import { NextResponse } from "next/server";
import { getUserInvoiceById } from "@/lib/invoices/repository";
import { reconcileInvoiceMath, VerifyInvoicePayloadSchema } from "@/lib/invoices/schema";
import { requireApiUser } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiUser();
  if ("errorResponse" in auth) return auth.errorResponse;

  const { supabase, user } = auth;
  const { id } = await context.params;

  const existing = await getUserInvoiceById(supabase, user.id, id);
  if (!existing) {
    return NextResponse.json({ error: "الفاتورة غير موجودة." }, { status: 404 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = VerifyInvoicePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "بيانات التحقق سطرًا بسطر غير صالحة." },
      { status: 400 }
    );
  }

  const payload = parsed.data;
  const math = reconcileInvoiceMath({
    subtotal: payload.subtotal,
    discount_amount: payload.discount_amount,
    vat_amount: payload.vat_amount,
    grand_total: payload.grand_total,
    items: payload.items,
  });

  const hasHeaderRejection = Object.values(payload.field_approvals).some(
    (status) => status === "rejected"
  );
  const hasItemRejection = payload.items.some((it) => it.review_status === "rejected");
  const verificationStatus =
    hasHeaderRejection || hasItemRejection ? "partial_rejected" : "verified";

  const nextOcrStatus =
    payload.mark_as_manual && existing.ocr_status !== "analyzed"
      ? "manual"
      : existing.ocr_status;
  const nextMode =
    nextOcrStatus === "manual" ? "manual_entry" : existing.processing_mode;

  const { error: updateErr } = await supabase
    .from("invoices")
    .update({
      vendor_name: payload.vendor_name,
      vendor_tax_number: payload.vendor_tax_number,
      invoice_number: payload.invoice_number,
      invoice_date: payload.invoice_date,
      currency: payload.currency,
      subtotal: payload.subtotal,
      discount_amount: payload.discount_amount,
      vat_amount: payload.vat_amount,
      grand_total: payload.grand_total,
      category: payload.category,
      notes: payload.notes,
      field_approvals: payload.field_approvals,
      math_consistent: math.consistent,
      math_difference: math.difference,
      verification_status: verificationStatus,
      ocr_status: nextOcrStatus,
      processing_mode: nextMode,
    })
    .eq("id", id)
    .eq("user_id", user.id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  await supabase
    .from("invoice_items")
    .delete()
    .eq("invoice_id", id)
    .eq("user_id", user.id);

  if (payload.items.length > 0) {
    const itemRows = payload.items.map((it, idx) => ({
      invoice_id: id,
      user_id: user.id,
      line_index: idx,
      item_name: it.item_name,
      quantity: it.quantity,
      unit_price: it.unit_price,
      tax_amount: it.tax_amount,
      line_total: it.line_total,
      review_status: it.review_status,
      review_note: it.review_note ?? null,
    }));
    const { error: itemsErr } = await supabase.from("invoice_items").insert(itemRows);
    if (itemsErr) {
      return NextResponse.json({ error: itemsErr.message }, { status: 500 });
    }
  }

  const hydrated = await getUserInvoiceById(supabase, user.id, id);
  return NextResponse.json({
    status: verificationStatus,
    invoice: hydrated,
    math,
  });
}
