"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Mic,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  computeFilterTabCounts,
  filterInvoices,
  type InvoiceListFilterTab,
} from "@/lib/invoices/filters";
import { computeDashboardKpis, formatMoney } from "@/lib/invoices/kpis";
import type { AiQuotaStatus, InvoiceRecord, UserSettings } from "@/types/invoice";
import { InvoiceAiAssistant } from "./InvoiceAiAssistant";
import { KpiCards } from "./KpiCards";
import { LineByLineReviewer } from "./LineByLineReviewer";
import { Navbar } from "./Navbar";

interface InvoiceDashboardProps {
  initialInvoices: InvoiceRecord[];
  initialSettings: UserSettings;
  initialAiStatus: AiQuotaStatus;
  userEmail: string | null;
}

function verificationBadge(status: InvoiceRecord["verification_status"]) {
  switch (status) {
    case "verified":
      return {
        label: "معتمدة ✓",
        cls: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
      };
    case "partial_rejected":
      return {
        label: "تتطلب تصحيحًا",
        cls: "border-rose-500/40 bg-rose-500/15 text-rose-300",
      };
    case "auto_saved":
      return {
        label: "محفوظة تلقائيًا",
        cls: "border-sky-500/40 bg-sky-500/15 text-sky-300",
      };
    default:
      return {
        label: "بانتظار التأكيد",
        cls: "border-amber-500/40 bg-amber-500/15 text-amber-300",
      };
  }
}

