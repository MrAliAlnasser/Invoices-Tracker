"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Calculator,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Pencil,
  RotateCw,
  Settings,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type {
  FieldApprovalsMap,
  InvoiceHeaderFieldKey,
  InvoiceRecord,
  ItemReviewStatus,
} from "@/types/invoice";
import { normalizeArabicDigits, roundCurrency } from "@/lib/invoices/arabic-utils";
import { reconcileInvoiceMath } from "@/lib/invoices/schema";

interface LineByLineReviewerProps {
  invoice: InvoiceRecord;
  previewUrl: string | null;
  requireReviewSettingEnabled: boolean;
  onSaved: (updated: InvoiceRecord) => void;
  onClose: () => void;
}

interface EditableItem {
  id?: string;
  line_index: number;
  item_name: string;
  quantity: number;
  unit_price: number;
  tax_amount: number;
  line_total: number;
  review_status: ItemReviewStatus;
  review_note: string | null;
}

interface HeaderState {
  vendor_name: string;
  vendor_tax_number: string;
  invoice_number: string;
  invoice_date: string;
  currency: string;
  subtotal: number;
  discount_amount: number;
  vat_amount: number;
  grand_total: number;
  category: string;
  notes: string;
}

const HEADER_FIELD_DEFS: Array<{
  key: InvoiceHeaderFieldKey;
  label: string;
  type: "text" | "date" | "money";
}> = [
  { key: "vendor_name", label: "اسم المورد / المتجر", type: "text" },
  { key: "vendor_tax_number", label: "الرقم الضريبي للمورد", type: "text" },
  { key: "invoice_number", label: "رقم الفاتورة", type: "text" },
  { key: "invoice_date", label: "تاريخ الفاتورة", type: "date" },
  { key: "subtotal", label: "المجموع قبل الضريبة", type: "money" },
  { key: "discount_amount", label: "الخصم", type: "money" },
  { key: "vat_amount", label: "ضريبة القيمة المضافة VAT", type: "money" },
  { key: "grand_total", label: "الإجمالي النهائي", type: "money" },
];

function statusBadgeMeta(status: ItemReviewStatus) {
  switch (status) {
    case "approved":
      return {
        label: "موافق",
        cls: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
      };
    case "edited":
      return {
        label: "معدّل",
        cls: "border-amber-500/40 bg-amber-500/15 text-amber-300",
      };
    case "rejected":
      return {
        label: "مرفوض",
        cls: "border-rose-500/40 bg-rose-500/15 text-rose-300",
      };
    default:
      return {
        label: "بانتظار التأكيد",
        cls: "border-slate-600 bg-slate-800/80 text-slate-300",
      };
  }
}

