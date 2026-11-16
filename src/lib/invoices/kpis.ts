import type { DashboardKpis, InvoiceRecord } from "@/types/invoice";
import { roundCurrency } from "./arabic-utils";

export function computeDashboardKpis(invoices: InvoiceRecord[]): DashboardKpis {
  let verifiedCount = 0;
  let pendingReviewCount = 0;
  let pendingAiCount = 0;
  let totalSpend = 0;
  let totalVat = 0;

  for (const inv of invoices) {
    if (inv.verification_status === "verified" || inv.verification_status === "auto_saved") {
      verifiedCount += 1;
    } else {
      pendingReviewCount += 1;
    }
    if (inv.ocr_status === "pending_ai") {
      pendingAiCount += 1;
    }
    totalSpend += Number.isFinite(inv.grand_total) ? inv.grand_total : 0;
    totalVat += Number.isFinite(inv.vat_amount) ? inv.vat_amount : 0;
  }

  return {
    total_invoices: invoices.length,
    verified_count: verifiedCount,
    pending_review_count: pendingReviewCount,
    pending_ai_count: pendingAiCount,
    total_spend: roundCurrency(totalSpend),
    total_vat: roundCurrency(totalVat),
  };
}

export function formatMoney(amount: number, currency = "SAR"): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `${safe.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}
