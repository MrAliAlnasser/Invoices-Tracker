"use client";

import { useState } from "react";
import { CheckCircle2, Save, ShieldCheck, Sliders, Trash2 } from "lucide-react";
import type { UserSettings } from "@/types/invoice";
import { Navbar } from "./Navbar";

interface SettingsViewProps {
  initialSettings: UserSettings;
  userEmail: string | null;
}

const CURRENCIES = ["SAR", "AED", "KWD", "QAR", "BHD", "OMR", "EGP", "JOD", "USD"];

export function SettingsView({ initialSettings, userEmail }: SettingsViewProps) {
  const [requireReview, setRequireReview] = useState(
    initialSettings.require_line_by_line_review
  );
  const [defaultCurrency, setDefaultCurrency] = useState(
    initialSettings.default_currency || "SAR"
  );
  const [retentionMode, setRetentionMode] = useState<"permanent" | "29days" | "custom">(
    initialSettings.auto_delete_days === null
      ? "permanent"
      : initialSettings.auto_delete_days === 29
        ? "29days"
        : "custom"
  );
  const [customDays, setCustomDays] = useState<number>(
    initialSettings.auto_delete_days ?? 29
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setSaving(true);

    const autoDeleteDays =
      retentionMode === "permanent"
        ? null
        : retentionMode === "29days"
          ? 29
          : Math.max(1, Math.min(3650, Number(customDays) || 29));

    try {
      const resp = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          require_line_by_line_review: requireReview,
          default_currency: defaultCurrency,
          auto_delete_days: autoDeleteDays,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || "تعذر حفظ الإعدادات.");
      }
      setNotice({
        type: "ok",
        text: requireReview
          ? "تم الحفظ: ستظهر نافذة تأكيد البيانات سطرًا بسطر تلقائيًا عند رفع كل فاتورة."
          : "تم الحفظ: تم إلغاء نافذة التأكيد التلقائية عند الرفع (تُحفظ الفواتير مباشرة ويمكن مراجعتها يدويًا في أي وقت).",
      });
    } catch (err) {
      setNotice({
        type: "error",
        text: err instanceof Error ? err.message : "فشل حفظ الإعدادات.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
      <Navbar
        userEmail={userEmail}
        requireLineReview={requireReview}
        activePage="settings"
      />

      <form onSubmit={handleSave} className="glass-card space-y-6 rounded-3xl p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <div className="flex items-center gap-2 text-indigo-300">
              <Sliders className="h-5 w-5" />
              <span className="text-xs font-semibold">تفضيلات المعالجة والأرشفة</span>
            </div>
            <h2 className="mt-1 text-xl font-bold text-white">إعدادات نظام فواتير المشتريات</h2>
            <p className="mt-1 text-sm text-slate-400">
              تحكّم في تفعيل أو إلغاء نافذة التأكيد سطرًا بسطر عند الرفع، وسياسة الاحتفاظ بالملفات.
            </p>
          </div>
        </div>

        {/* Toggle 1: Line-by-Line Confirmation Modal */}
        <div className="glass-surface flex flex-col justify-between gap-4 rounded-2xl p-5 sm:flex-row sm:items-center">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-400" />
              <h3 className="text-base font-bold text-white">
                تأكيد البيانات والأرقام المستخرجة سطرًا بسطر عند الرفع
              </h3>
            </div>
            <p className="max-w-2xl text-xs leading-relaxed text-slate-300 sm:text-sm">
              عند التفعيل، تفتح فور رفع الفاتورة نافذة تفاعلية تعرض صورة الفاتورة بجانب كل رقم وصنف
              لتوافق عليه أو تعدله سطرًا بسطر. عند إلغاء التفعيل، تُحفظ الفواتير مباشرةً في الجدول دون مقاطعة.
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={requireReview}
            onClick={() => setRequireReview((v) => !v)}
            className={`relative inline-flex h-8 w-16 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
              requireReview
                ? "border-indigo-400 bg-gradient-to-l from-blue-500 to-violet-600"
                : "border-slate-600 bg-slate-800"
            }`}
          >
            <span
              className={`inline-block h-6 w-6 rounded-full bg-white shadow transition-transform ${
                requireReview ? "-translate-x-1" : "-translate-x-9"
              }`}
            />
          </button>
        </div>

        {/* Retention Policy */}
        <div className="glass-surface space-y-3 rounded-2xl p-5">
          <div className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-indigo-300" />
            <h3 className="text-base font-bold text-white">سياسة الاحتفاظ بالفواتير والملفات</h3>
          </div>
          <p className="text-xs text-slate-400">
            في خطة Supabase المجانية (1 GB تخزين + 500 MB قاعدة بيانات)، يُنصح بالحفظ الدائم للفواتير
            أو تفعيل التنظيف الدوري فقط عند الحاجة لتفريغ المساحة.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              {
                id: "permanent" as const,
                title: "حفظ دائم (موصى به)",
                desc: "تبقى الفواتير وسجلاتها محفوظة دون حذف تلقائي.",
              },
              {
                id: "29days" as const,
                title: "حذف تلقائي بعد 29 يومًا",
                desc: "مسح تلقائي يومي للملفات والبنود الأقدم من 29 يومًا.",
              },
              {
                id: "custom" as const,
                title: "مدة مخصصة بالأيام",
                desc: "حدد عدد الأيام قبل الحذف التلقائي.",
              },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setRetentionMode(opt.id)}
                className={`rounded-xl border p-3.5 text-right transition ${
                  retentionMode === opt.id
                    ? "border-indigo-400 bg-indigo-500/15 text-white"
                    : "border-slate-700/80 bg-slate-900/50 text-slate-300 hover:border-slate-600"
                }`}
              >
                <p className="text-sm font-bold">{opt.title}</p>
                <p className="mt-1 text-xs text-slate-400">{opt.desc}</p>
              </button>
            ))}
          </div>

          {retentionMode === "custom" && (
            <div className="flex items-center gap-3 pt-2">
              <label className="text-xs text-slate-300" htmlFor="custom-days-input">
                احذف الفواتير الأقدم من:
              </label>
              <input
                id="custom-days-input"
                type="number"
                min={1}
                max={3650}
                value={customDays}
                onChange={(e) => setCustomDays(Number.parseInt(e.target.value, 10) || 29)}
                className="w-28 rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-sm text-white"
              />
              <span className="text-xs text-slate-400">يومًا</span>
            </div>
          )}
        </div>

        {/* Currency */}
        <div className="glass-surface flex flex-wrap items-center justify-between gap-4 rounded-2xl p-5">
          <div>
            <h3 className="text-base font-bold text-white">العملة الافتراضية للفواتير</h3>
            <p className="text-xs text-slate-400">
              تُستخدم إذا لم تذكر الفاتورة رمز العملة صراحةً.
            </p>
          </div>
          <select
            value={defaultCurrency}
            onChange={(e) => setDefaultCurrency(e.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 font-mono text-sm text-white"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {notice && (
          <div
            className={`flex items-center gap-2 rounded-2xl border px-4 py-3 text-xs font-medium sm:text-sm ${
              notice.type === "ok"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                : "border-rose-500/40 bg-rose-500/10 text-rose-200"
            }`}
          >
            {notice.type === "ok" && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />}
            <span>{notice.text}</span>
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="btn-ai-ready inline-flex items-center gap-2 rounded-2xl px-6 py-2.5 text-sm font-bold disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            <span>{saving ? "جاري الحفظ..." : "حفظ الإعدادات"}</span>
          </button>
        </div>
      </form>
    </main>
  );
}
