import { describe, expect, it } from "vitest";
import {
  AiQuotaExhaustedError,
  AiUnsupportedFileError,
  GeminiArabicInvoiceAnalyzer,
  isGeminiSupportedInvoiceFile,
  MemoryCooldownStore,
} from "@/lib/gemini/client";

describe("Gemini Arabic OCR fallback chain and cooldown state", () => {
  it("checks supported invoice formats and file size bounds", () => {
    expect(isGeminiSupportedInvoiceFile("fatora.jpg", "image/jpeg", 250_000)).toBe(true);
    expect(isGeminiSupportedInvoiceFile("invoice.pdf", "application/pdf", 5_000_000)).toBe(true);
    expect(isGeminiSupportedInvoiceFile("empty.jpg", "image/jpeg", 0)).toBe(false);
    expect(isGeminiSupportedInvoiceFile("archive.zip", "application/zip", 1024)).toBe(false);
    expect(isGeminiSupportedInvoiceFile("huge.pdf", "application/pdf", 60 * 1024 * 1024)).toBe(
      false
    );
  });

  it("fails over cleanly from primary Flash model to fallback on 429 quota error", async () => {
    const store = new MemoryCooldownStore();
    const calledModels: string[] = [];

    const analyzer = new GeminiArabicInvoiceAnalyzer({
      apiKey: "dummy-key",
      models: ["gemini-3.8-flash", "gemini-3.6-flash"],
      cooldownSeconds: 300,
      store,
      client: {
        models: {
          async generateContent({ model }) {
            calledModels.push(model);
            if (model === "gemini-3.8-flash") {
              const err = new Error("429 RESOURCE_EXHAUSTED");
              Object.assign(err, { status: 429 });
              throw err;
            }
            return {
              text: JSON.stringify({
                vendor_name: "مكتبة جرير",
                vendor_tax_number: "300000000000003",
                invoice_number: "INV-99",
                invoice_date: "2026-11-16",
                currency: "SAR",
                subtotal: 100,
                discount_amount: 0,
                vat_amount: 15,
                grand_total: 115,
                items: [
                  {
                    item_name: "دفتر ملاحظات",
                    quantity: 2,
                    unit_price: 50,
                    tax_amount: 0,
                    line_total: 100,
                  },
                ],
              }),
            };
          },
        },
      },
    });

    const out = await analyzer.analyzeArabicInvoice({
      fileName: "jarir.jpg",
      mimeType: "image/jpeg",
      bytes: Buffer.from("fake-image-bytes"),
    });

    expect(calledModels).toEqual(["gemini-3.8-flash", "gemini-3.6-flash"]);
    expect(out.model).toBe("gemini-3.6-flash");
    expect(out.extraction.vendor_name).toBe("مكتبة جرير");
    expect(out.extraction.grand_total).toBe(115);

    const status = await analyzer.getStatus();
    expect(status.available).toBe(true);
    expect(status.eligible_models).toEqual(["gemini-3.6-flash"]);
  });

  it("marks all exhausted models in cooldown and recovers on probeQuota", async () => {
    const store = new MemoryCooldownStore();
    let allowBackup = false;

    const analyzer = new GeminiArabicInvoiceAnalyzer({
      apiKey: "dummy-key",
      models: ["gemini-3.8-flash", "gemini-3.6-flash"],
      cooldownSeconds: 300,
      store,
      client: {
        models: {
          async generateContent({ model }) {
            if (allowBackup && model === "gemini-3.6-flash") {
              return { text: "OK" };
            }
            const err = new Error("quota exceeded 429 RESOURCE_EXHAUSTED");
            Object.assign(err, { status: 429 });
            throw err;
          },
        },
      },
    });

    await expect(
      analyzer.analyzeArabicInvoice({
        fileName: "test.png",
        mimeType: "image/png",
        bytes: Buffer.from("img"),
      })
    ).rejects.toBeInstanceOf(AiQuotaExhaustedError);

    const exhaustedStatus = await analyzer.getStatus();
    expect(exhaustedStatus.available).toBe(false);
    expect(exhaustedStatus.reason).toBe("quota_exhausted");
    expect(exhaustedStatus.retry_after_seconds).toBeGreaterThan(0);

    allowBackup = true;
    const probed = await analyzer.probeQuota();
    expect(probed.probed).toBe(true);
    expect(probed.available).toBe(true);
    expect(probed.active_model).toBe("gemini-3.6-flash");
  });

  it("throws AiUnsupportedFileError on HTTP 400 without triggering cooldown", async () => {
    const store = new MemoryCooldownStore();
    const analyzer = new GeminiArabicInvoiceAnalyzer({
      apiKey: "dummy-key",
      models: ["gemini-3.8-flash"],
      store,
      client: {
        models: {
          async generateContent() {
            const err = new Error("Unable to process corrupted image");
            Object.assign(err, { status: 400 });
            throw err;
          },
        },
      },
    });

    await expect(
      analyzer.analyzeArabicInvoice({
        fileName: "bad.jpg",
        mimeType: "image/jpeg",
        bytes: Buffer.from("bad"),
      })
    ).rejects.toBeInstanceOf(AiUnsupportedFileError);

    const status = await analyzer.getStatus();
    expect(status.available).toBe(true);
  });

  it("supports Arabic voice and text chat over grounded invoice context", async () => {
    const store = new MemoryCooldownStore();
    const analyzer = new GeminiArabicInvoiceAnalyzer({
      apiKey: "dummy-key",
      models: ["gemini-3.8-flash"],
      store,
      client: {
        models: {
          async generateContent() {
            return {
              text: JSON.stringify({
                transcript: "كم إجمالي فواتير مكتبة جرير؟",
                answer_text: "إجمالي فواتير **مكتبة جرير** هو `115.00 SAR`.",
                spoken_summary: "",
                referenced_invoice_ids: ["inv-1"],
              }),
            };
          },
        },
      },
    });

    const out = await analyzer.chatWithInvoices({
      audio: { bytes: Buffer.from("fake-webm-audio"), mimeType: "audio/webm" },
      contextText: '{"totalSpend":115}',
    });

    expect(out.model).toBe("gemini-3.8-flash");
    expect(out.turn.transcript).toBe("كم إجمالي فواتير مكتبة جرير؟");
    expect(out.turn.referenced_invoice_ids).toEqual(["inv-1"]);
    // Fallback spoken summary strips markdown and expands currency symbols for natural voice output
    expect(out.turn.spoken_summary).toContain("ريال سعودي");
    expect(out.turn.spoken_summary).not.toContain("**");
  });

  it("synthesizes Arabic TTS speech with fallback and wraps raw PCM to playable WAV", async () => {
    const store = new MemoryCooldownStore();
    const calledTts: string[] = [];
    const rawPcmSample = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]);

    const analyzer = new GeminiArabicInvoiceAnalyzer({
      apiKey: "dummy-key",
      models: ["gemini-3.8-flash"],
      ttsModels: ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"],
      ttsVoice: "Kore",
      store,
      client: {
        models: {
          async generateContent({ model }) {
            calledTts.push(model);
            if (model === "gemini-3.8-flash-tts") {
              const err = new Error("429 RESOURCE_EXHAUSTED");
              Object.assign(err, { status: 429 });
              throw err;
            }
            return {
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        inlineData: {
                          data: rawPcmSample.toString("base64"),
                          mimeType: "audio/L16;codec=pcm;rate=24000",
                        },
                      },
                    ],
                  },
                },
              ],
            };
          },
        },
      },
    });

    const speech = await analyzer.synthesizeArabicSpeech({
      text: "إجمالي المشتريات هو مئة وخمسة عشر ريال سعودي",
    });

    expect(calledTts).toEqual(["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"]);
    expect(speech.model).toBe("gemini-3.8-flash-lite-tts");
    expect(speech.mimeType).toBe("audio/wav");
    expect(speech.audioBuffer.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(speech.audioBuffer.length).toBe(44 + rawPcmSample.length);

    // Main OCR model status stays unaffected by TTS cooldowns
    const ocrStatus = await analyzer.getStatus();
    expect(ocrStatus.available).toBe(true);
  });
});
