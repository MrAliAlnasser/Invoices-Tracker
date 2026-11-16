import { roundCurrency } from "@/lib/invoices/arabic-utils";
import type { InvoiceRecord } from "@/types/invoice";

export interface InvoiceArchiveStats {
  totalInvoices: number;
  verifiedCount: number;
  pendingReviewCount: number;
  partialRejectedCount: number;
  pendingAiCount: number;
  mathIssueCount: number;
  totalSpendByCurrency: Record<string, number>;
  totalVatByCurrency: Record<string, number>;
  topVendors: Array<{ vendor: string; count: number; totalSpend: number; totalVat: number }>;
}

export function buildInvoiceArchiveStats(invoices: InvoiceRecord[]): InvoiceArchiveStats {
  const spendByCurrency: Record<string, number> = {};
  const vatByCurrency: Record<string, number> = {};
  const vendorMap = new Map<
    string,
    { count: number; totalSpend: number; totalVat: number }
  >();

  let verifiedCount = 0;
  let pendingReviewCount = 0;
  let partialRejectedCount = 0;
  let pendingAiCount = 0;
  let mathIssueCount = 0;

  for (const inv of invoices) {
    const cur = inv.currency || "SAR";
    spendByCurrency[cur] = roundCurrency((spendByCurrency[cur] ?? 0) + inv.grand_total);
    vatByCurrency[cur] = roundCurrency((vatByCurrency[cur] ?? 0) + inv.vat_amount);

    if (inv.verification_status === "verified" || inv.verification_status === "auto_saved") {
      verifiedCount += 1;
    } else if (inv.verification_status === "partial_rejected") {
      partialRejectedCount += 1;
    } else {
      pendingReviewCount += 1;
    }

    if (inv.ocr_status === "pending_ai") pendingAiCount += 1;
    if (!inv.math_consistent) mathIssueCount += 1;

    const vendorName = inv.vendor_name?.trim() || "مورد غير محدد";
    const curVendor = vendorMap.get(vendorName) ?? { count: 0, totalSpend: 0, totalVat: 0 };
    curVendor.count += 1;
    curVendor.totalSpend = roundCurrency(curVendor.totalSpend + inv.grand_total);
    curVendor.totalVat = roundCurrency(curVendor.totalVat + inv.vat_amount);
    vendorMap.set(vendorName, curVendor);
  }

  const topVendors = Array.from(vendorMap.entries())
    .map(([vendor, stats]) => ({ vendor, ...stats }))
    .sort((a, b) => b.totalSpend - a.totalSpend)
    .slice(0, 15);

  return {
    totalInvoices: invoices.length,
    verifiedCount,
    pendingReviewCount,
    partialRejectedCount,
    pendingAiCount,
    mathIssueCount,
    totalSpendByCurrency: spendByCurrency,
    totalVatByCurrency: vatByCurrency,
    topVendors,
  };
}

/**
 * Serialize grounded user invoices into a compact structured context string for Gemini Chat.
 * Caps detail payload safely to keep Free Tier token usage crisp and responsive.
 */
export function buildInvoicesChatContext(
  invoices: InvoiceRecord[],
  focusInvoiceId?: string | null,
  maxDetailedInvoices = 50
): { contextText: string; stats: InvoiceArchiveStats; scopedInvoices: InvoiceRecord[] } {
  const scoped = focusInvoiceId
    ? invoices.filter((inv) => inv.id === focusInvoiceId)
    : invoices;

  const stats = buildInvoiceArchiveStats(scoped);
  const limited = scoped.slice(0, maxDetailedInvoices);

  const lines: string[] = [];
  lines.push(
    focusInvoiceId
      ? `النطاق: محادثة مركزة حول فاتورة محددة (${limited[0]?.vendor_name ?? limited[0]?.file_name ?? focusInvoiceId}).`
      : `النطاق: جميع فواتير المشتريات المحفوظة (${stats.totalInvoices} فاتورة إجمالًا، المعروض بالتفصيل أدناه: أحدث ${limited.length}).`
  );
  lines.push(`الإحصائيات الدقيقة المحسوبة برمجيًا (اعتمد عليها حرفيًا): ${JSON.stringify(stats)}`);
  lines.push("تفاصيل الفواتير والبنود:");

  for (const inv of limited) {
    const compactItems = inv.items.slice(0, 40).map((it) => ({
      line: it.line_index + 1,
      name: it.item_name,
      qty: it.quantity,
      unit_price: it.unit_price,
      tax: it.tax_amount,
      total: it.line_total,
      status: it.review_status,
    }));

    lines.push(
      JSON.stringify({
        id: inv.id,
        file_name: inv.file_name,
        vendor: inv.vendor_name,
        tax_id: inv.vendor_tax_number,
        invoice_number: inv.invoice_number,
        date: inv.invoice_date ?? inv.created_at.slice(0, 10),
        currency: inv.currency,
        subtotal: inv.subtotal,
        discount: inv.discount_amount,
        vat: inv.vat_amount,
        grand_total: inv.grand_total,
        category: inv.category,
        notes: inv.notes,
        ocr_status: inv.ocr_status,
        verification_status: inv.verification_status,
        math_consistent: inv.math_consistent,
        math_difference: inv.math_difference,
        items: compactItems,
      })
    );
  }

  return {
    contextText: lines.join("\n"),
    stats,
    scopedInvoices: scoped,
  };
}
