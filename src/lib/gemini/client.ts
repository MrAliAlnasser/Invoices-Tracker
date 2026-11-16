import { createPartFromBase64, GoogleGenAI } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ensureWavAudio } from "@/lib/audio/wav";
import {
  DEFAULT_GEMINI_MODELS,
  DEFAULT_GEMINI_TTS_MODELS,
  DEFAULT_GEMINI_TTS_VOICE,
  DEFAULT_MAX_FILE_SIZE_BYTES,
} from "@/lib/env";
import {
  ArabicInvoiceExtractionSchema,
  type ArabicInvoiceExtraction,
} from "@/lib/invoices/schema";
import type { AiQuotaStatus } from "@/types/invoice";

export class AiQuotaExhaustedError extends Error {
  readonly status: AiQuotaStatus;
  constructor(message: string, status: AiQuotaStatus) {
    super(message);
    this.name = "AiQuotaExhaustedError";
    this.status = status;
  }
}

export class AiUnsupportedFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnsupportedFileError";
  }
}

export interface CooldownRow {
  model_name: string;
  cooldown_until: string | null;
  last_error_code: number | null;
  last_error_message: string | null;
  is_quota_error: boolean;
  last_success_at: string | null;
  updated_at: string;
}

export interface CooldownStore {
  list(models: string[]): Promise<CooldownRow[]>;
  markCooldown(params: {
    modelName: string;
    untilIso: string;
    statusCode: number | null;
    errorMessage: string | null;
    isQuotaError: boolean;
  }): Promise<void>;
  clearCooldown(modelName: string): Promise<void>;
}

export class MemoryCooldownStore implements CooldownStore {
  private map = new Map<string, CooldownRow>();

  async list(models: string[]): Promise<CooldownRow[]> {
    return models
      .map((m) => this.map.get(m))
      .filter((row): row is CooldownRow => Boolean(row));
  }

  async markCooldown(params: {
    modelName: string;
    untilIso: string;
    statusCode: number | null;
    errorMessage: string | null;
    isQuotaError: boolean;
  }): Promise<void> {
    const existing = this.map.get(params.modelName);
    this.map.set(params.modelName, {
      model_name: params.modelName,
      cooldown_until: params.untilIso,
      last_error_code: params.statusCode,
      last_error_message: params.errorMessage,
      is_quota_error: params.isQuotaError,
      last_success_at: existing?.last_success_at ?? null,
      updated_at: new Date().toISOString(),
    });
  }

  async clearCooldown(modelName: string): Promise<void> {
    const nowIso = new Date().toISOString();
    this.map.set(modelName, {
      model_name: modelName,
      cooldown_until: null,
      last_error_code: null,
      last_error_message: null,
      is_quota_error: false,
      last_success_at: nowIso,
      updated_at: nowIso,
    });
  }
}

export class SupabaseCooldownStore implements CooldownStore {
  constructor(
    private readClient: SupabaseClient,
    private writeClient: SupabaseClient | null
  ) {}

  async list(models: string[]): Promise<CooldownRow[]> {
    const { data, error } = await this.readClient
      .from("ai_model_cooldowns")
      .select("*")
      .in("model_name", models);

    if (error || !data) {
      return [];
    }
    return data as CooldownRow[];
  }

  async markCooldown(params: {
    modelName: string;
    untilIso: string;
    statusCode: number | null;
    errorMessage: string | null;
    isQuotaError: boolean;
  }): Promise<void> {
    if (!this.writeClient) return;
    await this.writeClient.from("ai_model_cooldowns").upsert(
      {
        model_name: params.modelName,
        cooldown_until: params.untilIso,
        last_error_code: params.statusCode,
        last_error_message: params.errorMessage,
        is_quota_error: params.isQuotaError,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "model_name" }
    );
  }

  async clearCooldown(modelName: string): Promise<void> {
    if (!this.writeClient) return;
    const nowIso = new Date().toISOString();
    await this.writeClient.from("ai_model_cooldowns").upsert(
      {
        model_name: modelName,
        cooldown_until: null,
        last_error_code: null,
        last_error_message: null,
        is_quota_error: false,
        last_success_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: "model_name" }
    );
  }
}

const SUPPORTED_INVOICE_MIMES: Record<string, string> = {
  "application/pdf": "application/pdf",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/heic": "image/heic",
  "image/heif": "image/heif",
};

