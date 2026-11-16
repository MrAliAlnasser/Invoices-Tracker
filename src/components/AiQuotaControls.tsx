"use client";

import Link from "next/link";
import { RefreshCw, Settings, Sparkles } from "lucide-react";
import type { AiQuotaStatus } from "@/types/invoice";

interface AiQuotaControlsProps {
  status: AiQuotaStatus;
  checking: boolean;
  onCheckQuota: () => void;
}

export function AiQuotaControls({ status, checking, onCheckQuota }: AiQuotaControlsProps) {
  const isAvailable = status.enabled && status.available;
  const badgeTitle = !status.enabled
    ? "لم يتم ضبط مفتاح Google AI Studio — اضغط لتفعيله من الإعدادات"
    : isAvailable
      ? `النماذج المتاحة حاليًا: ${status.eligible_models.join(" -> ")}`
      : `${status.last_error ?? "نفدت حصة API المؤقتة"}${status.retry_after_seconds ? ` (متبقٍ ~${status.retry_after_seconds} ثانية)` : ""}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!status.enabled ? (
        <Link
          href="/settings#ai-setup"
          title={badgeTitle}
          className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/45 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/25"
        >
          <Settings className="h-3.5 w-3.5 text-amber-300" />
          <span>الذكاء الاصطناعي غير مفعّل — اضغط للتفعيل</span>
        </Link>
      ) : (
        <>
          <span
            title={badgeTitle}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              isAvailable
                ? "border-violet-400/50 bg-gradient-to-l from-blue-500/20 via-indigo-500/20 to-violet-500/20 text-violet-200"
                : "border-slate-600 bg-slate-800/80 text-slate-300"
            }`}
          >
            <Sparkles
              className={`h-3.5 w-3.5 ${isAvailable ? "text-violet-300" : "text-slate-400"}`}
            />
            {isAvailable ? (
              <span>AI جاهز ({status.active_model ?? status.models[0] ?? "Gemini"})</span>
            ) : (
              <span>
                نفد رصيد AI
                {status.retry_after_seconds > 0 ? ` (~${status.retry_after_seconds}ث)` : ""}
              </span>
            )}
          </span>

          <button
            type="button"
            onClick={onCheckQuota}
            disabled={checking}
            title="إرسال فحص خفيف للتحقق من تجدد رصيد Google AI Studio دون إهدار الحصة عند فتح الصفحة"
            className="inline-flex items-center gap-1.5 rounded-full border border-indigo-400/35 bg-indigo-500/15 px-3 py-1.5 text-xs font-medium text-indigo-200 transition hover:bg-indigo-500/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} />
            <span>{checking ? "جاري الفحص..." : "فحص رصيد AI"}</span>
          </button>
        </>
      )}
    </div>
  );
}
