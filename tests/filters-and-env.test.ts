import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maskApiKey, resolveEnvGeminiApiKey } from "@/lib/env";
import { GeminiArabicInvoiceAnalyzer, MemoryCooldownStore } from "@/lib/gemini/client";
import { computeFilterTabCounts, filterInvoices } from "@/lib/invoices/filters";
import { sanitizeUserSettingsRow } from "@/lib/invoices/repository";
import type { InvoiceRecord } from "@/types/invoice";

function makeInvoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    user_id: "user-1",
    file_path: "user-1/inv-1/fatora.jpg",
    file_name: "fatora.jpg",
    mime_type: "image/jpeg",
    file_size: 2048,
    vendor_name: "مكتبة جرير",
    vendor_tax_number: "300000000000003",
    invoice_number: "INV-101",
    invoice_date: "2026-11-16",
    currency: "SAR",
    subtotal: 100,
    vat_amount: 15,
    discount_amount: 0,
    grand_total: 115,
    category: "مستلزمات مكتبية",
    notes: null,
    raw_extracted_text: null,
    ocr_status: "analyzed",
    verification_status: "verified",
    processing_mode: "gemini_ai_studio:gemini-3.8-flash",
    ai_model: "gemini-3.8-flash",
    field_approvals: {},
    math_consistent: true,
    math_difference: 0,
    created_at: "2026-11-16T10:00:00Z",
    updated_at: "2026-11-16T10:00:00Z",
    items: [
      {
        id: "item-1",
        invoice_id: "11111111-1111-4111-8111-111111111111",
        user_id: "user-1",
        line_index: 0,
        item_name: "ورق طباعة A4",
        quantity: 2,
        unit_price: 50,
        tax_amount: 15,
        line_total: 100,
        review_status: "approved",
        review_note: null,
        created_at: "2026-11-16T10:00:00Z",
      },
    ],
    ...overrides,
  };
}

describe("Invoice filter tabs, counts, and search/category filtering", () => {
  const sampleInvoices: InvoiceRecord[] = [
    makeInvoice({
      id: "inv-verified",
      vendor_name: "مكتبة جرير",
      category: "مستلزمات مكتبية",
      ocr_status: "analyzed",
      verification_status: "verified",
    }),
    makeInvoice({
      id: "inv-auto-saved",
      vendor_name: "أسواق التميمي",
      category: "مواد غذائية",
      ocr_status: "analyzed",
      verification_status: "auto_saved",
    }),
    makeInvoice({
      id: "inv-pending-review",
      vendor_name: "محطة الدريس",
      category: "وقود",
      ocr_status: "analyzed",
      verification_status: "pending_review",
    }),
    makeInvoice({
      id: "inv-partial",
      vendor_name: "إكسترا",
      category: "إلكترونيات",
      ocr_status: "analyzed",
      verification_status: "partial_rejected",
    }),
    makeInvoice({
      id: "inv-pending-ai",
      vendor_name: null,
      file_name: "receipt-queued.pdf",
      category: "مشتريات عامة",
      ocr_status: "pending_ai",
      verification_status: "pending_review",
      items: [],
    }),
    makeInvoice({
      id: "inv-manual",
      vendor_name: "ورشة الصيانة السريعة",
      category: "صيانة",
      ocr_status: "manual",
      verification_status: "verified",
      items: [
        {
          id: "it-m1",
          invoice_id: "inv-manual",
          user_id: "user-1",
          line_index: 0,
          item_name: "تغيير زيت المحرك",
          quantity: 1,
          unit_price: 100,
          tax_amount: 15,
          line_total: 100,
          review_status: "edited",
          review_note: null,
          created_at: "2026-11-16T10:00:00Z",
        },
      ],
    }),
  ];

  it("computes accurate counts for all menu filter tabs", () => {
    const counts = computeFilterTabCounts(sampleInvoices);
    expect(counts).toEqual({
      all: 6,
      verified_all: 3, // verified + auto_saved + manual(verified)
      verified: 2,
      auto_saved: 1,
      pending_review: 2,
      partial_rejected: 1,
      pending_ai: 1,
      manual: 1,
    });
  });

  it("filters accurately by status tab, including auto_saved, partial_rejected, and manual", () => {
    expect(filterInvoices(sampleInvoices, { status: "all" })).toHaveLength(6);
    expect(filterInvoices(sampleInvoices, { status: "verified_all" }).map((i) => i.id)).toEqual([
      "inv-verified",
      "inv-auto-saved",
      "inv-manual",
    ]);
    expect(filterInvoices(sampleInvoices, { status: "auto_saved" }).map((i) => i.id)).toEqual([
      "inv-auto-saved",
    ]);
    expect(filterInvoices(sampleInvoices, { status: "partial_rejected" }).map((i) => i.id)).toEqual([
      "inv-partial",
    ]);
    expect(filterInvoices(sampleInvoices, { status: "pending_ai" }).map((i) => i.id)).toEqual([
      "inv-pending-ai",
    ]);
    expect(filterInvoices(sampleInvoices, { status: "manual" }).map((i) => i.id)).toEqual([
      "inv-manual",
    ]);
  });

  it("filters by category and Arabic item-level search query simultaneously", () => {
    const byCategory = filterInvoices(sampleInvoices, {
      status: "all",
      category: "وقود",
    });
    expect(byCategory.map((i) => i.id)).toEqual(["inv-pending-review"]);

    const byItemSearch = filterInvoices(sampleInvoices, {
      status: "verified_all",
      q: "زيت المحرك",
    });
    expect(byItemSearch.map((i) => i.id)).toEqual(["inv-manual"]);

    const byPdfName = filterInvoices(sampleInvoices, {
      status: "pending_ai",
      q: "RECEIPT-QUEUED",
    });
    expect(byPdfName.map((i) => i.id)).toEqual(["inv-pending-ai"]);
  });
});