export function InvoiceDashboard({
  initialInvoices,
  initialSettings,
  initialAiStatus,
  userEmail,
}: InvoiceDashboardProps) {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>(initialInvoices);
  const [settings, setSettings] = useState<UserSettings>(initialSettings);
  const [aiStatus, setAiStatus] = useState<AiQuotaStatus>(initialAiStatus);
  const [checkingAi, setCheckingAi] = useState(false);
  const [refreshingList, setRefreshingList] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<InvoiceListFilterTab>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // Upload states
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploadingStage, setUploadingStage] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ type: "ok" | "warn" | "error"; text: string } | null>(
    null
  );

  // Active row actions
  const [busyInvoiceId, setBusyInvoiceId] = useState<string | null>(null);
  const [reviewingInvoice, setReviewingInvoice] = useState<InvoiceRecord | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Voice & Text AI Assistant drawer
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantFocusInvoiceId, setAssistantFocusInvoiceId] = useState<string | null>(null);

  const tabCounts = useMemo(() => computeFilterTabCounts(invoices), [invoices]);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const inv of invoices) {
      const cat = inv.category?.trim();
      if (cat) set.add(cat);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ar"));
  }, [invoices]);

  const filteredInvoices = useMemo(
    () =>
      filterInvoices(invoices, {
        q: searchQuery,
        status: statusFilter,
        category: categoryFilter,
      }),
    [invoices, searchQuery, statusFilter, categoryFilter]
  );

  const validAssistantFocusId = useMemo(() => {
    if (!assistantFocusInvoiceId) return "";
    return invoices.some((inv) => inv.id === assistantFocusInvoiceId)
      ? assistantFocusInvoiceId
      : "";
  }, [invoices, assistantFocusInvoiceId]);

  const kpis = useMemo(() => computeDashboardKpis(invoices), [invoices]);

  const refreshInvoices = async () => {
    setRefreshingList(true);
    try {
      const resp = await fetch("/api/invoices");
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || "تعذر تحديث قائمة الفواتير.");
      }
      setInvoices(data.invoices ?? []);
      if (data.settings) setSettings(data.settings);
      if (data.ai_status) setAiStatus(data.ai_status);
    } finally {
      setRefreshingList(false);
    }
  };

  const openReviewerModal = async (invoice: InvoiceRecord) => {
    setReviewingInvoice(invoice);
    setPreviewUrl(null);
    try {
      const resp = await fetch(`/api/invoices/${invoice.id}/file`);
      const data = await resp.json();
      if (resp.ok && data.url) {
        setPreviewUrl(data.url);
      }
    } catch {
      setPreviewUrl(null);
    }
  };

  const handleFileUpload = async (file: File) => {
    setBanner(null);
    setUploadingStage("1/3 جاري تجهيز رابط الرفع الآمن المباشر...");

    try {
      const signResp = await fetch("/api/uploads/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          fileSize: file.size,
        }),
      });
      const signData = await signResp.json();
      if (!signResp.ok) {
        throw new Error(signData.error || "تعذر طلب تصريح الرفع.");
      }

      setUploadingStage("2/3 جاري رفع الفاتورة مباشرة إلى Supabase Storage...");
      const supabase = createSupabaseBrowserClient();
      const { error: uploadErr } = await supabase.storage
        .from(signData.bucket)
        .uploadToSignedUrl(signData.filePath, signData.token, file);

      if (uploadErr) {
        throw new Error(`فشل رفع الملف للتخزين السحابي: ${uploadErr.message}`);
      }

      setUploadingStage("3/3 جاري قراءة بيانات الفاتورة العربية بالذكاء الاصطناعي (OCR)...");
      const analyzeResp = await fetch("/api/invoices/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: signData.filePath,
          fileName: file.name,
          mimeType: file.type || null,
          fileSize: file.size,
        }),
      });
      const analyzeData = await analyzeResp.json();
      if (analyzeData.ai_status) {
        setAiStatus(analyzeData.ai_status);
      }
      if (!analyzeResp.ok) {
        throw new Error(analyzeData.error || "فشل تحليل الفاتورة.");
      }

      await refreshInvoices();

      const savedInvoice: InvoiceRecord | null = analyzeData.invoice ?? null;
      if (analyzeData.quotaExhausted) {
        setBanner({
          type: "warn",
          text: "نفد رصيد Google AI Studio مؤقتًا؛ تم حفظ ملف الفاتورة بأمان ويمكنك تعبئتها يدويًا الآن أو طلب تحليل AI لاحقًا عند تجدد الرصيد.",
        });
      } else if (!analyzeData.needsReview) {
        setBanner({
          type: "ok",
          text: `تم رفع واستخراج فاتورة "${savedInvoice?.vendor_name ?? file.name}" وحفظها مباشرة (نافذة التأكيد ملغاة في الإعدادات).`,
        });
      } else {
        setBanner({
          type: "ok",
          text: `تم استخراج بيانات "${savedInvoice?.vendor_name ?? file.name}" — يرجى تأكيد الأرقام سطرًا بسطر.`,
        });
      }

      if (savedInvoice && analyzeData.needsReview) {
        await openReviewerModal(savedInvoice);
      }
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? err.message : "حدث خطأ غير متوقع أثناء الرفع.",
      });
    } finally {
      setUploadingStage(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleCheckAiQuota = async () => {
    setCheckingAi(true);
    setBanner(null);
    try {
      const resp = await fetch("/api/ai/check", { method: "POST" });
      const data = await resp.json();
      setAiStatus(data);
      if (data.available) {
        setBanner({
          type: "ok",
          text: `رصيد الذكاء الاصطناعي متاح الآن (${data.active_model ?? "Gemini Flash"}). يمكنك تحليل الفواتير المنتظرة.`,
        });
      } else {
        setBanner({
          type: "warn",
          text: `لا يزال رصيد AI غير متاح حاليًا${data.retry_after_seconds ? ` (~${data.retry_after_seconds} ثانية)` : ""}. يمكنك تعديل الفواتير يدويًا في أي وقت.`,
        });
      }
    } catch {
      setBanner({ type: "error", text: "تعذر فحص رصيد AI حاليًا." });
    } finally {
      setCheckingAi(false);
    }
  };

  const handleRetryAi = async (invoice: InvoiceRecord) => {
    setBusyInvoiceId(invoice.id);
    setBanner(null);
    try {
      const resp = await fetch("/api/invoices/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: invoice.id }),
      });
      const data = await resp.json();
      if (data.ai_status) setAiStatus(data.ai_status);
      if (!resp.ok) {
        throw new Error(data.error || "تعذر تحليل الفاتورة عبر AI.");
      }

      await refreshInvoices();
      setBanner({
        type: "ok",
        text: `تم تحليل الفاتورة "${invoice.file_name}" باستخدام ${data.invoice?.ai_model ?? "Gemini Flash"}.`,
      });
      if (data.invoice && data.needsReview) {
        await openReviewerModal(data.invoice);
      }
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? err.message : "فشل تحليل الفاتورة.",
      });
    } finally {
      setBusyInvoiceId(null);
    }
  };

  const handleDownload = async (invoice: InvoiceRecord) => {
    setBusyInvoiceId(invoice.id);
    try {
      const resp = await fetch(`/api/invoices/${invoice.id}/file?download=1`);
      const data = await resp.json();
      if (!resp.ok || !data.url) {
        throw new Error(data.error || "تعذر تجهيز رابط التنزيل.");
      }
      const link = document.createElement("a");
      link.href = data.url;
      link.download = invoice.file_name;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? err.message : "تعذر تنزيل الملف.",
      });
    } finally {
      setBusyInvoiceId(null);
    }
  };

  const handleDelete = async (invoice: InvoiceRecord) => {
    const confirmed = window.confirm(
      `هل تريد حذف الفاتورة "${invoice.vendor_name ?? invoice.file_name}" نهائيًا من قاعدة البيانات والتخزين السحابي؟`
    );
    if (!confirmed) return;

    setBusyInvoiceId(invoice.id);
    setBanner(null);
    try {
      const resp = await fetch(`/api/invoices/${invoice.id}`, { method: "DELETE" });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || "فشل حذف الفاتورة.");
      }
      setInvoices((prev) => prev.filter((item) => item.id !== invoice.id));
      setBanner({
        type: "ok",
        text: `تم حذف الفاتورة وملفها "${invoice.file_name}" فورًا بنجاح.`,
      });
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? err.message : "تعذر حذف الفاتورة.",
      });
    } finally {
      setBusyInvoiceId(null);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6">
      <Navbar
        userEmail={userEmail}
        requireLineReview={settings.require_line_by_line_review}
        aiStatus={aiStatus}
        checkingAi={checkingAi}
        onCheckQuota={handleCheckAiQuota}
        onOpenAssistant={() => {
          setAssistantFocusInvoiceId(null);
          setAssistantOpen(true);
        }}
        activePage="dashboard"
      />

      {!aiStatus.enabled && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-100 sm:text-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
            <span>
              <strong>الذكاء الاصطناعي غير مفعّل حاليًا:</strong> لم يتم العثور على مفتاح{" "}
              <code className="font-mono text-amber-200">GEMINI_API_KEY</code> في متغيرات السيرفر
              أو حسابك. يمكنك تفعيله مباشرةً الآن.
            </span>
          </div>
          <Link
            href="/settings#ai-setup"
            className="btn-ai-ready rounded-xl px-3.5 py-1.5 text-xs font-bold"
          >
            تفعيل الذكاء الاصطناعي من الإعدادات
          </Link>
        </div>
      )}

      <KpiCards kpis={kpis} currency={settings.default_currency || "SAR"} />

      {/* Direct Dropzone Upload Section */}
      <section className="glass-card rounded-3xl p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-white sm:text-lg">
              رفع فاتورة مشتريات عربية جديدة
            </h2>
            <p className="text-xs text-slate-400">
              رفع مباشر إلى Supabase Storage (حتى 50 MB) &bull;{" "}
              {settings.require_line_by_line_review ? (
                <span className="text-emerald-300">
                  ستفتح نافذة تأكيد البيانات سطرًا بسطر بعد التحليل
                </span>
              ) : (
                <span className="text-sky-300">
                  التأكيد سطرًا بسطر معطّل حاليًا — الحفظ مباشر{" "}
                  <Link href="/settings" className="underline">
                    (تعديل من الإعدادات)
                  </Link>
                </span>
              )}
            </p>
          </div>
          <span className="rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-[11px] text-slate-300">
            {settings.auto_delete_days === null
              ? "الحفظ: دائم"
              : `الحذف التلقائي: كل ${settings.auto_delete_days} يومًا`}
          </span>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            const dropped = e.dataTransfer.files?.[0];
            if (dropped && !uploadingStage) {
              void handleFileUpload(dropped);
            }
          }}
          onClick={() => !uploadingStage && fileInputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-8 text-center transition ${
            dragActive
              ? "border-indigo-400 bg-indigo-500/15"
              : "border-slate-700/80 bg-slate-950/45 hover:border-indigo-500/50 hover:bg-slate-900/60"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.pdf,.jpg,.jpeg,.png,.webp"
            className="hidden"
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              if (chosen) void handleFileUpload(chosen);
            }}
          />
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500/20 to-violet-500/20 text-indigo-300">
            <Upload className="h-6 w-6" />
          </div>
          {uploadingStage ? (
            <div className="space-y-2">
              <p className="text-sm font-bold text-indigo-200">{uploadingStage}</p>
              <p className="text-xs text-slate-400">يرجى الانتظار لحظات...</p>
            </div>
          ) : (
            <>
              <p className="text-sm font-semibold text-white">
                اسحب صورة الفاتورة أو ملف PDF وأفلته هنا، أو اضغط للاختيار
              </p>
              <p className="mt-1 text-xs text-slate-400">
                يدعم فواتير الضريبة السعودية والعربية، الإيصالات الحرارية، وملفات PDF
              </p>
            </>
          )}
        </div>

        {banner && (
          <div
            className={`mt-4 flex items-center gap-2 rounded-2xl border px-4 py-3 text-xs font-medium sm:text-sm ${
              banner.type === "ok"
                ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
                : banner.type === "warn"
                  ? "border-amber-500/35 bg-amber-500/10 text-amber-200"
                  : "border-rose-500/35 bg-rose-500/10 text-rose-200"
            }`}
          >
            {banner.type === "ok" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0" />
            )}
            <span>{banner.text}</span>
          </div>
        )}
      </section>

      {/* Invoices Table & Filter Controls */}
      <section className="glass-card rounded-3xl p-5 sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { id: "all", label: "الكل", count: tabCounts.all },
                { id: "verified_all", label: "معتمدة / محفوظة", count: tabCounts.verified_all },
                { id: "pending_review", label: "بانتظار التأكيد", count: tabCounts.pending_review },
                { id: "partial_rejected", label: "تتطلب تصحيحًا", count: tabCounts.partial_rejected },
                { id: "pending_ai", label: "بانتظار AI", count: tabCounts.pending_ai },
                { id: "manual", label: "تعديل يدوي", count: tabCounts.manual },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                  statusFilter === tab.id
                    ? "border-indigo-400 bg-indigo-500/20 text-white"
                    : "border-slate-700/80 bg-slate-900/60 text-slate-400 hover:text-white"
                }`}
              >
                <span>{tab.label}</span>
                <span className="rounded-full bg-slate-950/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-300 tabular-nums">
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="تصفية حسب التصنيف"
              className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-xs text-slate-200 focus:border-indigo-400 focus:outline-none"
            >
              <option value="all">كل التصنيفات</option>
              {categoryOptions.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>

            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث بالمورد، رقم الفاتورة، أو الصنف..."
                className="w-60 rounded-xl border border-slate-700 bg-slate-950/80 py-2 pr-9 pl-3 text-xs text-white placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none"
              />
            </div>

            <button
              type="button"
              disabled={refreshingList}
              onClick={() => void refreshInvoices().catch(() => {})}
              title="تحديث القائمة"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-500 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshingList ? "animate-spin" : ""}`} />
              <span>تحديث</span>
            </button>

            <a
              href={`/api/invoices/export?q=${encodeURIComponent(searchQuery)}&status=${encodeURIComponent(statusFilter)}&category=${encodeURIComponent(categoryFilter)}`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/35 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/25"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>تصدير Excel (CSV)</span>
            </a>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-right text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="px-3 py-3 font-semibold">المورد والفاتورة</th>
                <th className="px-3 py-3 font-semibold">التاريخ</th>
                <th className="px-3 py-3 font-semibold">قبل الضريبة / VAT</th>
                <th className="px-3 py-3 font-semibold">الإجمالي النهائي</th>
                <th className="px-3 py-3 font-semibold">الحالة والمصدر</th>
                <th className="px-3 py-3 font-semibold">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-xs text-slate-400">
                    لا توجد فواتير مطابقة للبحث الحالي. ارفع أول فاتورة عربية للبدء!
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((inv) => {
                  const badge = verificationBadge(inv.verification_status);
                  const isAnalyzed = inv.ocr_status === "analyzed";
                  const canAnalyzeNow =
                    aiStatus.enabled && aiStatus.available && inv.ai_analyzable !== false;
                  const isBusy = busyInvoiceId === inv.id;

                  return (
                    <tr key={inv.id} className="transition hover:bg-slate-900/45">
                      <td className="px-3 py-3.5">
                        <div className="flex items-start gap-2.5">
                          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />
                          <div>
                            <p className="font-bold text-white">
                              {inv.vendor_name || "مورد غير محدد بعد"}
                            </p>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[11px] text-slate-400">
                              <span>{inv.file_name}</span>
                              {inv.invoice_number && <span>#{inv.invoice_number}</span>}
                              <span>&bull; {inv.items.length} بنود</span>
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="px-3 py-3.5 font-mono text-xs text-slate-300 tabular-nums">
                        {inv.invoice_date || inv.created_at.slice(0, 10)}
                      </td>

                      <td className="px-3 py-3.5 font-mono text-xs text-slate-300 tabular-nums">
                        <div>{formatMoney(inv.subtotal, inv.currency)}</div>
                        <div className="text-[11px] text-violet-300">
                          ضريبة: {formatMoney(inv.vat_amount, inv.currency)}
                        </div>
                      </td>

                      <td className="px-3 py-3.5 font-mono text-sm font-bold text-white tabular-nums">
                        <div>{formatMoney(inv.grand_total, inv.currency)}</div>
                        <span
                          className={`text-[10px] font-medium ${
                            inv.math_consistent ? "text-emerald-400" : "text-amber-300"
                          }`}
                        >
                          {inv.math_consistent
                            ? "✓ متطابق حسابيًا"
                            : `⚠ فرق ${inv.math_difference.toFixed(2)}`}
                        </span>
                      </td>

                      <td className="px-3 py-3.5">
                        <div className="flex flex-wrap gap-1.5">
                          <span className={`rounded-full border px-2.5 py-0.5 text-[11px] ${badge.cls}`}>
                            {badge.label}
                          </span>
                          {inv.ocr_status === "manual" && (
                            <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-0.5 text-[11px] text-amber-200">
                              تعديل يدوي &bull; Manual
                            </span>
                          )}
                          {inv.ocr_status === "pending_ai" && (
                            <span className="rounded-full border border-slate-600 bg-slate-800 px-2.5 py-0.5 text-[11px] text-slate-300">
                              بانتظار تحليل AI
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-3 py-3.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void openReviewerModal(inv)}
                            className="inline-flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                            title="عرض الفاتورة ومراجعة الأرقام والبنود سطرًا بسطر"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            <span>مراجعة سطر بسطر</span>
                          </button>

                          {!isAnalyzed && (
                            <button
                              type="button"
                              disabled={!canAnalyzeNow || isBusy}
                              onClick={() => void handleRetryAi(inv)}
                              title={
                                canAnalyzeNow
                                  ? `تشغيل تحليل AI (${aiStatus.active_model ?? "Gemini Flash"})`
                                  : !aiStatus.enabled
                                    ? "مفتاح Gemini AI غير مضبوط"
                                    : inv.ai_analyzable === false
                                      ? "صيغة أو حجم الملف غير مدعوم للتحليل"
                                      : "لا يوجد رصيد AI متاح حاليًا — اضغط فحص رصيد AI لاحقًا"
                              }
                              className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-semibold transition ${
                                canAnalyzeNow ? "btn-ai-ready" : "btn-ai-unavailable"
                              }`}
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                              <span>تحليل AI</span>
                            </button>
                          )}

                          {!isAnalyzed && (
                            <button
                              type="button"
                              onClick={() => void openReviewerModal(inv)}
                              className="inline-flex items-center gap-1 rounded-xl border border-amber-500/40 bg-amber-500/15 px-2.5 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/25"
                              title="تعبئة أو تعديل الفاتورة يدويًا"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              <span>يدوي</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              setAssistantFocusInvoiceId(inv.id);
                              setAssistantOpen(true);
                            }}
                            className="inline-flex items-center gap-1 rounded-xl border border-indigo-400/35 bg-indigo-500/15 px-2.5 py-1.5 text-xs font-medium text-indigo-200 hover:bg-indigo-500/25"
                            title="تحدث كتابةً أو صوتيًا مع المساعد حول هذه الفاتورة"
                          >
                            <Mic className="h-3.5 w-3.5" />
                            <span>سؤال AI</span>
                          </button>

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleDownload(inv)}
                            className="inline-flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white"
                            title="تنزيل الملف الأصلي"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleDelete(inv)}
                            className="inline-flex items-center gap-1 rounded-xl border border-rose-500/35 bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
                            title="حذف الفاتورة وملفها"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {reviewingInvoice && (
        <LineByLineReviewer
          invoice={reviewingInvoice}
          previewUrl={previewUrl}
          requireReviewSettingEnabled={settings.require_line_by_line_review}
          onClose={() => {
            setReviewingInvoice(null);
            setPreviewUrl(null);
          }}
          onSaved={(updated) => {
            setInvoices((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
            setReviewingInvoice(null);
            setPreviewUrl(null);
            setBanner({
              type: "ok",
              text: `تم حفظ واعتماد بيانات الفاتورة "${updated.vendor_name ?? updated.file_name}" بنجاح.`,
            });
          }}
        />
      )}

      <InvoiceAiAssistant
        isOpen={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        invoices={invoices}
        focusInvoiceId={validAssistantFocusId}
        onFocusInvoiceChange={(id) => setAssistantFocusInvoiceId(id || null)}
        aiStatus={aiStatus}
        onAiStatusChange={setAiStatus}
        onOpenInvoice={(invId) => {
          const match = invoices.find((item) => item.id === invId);
          if (match) {
            setAssistantOpen(false);
            void openReviewerModal(match);
          }
        }}
      />
    </main>
  );
}
