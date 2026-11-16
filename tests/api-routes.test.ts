import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiQuotaExhaustedError } from "@/lib/gemini/client";
import type { AiQuotaStatus, InvoiceRecord, UserSettings } from "@/types/invoice";

const hoisted = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  buildServerAiAnalyzer: vi.fn(),
  getOrCreateUserSettings: vi.fn(),
  getRawUserSettingsRow: vi.fn(),
  listUserInvoices: vi.fn(),
  getUserInvoiceById: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  requireApiUser: hoisted.requireApiUser,
}));

vi.mock("@/lib/invoices/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/invoices/repository")>();
  return {
    ...actual,
    buildServerAiAnalyzer: hoisted.buildServerAiAnalyzer,
    getOrCreateUserSettings: hoisted.getOrCreateUserSettings,
    getRawUserSettingsRow: hoisted.getRawUserSettingsRow,
    listUserInvoices: hoisted.listUserInvoices,
    getUserInvoiceById: hoisted.getUserInvoiceById,
  };
});

import { GET as getAiStatus } from "@/app/api/ai/status/route";
import { POST as postAiCheck } from "@/app/api/ai/check/route";
import { GET as getSettings, PATCH as patchSettings } from "@/app/api/settings/route";
import { GET as getInvoices } from "@/app/api/invoices/route";
import { GET as exportInvoices } from "@/app/api/invoices/export/route";
import { POST as verifyInvoice } from "@/app/api/invoices/[id]/verify/route";
import { POST as postChat } from "@/app/api/chat/route";
import { POST as postChatSpeak } from "@/app/api/chat/speak/route";

const SAMPLE_AI_STATUS: AiQuotaStatus = {
  enabled: true,
  available: true,
  reason: "ready",
  models: ["gemini-3.8-flash", "gemini-3.6-flash"],
  eligible_models: ["gemini-3.8-flash", "gemini-3.6-flash"],
  active_model: "gemini-3.8-flash",
  retry_after_seconds: 0,
  last_error_code: null,
  last_error: null,
  checked_at: "2026-11-16T12:00:00.000Z",
  key_source: "user_settings",
};

const SAMPLE_SETTINGS: UserSettings = {
  user_id: "usr-test-1",
  require_line_by_line_review: true,
  default_currency: "SAR",
  auto_delete_days: null,
  updated_at: "2026-11-16T12:00:00.000Z",
  has_custom_api_key: true,
  custom_api_key_hint: "Dummy••••5678",
};

function requireResponse(resp: Response | undefined): Response {
  expect(resp).toBeDefined();
  if (!resp) {
    throw new Error("Expected route handler to return a Response");
  }
  return resp;
}

const SAMPLE_INVOICE_ID = "22222222-2222-4222-8222-222222222222";

function makeSampleInvoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: SAMPLE_INVOICE_ID,
    user_id: "usr-test-1",
    file_path: "usr-test-1/inv/jarir.jpg",
    file_name: "jarir.jpg",
    mime_type: "image/jpeg",
    file_size: 4096,
    vendor_name: "مكتبة جرير",
    vendor_tax_number: "300000000000003",
    invoice_number: "9001",
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
    verification_status: "pending_review",
    processing_mode: "gemini_ai_studio:gemini-3.8-flash",
    ai_model: "gemini-3.8-flash",
    field_approvals: {},
    math_consistent: true,
    math_difference: 0,
    created_at: "2026-11-16T11:00:00Z",
    updated_at: "2026-11-16T11:00:00Z",
    items: [
      {
        id: "item-1",
        invoice_id: SAMPLE_INVOICE_ID,
        user_id: "usr-test-1",
        line_index: 0,
        item_name: "دفتر",
        quantity: 2,
        unit_price: 50,
        tax_amount: 15,
        line_total: 100,
        review_status: "pending",
        review_note: null,
        created_at: "2026-11-16T11:00:00Z",
      },
    ],
    ...overrides,
  };
}

function createFakeSupabaseClient(options?: {
  upsertResult?: { data: Record<string, unknown> | null; error: { message: string } | null };
  invoiceUpdateError?: { message: string } | null;
  itemsInsertError?: { message: string } | null;
}) {
  return {
    from(table: string) {
      if (table === "user_settings") {
        return {
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue(
                options?.upsertResult ?? {
                  data: {
                    user_id: "usr-test-1",
                    require_line_by_line_review: true,
                    default_currency: "SAR",
                    auto_delete_days: null,
                    custom_gemini_api_key: "DummyKeyPrefixValue5678",
                  },
                  error: null,
                }
              ),
            }),
          }),
        };
      }

      if (table === "invoices") {
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: options?.invoiceUpdateError ?? null }),
            }),
          }),
        };
      }

      if (table === "invoice_items") {
        return {
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
          insert: vi.fn().mockResolvedValue({ error: options?.itemsInsertError ?? null }),
        };
      }

      throw new Error(`Unexpected table mock: ${table}`);
    },
  };
}

