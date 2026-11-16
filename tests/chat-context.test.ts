import { describe, expect, it } from "vitest";
import { buildInvoiceArchiveStats, buildInvoicesChatContext } from "@/lib/invoices/chat-context";
import type { InvoiceRecord } from "@/types/invoice";

function makeInvoice(overrides: Partial<InvoiceRecord>): InvoiceRecord {
  return {
    id: "inv-default",
    user_id: "usr-1",
    file_path: "usr-1/inv-default/fatora.jpg",
    file_name: "fatora.jpg",
    mime_type: "image/jpeg",
    file_size: 1024,
    vendor_name: "مكتبة جرير",
    vendor_tax_number: "300000000000003",
    invoice_number: "1001",
    invoice_date: "2026-11-15",
    currency: "SAR",
    subtotal: 100,
    vat_amount: 15,
    discount_amount: 0,
    grand_total: 115,
    category: "مكتبية",
    notes: null,
    raw_extracted_text: null,
    ocr_status: "analyzed",
    verification_status: "verified",
    processing_mode: "gemini_ai_studio:gemini-3.8-flash",
    ai_model: "gemini-3.8-flash",
    field_approvals: {},
    math_consistent: true,
    math_difference: 0,
    created_at: "2026-11-15T10:00:00Z",
    updated_at: "2026-11-15T10:00:00Z",
    items: [
      {
        id: "item-1",
        invoice_id: "inv-default",
        user_id: "usr-1",
        line_index: 0,
        item_name: "حبر طابعة",
        quantity: 1,
        unit_price: 100,
        tax_amount: 15,
        line_total: 100,
        review_status: "approved",
        review_note: null,
        created_at: "2026-11-15T10:00:00Z",
      },
    ],
    ...overrides,
  };
}

describe("Invoice chat context builder", () => {
  it("computes exact totals, VAT, vendor ranking, and math discrepancies", () => {
    const invoices: InvoiceRecord[] = [
      makeInvoice({ id: "a", vendor_name: "مكتبة جرير", vat_amount: 15, grand_total: 115 }),
      makeInvoice({
        id: "b",
        vendor_name: "أسواق التميمي",
        vat_amount: 30,
        grand_total: 230,
        verification_status: "pending_review",
        math_consistent: false,
        math_difference: 5,
      }),
      makeInvoice({
        id: "c",
        vendor_name: "مكتبة جرير",
        vat_amount: 45,
        grand_total: 345,
        ocr_status: "pending_ai",
        verification_status: "pending_review",
      }),
    ];

    const stats = buildInvoiceArchiveStats(invoices);
    expect(stats.totalInvoices).toBe(3);
    expect(stats.verifiedCount).toBe(1);
    expect(stats.pendingReviewCount).toBe(2);
    expect(stats.pendingAiCount).toBe(1);
    expect(stats.mathIssueCount).toBe(1);
    expect(stats.totalSpendByCurrency.SAR).toBe(690);
    expect(stats.totalVatByCurrency.SAR).toBe(90);
    expect(stats.topVendors[0]).toEqual({
      vendor: "مكتبة جرير",
      count: 2,
      totalSpend: 460,
      totalVat: 60,
    });
  });

  it("scopes context cleanly to a focused invoice when requested", () => {
    const invoices = [
      makeInvoice({ id: "11111111-1111-1111-1111-111111111111", vendor_name: "المتجر الأول", grand_total: 50 }),
      makeInvoice({ id: "22222222-2222-2222-2222-222222222222", vendor_name: "المتجر الثاني", grand_total: 400 }),
    ];

    const scoped = buildInvoicesChatContext(invoices, "22222222-2222-2222-2222-222222222222");
    expect(scoped.scopedInvoices).toHaveLength(1);
    expect(scoped.contextText).toContain("المتجر الثاني");
    expect(scoped.contextText).not.toContain("المتجر الأول");
  });
});
