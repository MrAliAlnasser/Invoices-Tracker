export class EnvConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvConfigurationError";
  }
}

export const DEFAULT_GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-flash-latest",
] as const;

export const DEFAULT_GEMINI_TTS_MODELS = [
  "gemini-3.8-flash-tts",
  "gemini-3.8-flash-lite-tts",
  "gemini-3.1-flash-tts-preview",
] as const;

export const DEFAULT_GEMINI_TTS_VOICE = "Kore";

export const DEFAULT_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB (Supabase Free limit)

export function getPublicSupabaseEnv(): { url: string; anonKey: string; configured: boolean } {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  return {
    url,
    anonKey,
    configured: Boolean(url && anonKey),
  };
}

export function requirePublicSupabaseEnv(): { url: string; anonKey: string } {
  const { url, anonKey, configured } = getPublicSupabaseEnv();
  if (!configured) {
    throw new EnvConfigurationError(
      "لم يتم ضبط متغيرات Supabase العامة (NEXT_PUBLIC_SUPABASE_URL و NEXT_PUBLIC_SUPABASE_ANON_KEY)."
    );
  }
  return { url, anonKey };
}

export function getServerEnv() {
  const { url: supabaseUrl, anonKey: supabaseAnonKey } = requirePublicSupabaseEnv();
  const supabaseServiceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const storageBucket = (process.env.SUPABASE_STORAGE_BUCKET ?? "invoices").trim() || "invoices";
  const geminiApiKey = (process.env.GEMINI_API_KEY ?? "").trim() || null;

  const rawModels = process.env.GEMINI_MODELS;
  const parsedModels = rawModels
    ? rawModels
        .split(/[,;\s]+/)
        .map((m) => m.trim())
        .filter(Boolean)
    : [...DEFAULT_GEMINI_MODELS];

  const geminiModels = Array.from(new Set(parsedModels));

  const rawTtsModels = process.env.GEMINI_TTS_MODELS;
  const parsedTtsModels = rawTtsModels
    ? rawTtsModels
        .split(/[,;\s]+/)
        .map((m) => m.trim())
        .filter(Boolean)
    : [...DEFAULT_GEMINI_TTS_MODELS];
  const geminiTtsModels = Array.from(new Set(parsedTtsModels));
  const geminiTtsVoice =
    (process.env.GEMINI_TTS_VOICE ?? DEFAULT_GEMINI_TTS_VOICE).trim() ||
    DEFAULT_GEMINI_TTS_VOICE;

  const cooldownSeconds = Math.max(
    10,
    Number.parseInt(process.env.GEMINI_COOLDOWN_SECONDS ?? "300", 10) || 300
  );
  const maxFileSizeBytes = Math.max(
    1024,
    Number.parseInt(
      process.env.GEMINI_MAX_FILE_SIZE_BYTES ?? String(DEFAULT_MAX_FILE_SIZE_BYTES),
      10
    ) || DEFAULT_MAX_FILE_SIZE_BYTES
  );

  return {
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey,
    storageBucket,
    geminiApiKey,
    geminiModels: geminiModels.length > 0 ? geminiModels : [...DEFAULT_GEMINI_MODELS],
    geminiTtsModels:
      geminiTtsModels.length > 0 ? geminiTtsModels : [...DEFAULT_GEMINI_TTS_MODELS],
    geminiTtsVoice,
    cooldownSeconds,
    maxFileSizeBytes,
    cronSecret: (process.env.CRON_SECRET ?? "").trim() || null,
  };
}