describe("API routes: auth, AI status, settings, invoice menus, verify, and voice/text chat", () => {
  const mockAnalyzer = {
    getStatus: vi.fn(),
    probeQuota: vi.fn(),
    chatWithInvoices: vi.fn(),
    synthesizeArabicSpeech: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyzer.getStatus.mockResolvedValue(SAMPLE_AI_STATUS);
    mockAnalyzer.probeQuota.mockResolvedValue(SAMPLE_AI_STATUS);
    hoisted.buildServerAiAnalyzer.mockResolvedValue(mockAnalyzer);
    hoisted.getOrCreateUserSettings.mockResolvedValue(SAMPLE_SETTINGS);
    hoisted.getRawUserSettingsRow.mockResolvedValue({
      user_id: "usr-test-1",
      require_line_by_line_review: true,
      default_currency: "SAR",
      auto_delete_days: null,
      custom_gemini_api_key: null,
    });
    hoisted.requireApiUser.mockResolvedValue({
      supabase: createFakeSupabaseClient(),
      user: { id: "usr-test-1", email: "ali@example.com" },
    });
  });

  it("blocks unauthenticated calls consistently across protected endpoints", async () => {
    hoisted.requireApiUser.mockResolvedValue({
      errorResponse: NextResponse.json({ error: "يجب تسجيل الدخول أولاً." }, { status: 401 }),
    });

    const resp = requireResponse(await getAiStatus());
    expect(resp.status).toBe(401);

    const chatResp = requireResponse(
      await postChat(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "مرحبا" }),
        })
      )
    );
    expect(chatResp.status).toBe(401);
  });

  it("returns AI status and probes quota cleanly for authenticated user", async () => {
    const statusResp = requireResponse(await getAiStatus());
    expect(statusResp.status).toBe(200);
    expect(await statusResp.json()).toEqual(SAMPLE_AI_STATUS);
    expect(hoisted.buildServerAiAnalyzer).toHaveBeenCalledWith(expect.anything(), "usr-test-1");

    const checkResp = requireResponse(await postAiCheck());
    expect(checkResp.status).toBe(200);
    expect(mockAnalyzer.probeQuota).toHaveBeenCalledTimes(1);
  });

  it("handles GET/PATCH /api/settings safely and returns 409 if Supabase SQL migration is missing", async () => {
    const getResp = requireResponse(await getSettings());
    expect(getResp.status).toBe(200);
    const getJson = await getResp.json();
    expect(getJson.settings).toEqual(SAMPLE_SETTINGS);
    expect(getJson.ai_status.key_source).toBe("user_settings");

    const patchResp = requireResponse(
      await patchSettings(
        new Request("http://localhost/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ custom_gemini_api_key: "DummyKeyPrefixValue5678" }),
        })
      )
    );
    expect(patchResp.status).toBe(200);
    const patchJson = await patchResp.json();
    expect(mockAnalyzer.probeQuota).toHaveBeenCalledTimes(1);
    expect("custom_gemini_api_key" in patchJson.settings).toBe(false);
    expect(patchJson.settings.custom_api_key_hint).toBe("Dummy••••5678");

    // Simulate missing custom_gemini_api_key column on un-migrated Supabase instance
    hoisted.requireApiUser.mockResolvedValue({
      supabase: createFakeSupabaseClient({
        upsertResult: {
          data: null,
          error: {
            message:
              "Could not find the 'custom_gemini_api_key' column of 'user_settings' in the schema cache",
          },
        },
      }),
      user: { id: "usr-test-1" },
    });

    const migrationResp = requireResponse(
      await patchSettings(
        new Request("http://localhost/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ custom_gemini_api_key: "DummyKeyPrefixValue5678" }),
        })
      )
    );
    expect(migrationResp.status).toBe(409);
    const migrationJson = await migrationResp.json();
    expect(migrationJson.migrationRequired).toBe(true);
  });

  it("forwards search, status, and category filters on /api/invoices and /api/invoices/export", async () => {
    const filtered = [makeSampleInvoice()];
    hoisted.listUserInvoices.mockResolvedValue(filtered);

    const listReq = new NextRequest(
      "http://localhost/api/invoices?q=%D8%AC%D8%B1%D9%8A%D8%B1&status=pending_review&category=%D9%85%D8%B3%D8%AA%D9%84%D8%B2%D9%85%D8%A7%D8%AA%20%D9%85%D9%83%D8%AA%D8%A8%D9%8A%D8%A9"
    );
    const listResp = requireResponse(await getInvoices(listReq));
    expect(listResp.status).toBe(200);
    expect(hoisted.listUserInvoices).toHaveBeenCalledWith(expect.anything(), "usr-test-1", {
      q: "جرير",
      status: "pending_review",
      category: "مستلزمات مكتبية",
    });

    const listBody = await listResp.json();
    expect(listBody.invoices).toHaveLength(1);
    expect(listBody.kpis.total_invoices).toBe(1);

    const exportReq = new NextRequest(
      "http://localhost/api/invoices/export?status=pending_review&category=%D9%85%D8%B3%D8%AA%D9%84%D8%B2%D9%85%D8%A7%D8%AA%20%D9%85%D9%83%D8%AA%D8%A8%D9%8A%D8%A9"
    );
    const exportResp = requireResponse(await exportInvoices(exportReq));
    expect(exportResp.status).toBe(200);
    expect(exportResp.headers.get("Content-Type")).toContain("text/csv");
    const csvBuf = Buffer.from(await exportResp.arrayBuffer());
    expect(Array.from(csvBuf.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(csvBuf.toString("utf8")).toContain("مكتبة جرير");
  });

  it("sets partial_rejected vs verified status on POST /api/invoices/[id]/verify", async () => {
    const baseInvoice = makeSampleInvoice({ ocr_status: "pending_ai" });
    hoisted.getUserInvoiceById
      .mockResolvedValueOnce(baseInvoice)
      .mockResolvedValueOnce({ ...baseInvoice, verification_status: "partial_rejected" });

    const verifyResp = requireResponse(
      await verifyInvoice(
        new Request(`http://localhost/api/invoices/${SAMPLE_INVOICE_ID}/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vendor_name: "مكتبة جرير",
            vendor_tax_number: "300000000000003",
            invoice_number: "9001",
            invoice_date: "2026-11-16",
            currency: "SAR",
            subtotal: 100,
            discount_amount: 0,
            vat_amount: 15,
            grand_total: 115,
            category: "مستلزمات مكتبية",
            notes: null,
            field_approvals: { vendor_name: "approved", grand_total: "rejected" },
            mark_as_manual: true,
            items: [
              {
                line_index: 0,
                item_name: "دفتر",
                quantity: 2,
                unit_price: 50,
                tax_amount: 15,
                line_total: 100,
                review_status: "approved",
                review_note: null,
              },
            ],
          }),
        }),
        { params: Promise.resolve({ id: SAMPLE_INVOICE_ID }) }
      )
    );

    expect(verifyResp.status).toBe(200);
    const json = await verifyResp.json();
    expect(json.status).toBe("partial_rejected");
  });

  it("handles invoice chat and Arabic TTS speech routes cleanly", async () => {
    // 1) Chat when empty invoices
    hoisted.listUserInvoices.mockResolvedValueOnce([]);
    const emptyChatResp = requireResponse(
      await postChat(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "كم الإجمالي؟" }),
        })
      )
    );
    expect(emptyChatResp.status).toBe(200);
    const emptyJson = await emptyChatResp.json();
    expect(emptyJson.answer_text).toContain("لا توجد فواتير");

    // 2) Chat with invoices + referenced invoice chip resolution
    const sampleInv = makeSampleInvoice();
    hoisted.listUserInvoices.mockResolvedValueOnce([sampleInv]);
    mockAnalyzer.chatWithInvoices.mockResolvedValueOnce({
      model: "gemini-3.8-flash",
      turn: {
        transcript: null,
        answer_text: "إجمالي فاتورة مكتبة جرير هو 115.00 SAR.",
        spoken_summary: "إجمالي فاتورة مكتبة جرير مئة وخمسة عشر ريالاً.",
        referenced_invoice_ids: [SAMPLE_INVOICE_ID],
      },
    });

    const chatResp = requireResponse(
      await postChat(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "كم إجمالي جرير؟", focusInvoiceId: SAMPLE_INVOICE_ID }),
        })
      )
    );
    expect(chatResp.status).toBe(200);
    const chatJson = await chatResp.json();
    expect(chatJson.referencedInvoices).toHaveLength(1);
    expect(chatJson.referencedInvoices[0].id).toBe(SAMPLE_INVOICE_ID);

    // 3) Speak success & quota fallback error
    mockAnalyzer.synthesizeArabicSpeech.mockResolvedValueOnce({
      audioBuffer: Buffer.from("RIFFfakewav"),
      mimeType: "audio/wav",
      model: "gemini-3.8-flash-tts",
    });

    const speakOk = requireResponse(
      await postChatSpeak(
        new Request("http://localhost/api/chat/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: "مرحبا بك", voiceName: "Kore" }),
        })
      )
    );
    expect(speakOk.status).toBe(200);
    expect(speakOk.headers.get("Content-Type")).toBe("audio/wav");
    expect(speakOk.headers.get("X-TTS-Model")).toBe("gemini-3.8-flash-tts");

    mockAnalyzer.synthesizeArabicSpeech.mockRejectedValueOnce(
      new AiQuotaExhaustedError("تم استنفاد رصيد TTS", SAMPLE_AI_STATUS)
    );
    const speakQuota = requireResponse(
      await postChatSpeak(
        new Request("http://localhost/api/chat/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: "اختبار" }),
        })
      )
    );
    expect(speakQuota.status).toBe(429);
    const speakErrJson = await speakQuota.json();
    expect(speakErrJson.fallbackToBrowserTts).toBe(true);
  });
});