describe("Gemini API key resolution, masking, settings sanitization, and key_source status", () => {
  const trackedVars = [
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "GOOGLE_AI_STUDIO_API_KEY",
    "NEXT_PUBLIC_GEMINI_API_KEY",
  ] as const;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of trackedVars) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of trackedVars) {
      if (savedEnv[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = savedEnv[k];
      }
    }
  });

  it("falls back through GEMINI_API_KEY and GOOGLE_API_KEY aliases cleanly", () => {
    expect(resolveEnvGeminiApiKey()).toBeNull();

    process.env.GOOGLE_API_KEY = "  dummy-google-api-key-value  ";
    expect(resolveEnvGeminiApiKey()).toBe("dummy-google-api-key-value");

    process.env.GEMINI_API_KEY = "dummy-primary-gemini-key";
    expect(resolveEnvGeminiApiKey()).toBe("dummy-primary-gemini-key");
  });

  it("masks API keys safely without leaking secrets", () => {
    expect(maskApiKey(null)).toBeNull();
    expect(maskApiKey("   ")).toBeNull();
    expect(maskApiKey("short")).toBe("••••••••");
    expect(maskApiKey("TestKeyPrefixMiddleEnd9876")).toBe("TestK••••9876");
  });

  it("strips raw custom_gemini_api_key when sanitizing user_settings rows", () => {
    const sanitized = sanitizeUserSettingsRow({
      user_id: "user-1",
      require_line_by_line_review: true,
      default_currency: "SAR",
      auto_delete_days: null,
      custom_gemini_api_key: "SecretSampleKeyValueForMaskTest4321",
    });

    expect(sanitized.has_custom_api_key).toBe(true);
    expect(sanitized.custom_api_key_hint).toBe("Secre••••4321");
    expect("custom_gemini_api_key" in sanitized).toBe(false);
  });

  it("reports accurate key_source and disabled reason in analyzer status", async () => {
    const noKeyAnalyzer = new GeminiArabicInvoiceAnalyzer({
      apiKey: null,
      keySource: "none",
      store: new MemoryCooldownStore(),
    });
    const noKeyStatus = await noKeyAnalyzer.getStatus();
    expect(noKeyStatus.enabled).toBe(false);
    expect(noKeyStatus.available).toBe(false);
    expect(noKeyStatus.reason).toBe("missing_api_key");
    expect(noKeyStatus.key_source).toBe("none");

    const userKeyAnalyzer = new GeminiArabicInvoiceAnalyzer({
      apiKey: "dummy-user-key-1234",
      keySource: "user_settings",
      models: ["gemini-3.8-flash"],
      store: new MemoryCooldownStore(),
      client: {
        models: {
          async generateContent() {
            return { text: "OK" };
          },
        },
      },
    });
    const userKeyStatus = await userKeyAnalyzer.getStatus();
    expect(userKeyStatus.enabled).toBe(true);
    expect(userKeyStatus.available).toBe(true);
    expect(userKeyStatus.key_source).toBe("user_settings");
  });
});
