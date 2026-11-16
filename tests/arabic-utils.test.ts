import { describe, expect, it } from "vitest";
import {
  csvEscape,
  invoicesToCsvWithBom,
  normalizeArabicDigits,
  normalizeIsoDate,
  parseFlexibleNumber,
  sanitizeStorageFilename,
} from "@/lib/invoices/arabic-utils";
import type { InvoiceRecord } from "@/types/invoice";

describe("Arabic invoice utilities", () => {
  it("normalizes Eastern Arabic and Persian numerals accurately", () => {
    expect(normalizeArabicDigits("١٬٢٥٠٫٧٥")).toBe("1250.75");
    expect(normalizeArabicDigits("۴۵۶٫۹۰")).toBe("456.90");
    expect(normalizeArabicDigits("رقم الفاتورة: ٢٠٢٦/١١")).toBe("رقم الفاتورة: 2026/11");
  });

  it("parses localized currency strings into clean rounded numbers", () => {
    expect(parseFlexibleNumber("١٬٢٥٠٫٧٥ ر.س")).toBe(1250.75);
    expect(parseFlexibleNumber("SAR 99.995")).toBe(100);
    expect(parseFlexibleNumber("غير متوفر", 0)).toBe(0);
    expect(parseFlexibleNumber(45.126)).toBe(45.13);
  });

  it("normalizes common invoice date formats and rejects invalid calendar dates", () => {
    expect(normalizeIsoDate("١٦/١١/٢٠٢٦")).toBe("2026-11-16");
    expect(normalizeIsoDate("2026-03-05")).toBe("2026-03-05");
    expect(normalizeIsoDate("31/02/2026")).toBeNull();
    expect(normalizeIsoDate(null)).toBeNull();
  });

  it("sanitizes filenames while preserving Arabic characters", () => {
    expect(sanitizeStorageFilename("..\\..\\فاتورة مكتبة 2026.pdf")).toBe("فاتورة_مكتبة_2026.pdf");
    expect(sanitizeStorageFilename("...")).toBe("invoice.bin");
  });

  it("exports UTF-8 BOM CSV with proper quoting for Excel", () => {
    expect(csvEscape('مكتبة "النجاح", الرياض')).toBe('"مكتبة ""النجاح"", الرياض"');
    const mockInvoice: InvoiceRecord = {
      id: "inv-1",
      user_id: "usr-1",
      file_path: "usr-1/inv-1/fatora.jpg",
      file_name: "fatora.jpg",
      mime_type: "image/jpeg",
      file_size: 2048,
      vendor_name: "مؤسسة الأمل التجارية",
      vendor_tax_number: "300123456700003",
      invoice_number: "INV-101",
      invoice_date: "2026-11-16",
      currency: "SAR",
      subtotal: 100,
      vat_amount: 15,
      discount_amount: 0,
      grand_total: 115,
      category: "مستلزمات",
      notes: null,
      raw_extracted_text: null,
      ocr_status: "analyzed",
      verification_status: "verified",
      processing_mode: "gemini_ai_studio:gemini-3.8-flash",
      ai_model: "gemini-3.8-flash",
      field_approvals: {},
      math_consistent: true,
      math_difference: 0,
      created_at: "2026-11-16T08:00:00Z",
      updated_at: "2026-11-16T08:00:00Z",
      items: [],
    };
    const csv = invoicesToCsvWithBom([mockInvoice]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("مؤسسة الأمل التجارية");
    expect(csv).toContain("115.00");
  });
});
