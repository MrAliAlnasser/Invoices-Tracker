import { describe, expect, it } from "vitest";
import {
  ArabicInvoiceExtractionSchema,
  reconcileInvoiceMath,
} from "@/lib/invoices/schema";

describe("Arabic invoice schema and math reconciliation", () => {
  it("parses Arabic numeral strings cleanly via Zod schema", () => {
    const parsed = ArabicInvoiceExtractionSchema.parse({
      vendor_name: "أسواق التوفير",
      vendor_tax_number: "٣٠٠١٢٣٤٥٦٧٠٠٠٠٣",
      invoice_number: "١٠٤٥",
      invoice_date: "١٦/١١/٢٠٢٦",
      currency: "SAR",
      subtotal: "٢٠٠٫٠٠",
      discount_amount: "٠",
      vat_amount: "٣٠٫٠٠",
      grand_total: "٢٣٠٫٠٠",
      items: [
        {
          item_name: "ورق طباعة A4",
          quantity: "٤",
          unit_price: "٥٠",
          tax_amount: "٠",
          line_total: "٢٠٠",
        },
      ],
    });

    expect(parsed.vendor_tax_number).toBe("300123456700003");
    expect(parsed.invoice_number).toBe("1045");
    expect(parsed.invoice_date).toBe("2026-11-16");
    expect(parsed.grand_total).toBe(230);
    expect(parsed.items[0].quantity).toBe(4);
    expect(parsed.items[0].line_total).toBe(200);
  });

  it("validates exact math match across items, subtotal, discount, VAT, and grand total", () => {
    const result = reconcileInvoiceMath({
      subtotal: 200,
      discount_amount: 20,
      vat_amount: 27,
      grand_total: 207,
      items: [
        { quantity: 2, unit_price: 50, line_total: 100, review_status: "approved" },
        { quantity: 1, unit_price: 100, line_total: 100, review_status: "approved" },
      ],
    });

    expect(result.consistent).toBe(true);
    expect(result.difference).toBe(0);
    expect(result.issues).toEqual([]);
  });

  it("flags grand total discrepancies and line item math mismatches", () => {
    const result = reconcileInvoiceMath({
      subtotal: 100,
      discount_amount: 0,
      vat_amount: 15,
      grand_total: 150,
      items: [{ quantity: 2, unit_price: 50, line_total: 80, review_status: "pending" }],
    });

    expect(result.consistent).toBe(false);
    expect(result.difference).toBe(35);
    expect(result.issues.length).toBeGreaterThanOrEqual(2);
  });

  it("excludes rejected items when summing active line items", () => {
    const result = reconcileInvoiceMath({
      subtotal: 100,
      discount_amount: 0,
      vat_amount: 15,
      grand_total: 115,
      items: [
        { quantity: 1, unit_price: 100, line_total: 100, review_status: "approved" },
        { quantity: 1, unit_price: 50, line_total: 50, review_status: "rejected" },
      ],
    });

    expect(result.itemsSum).toBe(100);
    expect(result.consistent).toBe(true);
  });
});