const EXT_TO_INVOICE_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

export function resolveInvoiceMime(fileName: string, mimeType?: string | null): string | null {
  if (mimeType) {
    const clean = mimeType.split(";")[0].trim().toLowerCase();
    if (SUPPORTED_INVOICE_MIMES[clean]) return SUPPORTED_INVOICE_MIMES[clean];
  }
  const dotIdx = fileName.lastIndexOf(".");
  if (dotIdx >= 0) {
    const ext = fileName.slice(dotIdx).toLowerCase();
    if (EXT_TO_INVOICE_MIME[ext]) return EXT_TO_INVOICE_MIME[ext];
  }
  return null;
}

export function isGeminiSupportedInvoiceFile(
  fileName: string,
  mimeType?: string | null,
  sizeBytes?: number | null,
  maxBytes = DEFAULT_MAX_FILE_SIZE_BYTES
): boolean {
  if (!fileName) return false;
  if (typeof sizeBytes === "number") {
    if (sizeBytes <= 0 || sizeBytes > maxBytes) return false;
  }
  return resolveInvoiceMime(fileName, mimeType) !== null;
}

const ARABIC_INVOICE_PROMPT = `أنت خبير محاسبة وOCR متخصص في قراءة فواتير المشتريات العربية وثنائية اللغة (العربية والإنجليزية، بما في ذلك فواتير ضريبة القيمة المضافة ZATCA وإيصالات السوبرماركت والشركات).

اقرأ الفاتورة المرفقة بدقة واستخرج جميع الحقول والأرقام التالية بصيغة JSON:
1. vendor_name: اسم المتجر أو المورد كما يظهر في ترويسة الفاتورة.
2. vendor_tax_number: الرقم الضريبي (VAT Registration Number، عادة 15 رقمًا في السعودية) إن وُجد.
3. invoice_number: رقم الفاتورة.
4. invoice_date: تاريخ الفاتورة بصيغة YYYY-MM-DD بالأرقام الإنجليزية (0-9).
5. currency: رمز العملة (مثل SAR, AED, KWD, EGP, USD؛ الافتراضي SAR إذا كانت بالريال).
6. subtotal: المجموع قبل الضريبة (أو الصافي قبل VAT). إذا كانت الأسعار شاملة للضريبة ولم يُذكر المجموع الفرعي، احسبه بدقة أو ضع الإجمالي مطروحًا منه الضريبة.
7. discount_amount: قيمة الخصم الإجمالي (0 إذا لم يوجد).
8. vat_amount: مبلغ ضريبة القيمة المضافة (0 إذا لم يوجد).
9. grand_total: الإجمالي النهائي المستحق للدفع (Total / الإجمالي شامل الضريبة).
10. category: تصنيف مختصر للفاتورة بالعربية (مثل: مستلزمات مكتبية، مواد غذائية، إلكترونيات، صيانة، وقود، مشتريات عامة).
11. notes: أي ملاحظات مفيدة مختصرة.
12. raw_extracted_text: النص الأساسي المقروء من الفاتورة بوضوح.
13. items: مصفوفة بجميع بنود الأصناف سطرًا بسطر؛ كل سطر يحتوي:
    - item_name: اسم الصنف أو الخدمة بالعربية كما في الفاتورة
    - quantity: الكمية (الافتراضي 1)
    - unit_price: سعر الوحدة
    - tax_amount: ضريبة السطر إن ذُكرت منفصلة (وإلا 0)
    - line_total: إجمالي هذا السطر

تعليمات مهمة:
- حوّل جميع الأرقام العربية الشرقية (٠١٢٣٤٥٦٧٨٩) إلى أرقام قياسية (0-9) دائمًا.
- لا تخمّن أرقامًا غير موجودة؛ إذا غاب حقل نصي أعد null، وإذا غاب رقم مالي غير مذكور أعد 0.`;