export function LineByLineReviewer({
  invoice,
  previewUrl,
  requireReviewSettingEnabled,
  onSaved,
  onClose,
}: LineByLineReviewerProps) {
  const [header, setHeader] = useState<HeaderState>({
    vendor_name: invoice.vendor_name ?? "",
    vendor_tax_number: invoice.vendor_tax_number ?? "",
    invoice_number: invoice.invoice_number ?? "",
    invoice_date: invoice.invoice_date ?? "",
    currency: invoice.currency || "SAR",
    subtotal: invoice.subtotal ?? 0,
    discount_amount: invoice.discount_amount ?? 0,
    vat_amount: invoice.vat_amount ?? 0,
    grand_total: invoice.grand_total ?? 0,
    category: invoice.category ?? "مشتريات عامة",
    notes: invoice.notes ?? "",
  });

  const [approvals, setApprovals] = useState<FieldApprovalsMap>(() => ({
    ...invoice.field_approvals,
  }));

  const [items, setItems] = useState<EditableItem[]>(() =>
    invoice.items.map((it, idx) => ({
      id: it.id,
      line_index: it.line_index ?? idx,
      item_name: it.item_name,
      quantity: it.quantity,
      unit_price: it.unit_price,
      tax_amount: it.tax_amount,
      line_total: it.line_total,
      review_status: it.review_status ?? "pending",
      review_note: it.review_note ?? null,
    }))
  );

  // Combined sequential index: 0..7 -> header fields, 8.. -> invoice line items
  const totalSteps = HEADER_FIELD_DEFS.length + items.length;
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [addingItem, setAddingItem] = useState(false);

  // Preview visual controls
  const [zoom, setZoom] = useState<number>(100);
  const [rotation, setRotation] = useState<number>(0);

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const mathCheck = useMemo(
    () =>
      reconcileInvoiceMath({
        subtotal: header.subtotal,
        discount_amount: header.discount_amount,
        vat_amount: header.vat_amount,
        grand_total: header.grand_total,
        items,
      }),
    [header.subtotal, header.discount_amount, header.vat_amount, header.grand_total, items]
  );

  const reviewedCount = useMemo(() => {
    const hCount = HEADER_FIELD_DEFS.filter((def) => {
      const st = approvals[def.key];
      return st && st !== "pending";
    }).length;
    const iCount = items.filter((it) => it.review_status !== "pending").length;
    return hCount + iCount;
  }, [approvals, items]);

  const advanceFrom = useCallback(
    (currentIdx: number) => {
      setEditingIndex(null);
      if (currentIdx + 1 < totalSteps) {
        setActiveIndex(currentIdx + 1);
      }
    },
    [totalSteps]
  );

  const handleHeaderDecision = useCallback(
    (key: InvoiceHeaderFieldKey, status: ItemReviewStatus, idx: number) => {
      setApprovals((prev) => ({ ...prev, [key]: status }));
      advanceFrom(idx);
    },
    [advanceFrom]
  );

  const handleItemDecision = useCallback(
    (itemIdx: number, status: ItemReviewStatus, stepIdx: number) => {
      setItems((prev) =>
        prev.map((it, idx) => (idx === itemIdx ? { ...it, review_status: status } : it))
      );
      advanceFrom(stepIdx);
    },
    [advanceFrom]
  );

  const handleRecalculateFromItems = () => {
    const activeItems = items.filter((it) => it.review_status !== "rejected");
    const newSub = roundCurrency(
      activeItems.reduce((sum, it) => sum + (Number.isFinite(it.line_total) ? it.line_total : 0), 0)
    );
    const itemsTax = roundCurrency(
      activeItems.reduce((sum, it) => sum + (Number.isFinite(it.tax_amount) ? it.tax_amount : 0), 0)
    );
    const nextVat = itemsTax > 0 ? itemsTax : header.vat_amount;
    const nextGrand = roundCurrency(newSub - header.discount_amount + nextVat);
    setHeader((prev) => ({
      ...prev,
      subtotal: newSub,
      vat_amount: nextVat,
      grand_total: nextGrand,
    }));
    setApprovals((prev) => ({
      ...prev,
      subtotal: "edited",
      vat_amount: itemsTax > 0 ? "edited" : prev.vat_amount,
      grand_total: "edited",
    }));
  };

  const handleAddLineItem = () => {
    const nextIdx = items.length;
    setItems((prev) => [
      ...prev,
      {
        line_index: nextIdx,
        item_name: "بند جديد",
        quantity: 1,
        unit_price: 0,
        tax_amount: 0,
        line_total: 0,
        review_status: "edited",
        review_note: null,
      },
    ]);
    const newStepIdx = HEADER_FIELD_DEFS.length + nextIdx;
    setActiveIndex(newStepIdx);
    setEditingIndex(newStepIdx);
    setAddingItem(false);
  };

  const submitVerification = async (approveRemaining: boolean) => {
    setSaveError(null);
    setSaving(true);

    const finalApprovals: FieldApprovalsMap = { ...approvals };
    const finalItems = items.map((it, idx) => ({
      ...it,
      line_index: idx,
      review_status:
        approveRemaining && it.review_status === "pending" ? "approved" : it.review_status,
    }));

    if (approveRemaining) {
      for (const def of HEADER_FIELD_DEFS) {
        if (!finalApprovals[def.key] || finalApprovals[def.key] === "pending") {
          finalApprovals[def.key] = "approved";
        }
      }
    }

    try {
      const resp = await fetch(`/api/invoices/${invoice.id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendor_name: header.vendor_name.trim() || null,
          vendor_tax_number: header.vendor_tax_number.trim() || null,
          invoice_number: header.invoice_number.trim() || null,
          invoice_date: header.invoice_date.trim() || null,
          currency: header.currency.trim() || "SAR",
          subtotal: header.subtotal,
          discount_amount: header.discount_amount,
          vat_amount: header.vat_amount,
          grand_total: header.grand_total,
          category: header.category.trim() || null,
          notes: header.notes.trim() || null,
          field_approvals: finalApprovals,
          mark_as_manual: invoice.ocr_status === "pending_ai" || invoice.ocr_status === "manual",
          items: finalItems,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || "تعذر حفظ اعتماد الفاتورة.");
      }
      onSaved(data.invoice);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "حدث خطأ غير متوقع أثناء الحفظ.");
    } finally {
      setSaving(false);
    }
  };

  // Keyboard shortcuts when not actively typing inside an input
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT";
      if (e.key === "Escape") {
        if (editingIndex !== null) {
          setEditingIndex(null);
        } else {
          onClose();
        }
        return;
      }
      if (isTyping || editingIndex !== null) return;

      if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(totalSteps - 1, prev + 1));
      } else if (e.key === "ArrowUp" || e.key === "ArrowRight") {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (activeIndex < HEADER_FIELD_DEFS.length) {
          handleHeaderDecision(HEADER_FIELD_DEFS[activeIndex].key, "approved", activeIndex);
        } else {
          const itemIdx = activeIndex - HEADER_FIELD_DEFS.length;
          if (items[itemIdx]) handleItemDecision(itemIdx, "approved", activeIndex);
        }
      } else if (e.key.toLowerCase() === "e") {
        e.preventDefault();
        setEditingIndex(activeIndex);
      } else if (e.key.toLowerCase() === "x") {
        e.preventDefault();
        if (activeIndex < HEADER_FIELD_DEFS.length) {
          handleHeaderDecision(HEADER_FIELD_DEFS[activeIndex].key, "rejected", activeIndex);
        } else {
          const itemIdx = activeIndex - HEADER_FIELD_DEFS.length;
          if (items[itemIdx]) handleItemDecision(itemIdx, "rejected", activeIndex);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeIndex,
    editingIndex,
    handleHeaderDecision,
    handleItemDecision,
    items,
    onClose,
    totalSteps,
  ]);

  const isPdf = (invoice.mime_type ?? "").toLowerCase().includes("pdf") ||
    invoice.file_name.toLowerCase().endsWith(".pdf");

  const progressPct = totalSteps > 0 ? Math.round((reviewedCount / totalSteps) * 100) : 100;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-md sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label="مراجعة وتأكيد بيانات الفاتورة سطرًا بسطر"
    >
      <div className="glass-card flex h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-3xl border border-slate-700/60">
        {/* Top Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/90 bg-slate-900/70 px-5 py-3.5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-indigo-400/40 bg-indigo-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-200">
                مراجعة سطر بسطر
              </span>
              <span className="font-mono text-xs text-slate-400">{invoice.file_name}</span>
            </div>
            <h2 className="mt-1 text-base font-bold text-white sm:text-lg">
              تأكيد الأرقام والبيانات المستخرجة من الفاتورة
            </h2>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden text-left sm:block">
              <p className="text-xs text-slate-300">
                تمت مراجعة{" "}
                <span className="font-mono font-bold text-indigo-300 tabular-nums">
                  {reviewedCount} / {totalSteps}
                </span>{" "}
                سطر
              </p>
              <div className="mt-1 h-1.5 w-36 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-l from-blue-500 via-indigo-500 to-violet-500 transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق نافذة المراجعة"
              className="rounded-xl border border-slate-700 bg-slate-800/80 p-2 text-slate-300 transition hover:bg-slate-700 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Split Body: Preview + Sequential Checklist */}
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-12">
          {/* Invoice Visual Preview Pane */}
          <div className="flex min-h-[260px] flex-col border-b border-slate-800/90 bg-slate-950/60 lg:col-span-5 lg:border-b-0 lg:border-l">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 px-4 py-2.5">
              <span className="text-xs font-semibold text-slate-300">معاينة الفاتورة الأصلية</span>
              <div className="flex items-center gap-1.5">
                {!isPdf && (
                  <>
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.max(60, z - 20))}
                      className="rounded-lg border border-slate-700/80 bg-slate-900 p-1.5 text-slate-300 hover:text-white"
                      title="تصغير"
                    >
                      <ZoomOut className="h-3.5 w-3.5" />
                    </button>
                    <span className="min-w-[44px] text-center font-mono text-[11px] text-slate-400">
                      {zoom}%
                    </span>
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.min(240, z + 20))}
                      className="rounded-lg border border-slate-700/80 bg-slate-900 p-1.5 text-slate-300 hover:text-white"
                      title="تكبير"
                    >
                      <ZoomIn className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setRotation((r) => (r + 90) % 360)}
                      className="rounded-lg border border-slate-700/80 bg-slate-900 p-1.5 text-slate-300 hover:text-white"
                      title="تدوير 90 درجة"
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
                {previewUrl && (
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-700/80 bg-slate-900 px-2 py-1 text-[11px] text-slate-300 hover:text-white"
                  >
                    <ExternalLink className="h-3 w-3" />
                    <span>فتح</span>
                  </a>
                )}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
              {!previewUrl ? (
                <p className="text-xs text-slate-400">جاري تحميل معاينة الملف...</p>
              ) : isPdf ? (
                <iframe
                  src={previewUrl}
                  title="معاينة ملف PDF"
                  className="h-full min-h-[300px] w-full rounded-xl border border-slate-800 bg-white"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt={invoice.file_name}
                  style={{
                    transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
                    transformOrigin: "center center",
                  }}
                  className="max-h-full max-w-full rounded-lg object-contain transition-transform duration-150"
                />
              )}
            </div>
          </div>

          {/* Line-by-Line Stepper Checklist */}
          <div className="flex min-h-0 flex-col lg:col-span-7">
            {/* Math Validation Banner */}
            <div className="border-b border-slate-800/80 bg-slate-900/40 px-4 py-3">
              {mathCheck.consistent ? (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                    <span>التدقيق الحسابي متطابق: مجموع البنود والضريبة يطابق الإجمالي النهائي.</span>
                  </div>
                  <span className="font-mono text-[11px] text-emerald-300">OK</span>
                </div>
              ) : (
                <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-100">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-semibold text-amber-200">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                      <span>تنبيه تطابق الأرقام المستخرجة:</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleRecalculateFromItems}
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-400/40 bg-amber-500/20 px-2.5 py-1 text-[11px] font-medium text-amber-100 hover:bg-amber-500/30"
                    >
                      <Calculator className="h-3 w-3" />
                      <span>إعادة حساب الإجمالي من البنود</span>
                    </button>
                  </div>
                  <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-[11px] text-amber-200/90">
                    {mathCheck.issues.map((msg, i) => (
                      <li key={i}>{msg}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Quick Stepper Navigation */}
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
                    disabled={activeIndex === 0}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-slate-300 hover:text-white disabled:opacity-40"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                    <span>السطر السابق</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveIndex((i) => Math.min(totalSteps - 1, i + 1))}
                    disabled={activeIndex >= totalSteps - 1}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-slate-300 hover:text-white disabled:opacity-40"
                  >
                    <span>السطر التالي</span>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                </div>
                <span className="hidden sm:inline">
                  اختصارات: <kbd className="rounded bg-slate-800 px-1.5 py-0.5">Enter</kbd> موافق •{" "}
                  <kbd className="rounded bg-slate-800 px-1.5 py-0.5">E</kbd> تعديل •{" "}
                  <kbd className="rounded bg-slate-800 px-1.5 py-0.5">X</kbd> غير صحيح
                </span>
              </div>
            </div>

            {/* Scrollable Line-by-Line Rows */}
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
              {/* Section 1: Header & Financial Totals */}
              <div>
                <h3 className="mb-2.5 text-xs font-semibold tracking-wide text-slate-400">
                  1. البيانات الأساسية والأرقام الإجمالية ({HEADER_FIELD_DEFS.length} أسطر)
                </h3>
                <div className="space-y-2">
                  {HEADER_FIELD_DEFS.map((def, idx) => {
                    const isActive = activeIndex === idx;
                    const isEditing = editingIndex === idx;
                    const st: ItemReviewStatus = approvals[def.key] ?? "pending";
                    const meta = statusBadgeMeta(st);
                    const rawVal = header[def.key];

                    return (
                      <div
                        key={def.key}
                        onClick={() => setActiveIndex(idx)}
                        className={`cursor-pointer rounded-2xl border p-3 transition ${
                          isActive
                            ? "border-indigo-400/70 bg-indigo-500/10 shadow-[0_0_0_1px_rgba(129,140,248,0.35)]"
                            : "border-slate-800 bg-slate-900/45 hover:border-slate-700"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 font-mono text-[11px] text-slate-300">
                              {idx + 1}
                            </span>
                            <span className="text-xs font-medium text-slate-300">{def.label}</span>
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] ${meta.cls}`}>
                              {meta.label}
                            </span>
                          </div>

                          <div
                            className="flex items-center gap-1.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => handleHeaderDecision(def.key, "approved", idx)}
                              className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-200 hover:bg-emerald-500/25"
                            >
                              <Check className="h-3.5 w-3.5" />
                              <span>موافق</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveIndex(idx);
                                setEditingIndex(isEditing ? null : idx);
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-200 hover:bg-amber-500/25"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              <span>تعديل</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleHeaderDecision(def.key, "rejected", idx)}
                              className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/15 px-2.5 py-1 text-xs font-medium text-rose-200 hover:bg-rose-500/25"
                            >
                              <X className="h-3.5 w-3.5" />
                              <span>غير صحيح</span>
                            </button>
                          </div>
                        </div>

                        <div className="mt-2 pr-8" onClick={(e) => e.stopPropagation()}>
                          {isEditing ? (
                            <div className="flex flex-wrap items-center gap-2">
                              {def.type === "money" ? (
                                <input
                                  type="number"
                                  step="0.01"
                                  value={Number(rawVal)}
                                  onChange={(e) =>
                                    setHeader((prev) => ({
                                      ...prev,
                                      [def.key]: roundCurrency(Number.parseFloat(e.target.value) || 0),
                                    }))
                                  }
                                  className="w-44 rounded-lg border border-indigo-400/60 bg-slate-950 px-3 py-1.5 font-mono text-sm text-white focus:outline-none"
                                  autoFocus
                                />
                              ) : (
                                <input
                                  type={def.type === "date" ? "date" : "text"}
                                  value={String(rawVal)}
                                  onChange={(e) =>
                                    setHeader((prev) => ({
                                      ...prev,
                                      [def.key]: normalizeArabicDigits(e.target.value),
                                    }))
                                  }
                                  className="min-w-[220px] flex-1 rounded-lg border border-indigo-400/60 bg-slate-950 px-3 py-1.5 text-sm text-white focus:outline-none"
                                  autoFocus
                                />
                              )}
                              <button
                                type="button"
                                onClick={() => handleHeaderDecision(def.key, "edited", idx)}
                                className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-400"
                              >
                                حفظ التعديل والتالي
                              </button>
                            </div>
                          ) : (
                            <p
                              className={`text-sm font-semibold ${
                                def.type === "money" ? "font-mono text-base text-white tabular-nums" : "text-white"
                              }`}
                            >
                              {def.type === "money"
                                ? `${Number(rawVal).toFixed(2)} ${header.currency}`
                                : String(rawVal || "غير متوفر")}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Section 2: Invoice Line Items */}
              <div>
                <div className="mb-2.5 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold tracking-wide text-slate-400">
                    2. بنود ومشتريات الفاتورة سطرًا بسطر ({items.length} أصناف)
                  </h3>
                  <button
                    type="button"
                    disabled={addingItem}
                    onClick={handleAddLineItem}
                    className="rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700"
                  >
                    + إضافة سطر بند
                  </button>
                </div>

                {items.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-4 text-center text-xs text-slate-400">
                    لم يتم رصد بنود مفصلة في الفاتورة (يمكنك إضافة سطر يدويًا أو الاكتفاء بتأكيد الأرقام الإجمالية).
                  </div>
                ) : (
                  <div className="space-y-2">
                    {items.map((item, itemIdx) => {
                      const stepIdx = HEADER_FIELD_DEFS.length + itemIdx;
                      const isActive = activeIndex === stepIdx;
                      const isEditing = editingIndex === stepIdx;
                      const meta = statusBadgeMeta(item.review_status);

                      return (
                        <div
                          key={`${item.id ?? "new"}-${itemIdx}`}
                          onClick={() => setActiveIndex(stepIdx)}
                          className={`cursor-pointer rounded-2xl border p-3 transition ${
                            isActive
                              ? "border-indigo-400/70 bg-indigo-500/10 shadow-[0_0_0_1px_rgba(129,140,248,0.35)]"
                              : "border-slate-800 bg-slate-900/45 hover:border-slate-700"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 font-mono text-[11px] text-slate-300">
                                {stepIdx + 1}
                              </span>
                              <span className="text-sm font-semibold text-white">
                                {item.item_name}
                              </span>
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] ${meta.cls}`}>
                                {meta.label}
                              </span>
                            </div>

                            <div
                              className="flex items-center gap-1.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => handleItemDecision(itemIdx, "approved", stepIdx)}
                                className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-200 hover:bg-emerald-500/25"
                              >
                                <Check className="h-3.5 w-3.5" />
                                <span>موافق</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveIndex(stepIdx);
                                  setEditingIndex(isEditing ? null : stepIdx);
                                }}
                                className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-200 hover:bg-amber-500/25"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                <span>تعديل</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleItemDecision(itemIdx, "rejected", stepIdx)}
                                className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/15 px-2.5 py-1 text-xs font-medium text-rose-200 hover:bg-rose-500/25"
                              >
                                <X className="h-3.5 w-3.5" />
                                <span>غير صحيح</span>
                              </button>
                            </div>
                          </div>

                          <div className="mt-2 pr-8" onClick={(e) => e.stopPropagation()}>
                            {isEditing ? (
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                                <input
                                  type="text"
                                  value={item.item_name}
                                  onChange={(e) =>
                                    setItems((prev) =>
                                      prev.map((it, i) =>
                                        i === itemIdx ? { ...it, item_name: e.target.value } : it
                                      )
                                    )
                                  }
                                  placeholder="اسم الصنف"
                                  className="rounded-lg border border-indigo-400/60 bg-slate-950 px-2.5 py-1.5 text-xs text-white sm:col-span-5"
                                />
                                <input
                                  type="number"
                                  step="0.001"
                                  value={item.quantity}
                                  onChange={(e) => {
                                    const qty = Number.parseFloat(e.target.value) || 0;
                                    setItems((prev) =>
                                      prev.map((it, i) =>
                                        i === itemIdx
                                          ? {
                                              ...it,
                                              quantity: qty,
                                              line_total: roundCurrency(qty * it.unit_price + it.tax_amount),
                                            }
                                          : it
                                      )
                                    );
                                  }}
                                  placeholder="الكمية"
                                  className="rounded-lg border border-indigo-400/60 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-white sm:col-span-2"
                                />
                                <input
                                  type="number"
                                  step="0.01"
                                  value={item.unit_price}
                                  onChange={(e) => {
                                    const price = Number.parseFloat(e.target.value) || 0;
                                    setItems((prev) =>
                                      prev.map((it, i) =>
                                        i === itemIdx
                                          ? {
                                              ...it,
                                              unit_price: price,
                                              line_total: roundCurrency(it.quantity * price + it.tax_amount),
                                            }
                                          : it
                                      )
                                    );
                                  }}
                                  placeholder="سعر الوحدة"
                                  className="rounded-lg border border-indigo-400/60 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-white sm:col-span-2"
                                />
                                <input
                                  type="number"
                                  step="0.01"
                                  value={item.line_total}
                                  onChange={(e) => {
                                    const total = roundCurrency(Number.parseFloat(e.target.value) || 0);
                                    setItems((prev) =>
                                      prev.map((it, i) =>
                                        i === itemIdx ? { ...it, line_total: total } : it
                                      )
                                    );
                                  }}
                                  placeholder="الإجمالي"
                                  className="rounded-lg border border-indigo-400/60 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-white sm:col-span-3"
                                />
                                <div className="flex justify-end sm:col-span-12">
                                  <button
                                    type="button"
                                    onClick={() => handleItemDecision(itemIdx, "edited", stepIdx)}
                                    className="rounded-lg bg-indigo-500 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-400"
                                  >
                                    حفظ البند والانتقال للتالي
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex flex-wrap items-center gap-4 font-mono text-xs text-slate-300 tabular-nums">
                                <span>الكمية: {item.quantity}</span>
                                <span>سعر الوحدة: {item.unit_price.toFixed(2)}</span>
                                {item.tax_amount > 0 && <span>ضريبة: {item.tax_amount.toFixed(2)}</span>}
                                <span className="font-bold text-indigo-200">
                                  الإجمالي: {item.line_total.toFixed(2)} {header.currency}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-800/90 bg-slate-900/75 px-5 py-3">
          {saveError && (
            <p className="mb-2 text-xs font-medium text-rose-300">{saveError}</p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Settings className="h-3.5 w-3.5 text-slate-400" />
              <span>
                نافذة التأكيد سطرًا بسطر:{" "}
                <strong className="text-slate-200">
                  {requireReviewSettingEnabled ? "مفعّلة عند الرفع" : "معطّلة"}
                </strong>{" "}
                — يمكنك تعديلها من{" "}
                <Link href="/settings" className="text-indigo-300 underline hover:text-indigo-200">
                  الإعدادات
                </Link>
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-white"
              >
                إلغاء / لاحقًا
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => submitVerification(false)}
                className="rounded-xl border border-indigo-400/40 bg-indigo-500/20 px-4 py-2 text-xs font-semibold text-indigo-100 hover:bg-indigo-500/30 disabled:opacity-50"
              >
                حفظ المراجعة الحالية
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => submitVerification(true)}
                className="btn-ai-ready inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-50"
              >
                <CheckCheck className="h-4 w-4" />
                <span>{saving ? "جاري الحفظ..." : "اعتماد الكل وحفظ الفاتورة"}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