const GEMINI_INVOICE_RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    vendor_name: { type: ["string", "null"] },
    vendor_tax_number: { type: ["string", "null"] },
    invoice_number: { type: ["string", "null"] },
    invoice_date: { type: ["string", "null"] },
    currency: { type: "string" },
    subtotal: { type: "number" },
    discount_amount: { type: "number" },
    vat_amount: { type: "number" },
    grand_total: { type: "number" },
    category: { type: ["string", "null"] },
    notes: { type: ["string", "null"] },
    raw_extracted_text: { type: ["string", "null"] },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          item_name: { type: "string" },
          quantity: { type: "number" },
          unit_price: { type: "number" },
          tax_amount: { type: "number" },
          line_total: { type: "number" },
        },
        required: ["item_name", "quantity", "unit_price", "line_total"],
      },
    },
  },
  required: ["vendor_name", "currency", "subtotal", "vat_amount", "grand_total", "items"],
} as const;

export interface GenAiPartLike {
  text?: string;
  inlineData?: { data?: string; mimeType?: string };
}

export interface GenAiLikeClient {
  models: {
    generateContent(params: {
      model: string;
      contents: unknown;
      config?: Record<string, unknown>;
    }): Promise<{
      text?: string;
      candidates?: Array<{ content?: { parts?: GenAiPartLike[] } }>;
    }>;
  };
}

export const InvoiceChatTurnSchema = z.object({
  transcript: z.string().nullable().optional().default(null),
  answer_text: z.string().trim().min(1),
  spoken_summary: z.string().trim().optional().default(""),
  referenced_invoice_ids: z.array(z.string()).optional().default([]),
});

export type InvoiceChatTurnResult = z.infer<typeof InvoiceChatTurnSchema>;

const INVOICE_CHAT_RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    transcript: { type: ["string", "null"] },
    answer_text: { type: "string" },
    spoken_summary: { type: "string" },
    referenced_invoice_ids: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["answer_text", "spoken_summary", "referenced_invoice_ids"],
} as const;

const INVOICE_CHAT_SYSTEM_PROMPT = `أنت المساعد المالي والذكي لمنصة "فواتيري الذكية" لفواتير المشتريات العربية.
دورك مساعدة المستخدم باللغة العربية الواضحة في تحليل محتويات فواتيره والرد على أسئلته (سواء النصية أو الصوتية).

قواعد صارمة:
1. اعتمد فقط على بيانات الفواتير المرفقة في السياق ولا تخترع فواتير أو أرقامًا غير موجودة.
2. إذا طلب المستخدم حسابات أو مقارنات، استخدم الأرقام المحسوبة في ملخص الإحصائيات وتفاصيل البنود بدقة.
3. أجب باللغة العربية بشكل منظم ومفيد في حقل answer_text.
4. اكتب في حقل spoken_summary ملخصًا صوتيًا عربيًا طبيعيًا وسلسًا للقراءة (بدون رموز مثل * أو # أو أقواس برمجية، وحوّل رموز مثل SAR إلى "ريال سعودي" ليبدو النطق طبيعيًا).
5. إذا كان سؤال المستخدم رسالة صوتية، فرّغ كلامه بدقة في حقل transcript (وإن كان نصًا اتركه null).
6. ضع في referenced_invoice_ids معرفات الفواتير (id) التي اعتمدت عليها في الإجابة.`;

function cleanSpokenFallback(text: string): string {
  return text
    .replace(/[*_`#[\]()]/g, " ")
    .replace(/\bSAR\b/gi, "ريال سعودي")
    .replace(/\bUSD\b/gi, "دولار أمريكي")
    .replace(/\bAED\b/gi, "درهم إماراتي")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

function classifyGeminiError(err: unknown): {
  statusCode: number | null;
  message: string;
  isQuota: boolean;
} {
  const rec = (err && typeof err === "object" ? err : {}) as Record<string, unknown>;
  const rawCode = rec.status ?? rec.code;
  const statusCode = typeof rawCode === "number" ? rawCode : null;
  const message =
    err instanceof Error
      ? err.message
      : typeof rec.message === "string"
        ? rec.message
        : String(err);
  const lower = message.toLowerCase();
  const isQuota =
    statusCode === 429 ||
    lower.includes("resource_exhausted") ||
    lower.includes("quota") ||
    lower.includes("rate limit");

  return {
    statusCode,
    message: message.slice(0, 240),
    isQuota,
  };
}

export class GeminiArabicInvoiceAnalyzer {
  private readonly models: string[];
  private readonly ttsModels: string[];
  private readonly ttsVoice: string;
  private readonly cooldownSeconds: number;
  private readonly store: CooldownStore;
  private readonly client: GenAiLikeClient | null;

  constructor(options: {
    apiKey: string | null;
    models?: string[];
    ttsModels?: string[];
    ttsVoice?: string;
    cooldownSeconds?: number;
    store?: CooldownStore;
    client?: GenAiLikeClient;
  }) {
    const rawModels = options.models?.length ? options.models : [...DEFAULT_GEMINI_MODELS];
    const rawTts = options.ttsModels?.length
      ? options.ttsModels
      : [...DEFAULT_GEMINI_TTS_MODELS];
    this.models = Array.from(new Set(rawModels.map((m) => m.trim()).filter(Boolean)));
    this.ttsModels = Array.from(new Set(rawTts.map((m) => m.trim()).filter(Boolean)));
    this.ttsVoice = (options.ttsVoice ?? DEFAULT_GEMINI_TTS_VOICE).trim() || DEFAULT_GEMINI_TTS_VOICE;
    this.cooldownSeconds = Math.max(10, options.cooldownSeconds ?? 300);
    this.store = options.store ?? new MemoryCooldownStore();
    this.client =
      options.client ??
      (options.apiKey
        ? (new GoogleGenAI({ apiKey: options.apiKey, apiVersion: "v1beta" }) as GenAiLikeClient)
        : null);
  }

  async getStatus(now = new Date()): Promise<AiQuotaStatus> {
    if (!this.client) {
      return {
        enabled: false,
        available: false,
        reason: "missing_api_key",
        models: this.models,
        eligible_models: [],
        active_model: null,
        retry_after_seconds: 0,
        last_error_code: null,
        last_error: "GEMINI_API_KEY غير مضبوط.",
        checked_at: null,
      };
    }

    const rows = await this.store.list(this.models);
    const byModel = new Map(rows.map((r) => [r.model_name, r]));
    const nowMs = now.getTime();

    const eligible: string[] = [];
    const remainingSecs: number[] = [];
    let latestErrorRow: CooldownRow | null = null;
    let latestSuccessRow: CooldownRow | null = null;

    for (const modelName of this.models) {
      const row = byModel.get(modelName);
      if (row) {
        if (row.last_error_message && (!latestErrorRow || row.updated_at > latestErrorRow.updated_at)) {
          latestErrorRow = row;
        }
        if (
          row.last_success_at &&
          (!latestSuccessRow || row.last_success_at > (latestSuccessRow.last_success_at ?? ""))
        ) {
          latestSuccessRow = row;
        }
      }

      const untilMs = row?.cooldown_until ? Date.parse(row.cooldown_until) : 0;
      if (!untilMs || Number.isNaN(untilMs) || untilMs <= nowMs) {
        eligible.push(modelName);
      } else {
        remainingSecs.push(Math.max(1, Math.ceil((untilMs - nowMs) / 1000)));
      }
    }

    const available = eligible.length > 0;
    const retryAfterSeconds = available ? 0 : Math.min(...(remainingSecs.length ? remainingSecs : [this.cooldownSeconds]));

    let reason: AiQuotaStatus["reason"] = "ready";
    if (!available) {
      if (latestErrorRow?.is_quota_error) {
        reason = "quota_exhausted";
      } else if (latestErrorRow?.last_error_code === 401 || latestErrorRow?.last_error_code === 403) {
        reason = "api_auth_error";
      } else {
        reason = "models_in_cooldown";
      }
    }

    return {
      enabled: true,
      available,
      reason,
      models: this.models,
      eligible_models: eligible,
      active_model: eligible[0] ?? latestSuccessRow?.model_name ?? null,
      retry_after_seconds: retryAfterSeconds,
      last_error_code: latestErrorRow?.last_error_code ?? null,
      last_error: latestErrorRow?.last_error_message ?? null,
      checked_at: latestErrorRow?.updated_at ?? latestSuccessRow?.last_success_at ?? null,
    };
  }

  private cooldownDurationFor(statusCode: number | null): number {
    if (statusCode === 404) return Math.max(this.cooldownSeconds, 1800);
    if (statusCode !== null && statusCode >= 500) return Math.min(this.cooldownSeconds, 60);
    return this.cooldownSeconds;
  }

  private async invokeWithFallback<T>(params: {
    candidates: string[];
    runModel: (model: string) => Promise<T>;
  }): Promise<{ model: string; result: T }> {
    if (!this.client) {
      throw new AiQuotaExhaustedError("GEMINI_API_KEY غير مفعّل.", await this.getStatus());
    }

    for (const modelName of params.candidates) {
      try {
        const result = await params.runModel(modelName);
        await this.store.clearCooldown(modelName);
        return { model: modelName, result };
      } catch (err) {
        const { statusCode, message, isQuota } = classifyGeminiError(err);
        if (statusCode === 400) {
          throw new AiUnsupportedFileError(`رفض النموذج محتوى الملف (${message}).`);
        }
        const durationSec = this.cooldownDurationFor(statusCode);
        const untilIso = new Date(Date.now() + durationSec * 1000).toISOString();
        await this.store.markCooldown({
          modelName,
          untilIso,
          statusCode,
          errorMessage: message,
          isQuotaError: isQuota,
        });
      }
    }

    const latestStatus = await this.getStatus();
    throw new AiQuotaExhaustedError(
      "جميع نماذج Gemini Flash وصلت للحد المتاح أو في فترة التبريد حاليًا.",
      latestStatus
    );
  }

  async analyzeArabicInvoice(params: {
    fileName: string;
    mimeType?: string | null;
    bytes: Buffer;
  }): Promise<{ model: string; extraction: ArabicInvoiceExtraction }> {
    const resolvedMime = resolveInvoiceMime(params.fileName, params.mimeType);
    if (!resolvedMime || params.bytes.length === 0) {
      throw new AiUnsupportedFileError("صيغة الملف أو حجمه غير صالح للتحليل الضوئي (OCR).");
    }

    const currentStatus = await this.getStatus();
    if (!currentStatus.available) {
      throw new AiQuotaExhaustedError(
        "لا يوجد رصيد متاح حاليًا في Google AI Studio. يمكنك التعديل يدويًا أو المحاولة عند تجدد الرصيد.",
        currentStatus
      );
    }

    const base64Data = params.bytes.toString("base64");
    const contents = [
      createPartFromBase64(base64Data, resolvedMime),
      `${ARABIC_INVOICE_PROMPT}\nاسم الملف: ${params.fileName}`,
    ];

    const client = this.client!;
    const { model, result } = await this.invokeWithFallback({
      candidates: currentStatus.eligible_models,
      runModel: async (activeModel) => {
        const response = await client.models.generateContent({
          model: activeModel,
          contents,
          config: {
            responseMimeType: "application/json",
            responseJsonSchema: GEMINI_INVOICE_RESPONSE_JSON_SCHEMA,
            temperature: 0.1,
          },
        });
        const text = response.text?.trim();
        if (!text) {
          throw new Error("استجابة فارغة من Gemini Flash.");
        }
        const parsedJson: unknown = JSON.parse(text);
        return ArabicInvoiceExtractionSchema.parse(parsedJson);
      },
    });

    return { model, extraction: result };
  }

  async probeQuota(): Promise<AiQuotaStatus & { probed: boolean }> {
    const client = this.client;
    if (!client) {
      return { ...(await this.getStatus()), probed: false };
    }

    try {
      await this.invokeWithFallback({
        candidates: this.models,
        runModel: async (activeModel) => {
          return client.models.generateContent({
            model: activeModel,
            contents: "Reply OK",
            config: {
              maxOutputTokens: 16,
              temperature: 0,
            },
          });
        },
      });
    } catch {
      // Failure marks cooldown in store; getStatus() exposes exact updated state.
    }

    return { ...(await this.getStatus()), probed: true };
  }

  async chatWithInvoices(params: {
    message?: string | null;
    audio?: { bytes: Buffer; mimeType: string } | null;
    history?: Array<{ role: "user" | "model"; text: string }>;
    contextText: string;
  }): Promise<{ model: string; turn: InvoiceChatTurnResult }> {
    const hasText = Boolean(params.message && params.message.trim());
    const hasAudio = Boolean(params.audio && params.audio.bytes.length > 0);
    if (!hasText && !hasAudio) {
      throw new AiUnsupportedFileError("يرجى كتابة سؤال أو تسجيل رسالة صوتية.");
    }

    const status = await this.getStatus();
    if (!status.available) {
      throw new AiQuotaExhaustedError(
        "لا يوجد رصيد متاح حاليًا في Google AI Studio للمحادثة.",
        status
      );
    }

    const contents: Array<{ role: "user" | "model"; parts: unknown[] }> = (
      params.history ?? []
    )
      .slice(-10)
      .map((item) => ({
        role: item.role,
        parts: [{ text: item.text }],
      }));

    const userParts: unknown[] = [];
    if (params.audio && params.audio.bytes.length > 0) {
      const cleanMime = params.audio.mimeType.split(";")[0].trim().toLowerCase() || "audio/webm";
      userParts.push(createPartFromBase64(params.audio.bytes.toString("base64"), cleanMime));
      userParts.push(
        hasText
          ? `استمع إلى التسجيل الصوتي وأجب عن سؤال المستخدم (${params.message?.trim()}) بالاستناد إلى بيانات الفواتير.`
          : "استمع إلى التسجيل الصوتي بالعربية، وفرّغ نص السؤال في حقل transcript، ثم أجب بالاستناد إلى بيانات الفواتير."
      );
    } else if (hasText) {
      userParts.push({ text: params.message!.trim() });
    }

    contents.push({ role: "user", parts: userParts });

    const client = this.client!;
    const { model, result } = await this.invokeWithFallback({
      candidates: status.eligible_models,
      runModel: async (activeModel) => {
        const response = await client.models.generateContent({
          model: activeModel,
          contents,
          config: {
            systemInstruction: `${INVOICE_CHAT_SYSTEM_PROMPT}\n\n${params.contextText}`,
            responseMimeType: "application/json",
            responseJsonSchema: INVOICE_CHAT_RESPONSE_JSON_SCHEMA,
            temperature: 0.2,
          },
        });
        const raw = response.text?.trim();
        if (!raw) {
          throw new Error("استجابة فارغة من Gemini أثناء المحادثة.");
        }
        const parsed = InvoiceChatTurnSchema.parse(JSON.parse(raw));
        return {
          ...parsed,
          spoken_summary: parsed.spoken_summary.trim() || cleanSpokenFallback(parsed.answer_text),
        };
      },
    });

    return { model, turn: result };
  }

  async synthesizeArabicSpeech(params: {
    text: string;
    voiceName?: string | null;
  }): Promise<{ audioBuffer: Buffer; mimeType: "audio/wav"; model: string }> {
    const cleanText = cleanSpokenFallback(params.text);
    if (!cleanText) {
      throw new AiUnsupportedFileError("لا يوجد نص صالح للنطق الصوتي.");
    }
    if (!this.client) {
      throw new AiQuotaExhaustedError("GEMINI_API_KEY غير مفعّل.", await this.getStatus());
    }

    const rows = await this.store.list(this.ttsModels);
    const byModel = new Map(rows.map((r) => [r.model_name, r]));
    const nowMs = Date.now();
    const eligibleTts = this.ttsModels.filter((m) => {
      const until = byModel.get(m)?.cooldown_until;
      const ms = until ? Date.parse(until) : 0;
      return !ms || Number.isNaN(ms) || ms <= nowMs;
    });

    if (eligibleTts.length === 0) {
      throw new AiQuotaExhaustedError(
        "نماذج الصوت في Gemini في فترة التبريد مؤقتًا.",
        await this.getStatus()
      );
    }

    const voice = params.voiceName?.trim() || this.ttsVoice;
    const client = this.client;

    const { model, result } = await this.invokeWithFallback({
      candidates: eligibleTts,
      runModel: async (ttsModel) => {
        const response = await client.models.generateContent({
          model: ttsModel,
          contents: `انطق النص العربي التالي بوضوح وبنبرة هادئة ومباشرة دون أي إضافات:\n${cleanText}`,
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: voice,
                },
              },
            },
          },
        });

        const parts = response.candidates?.[0]?.content?.parts ?? [];
        const audioPart = parts.find((p) => p.inlineData?.data);
        if (!audioPart?.inlineData?.data) {
          throw new Error("لم يُعد نموذج الصوت أي بيانات صوتية.");
        }

        const rawBytes = Buffer.from(audioPart.inlineData.data, "base64");
        return ensureWavAudio(rawBytes, audioPart.inlineData.mimeType);
      },
    });

    return {
      audioBuffer: result.buffer,
      mimeType: result.mimeType,
      model,
    };
  }
}
