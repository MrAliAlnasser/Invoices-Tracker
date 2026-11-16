import type { InvoiceRecord } from "@/types/invoice";

export type InvoiceListFilterTab =
  | "all"
  | "verified_all"
  | "verified"
  | "auto_saved"
  | "pending_review"
  | "partial_rejected"
  | "pending_ai"
  | "manual";

export interface InvoiceFilterOptions {
  q?: string | null;
  status?: string | null;
  category?: string | null;
}

export function filterInvoices(
  invoices: InvoiceRecord[],
  options: InvoiceFilterOptions
): InvoiceRecord[] {
  const status = (options.status ?? "all").trim();
  const category = (options.category ?? "").trim();
  const q = (options.q ?? "").trim().toLowerCase();

  return invoices.filter((inv) => {
    if (status === "verified_all") {
      if (inv.verification_status !== "verified" && inv.verification_status !== "auto_saved") {
        return false;
      }
    } else if (status === "verified" || status === "auto_saved" || status === "pending_review" || status === "partial_rejected") {
      if (inv.verification_status !== status) return false;
    } else if (status === "pending_ai") {
      if (inv.ocr_status !== "pending_ai") return false;
    } else if (status === "manual") {
      if (inv.ocr_status !== "manual") return false;
    }

    if (category && category !== "all") {
      if ((inv.category ?? "").trim() !== category) return false;
    }

    if (!q) return true;

    const haystack = [
      inv.vendor_name,
      inv.vendor_tax_number,
      inv.invoice_number,
      inv.file_name,
      inv.category,
      ...inv.items.map((it) => it.item_name),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(q);
  });
}

export function computeFilterTabCounts(
  invoices: InvoiceRecord[]
): Record<InvoiceListFilterTab, number> {
  const counts: Record<InvoiceListFilterTab, number> = {
    all: invoices.length,
    verified_all: 0,
    verified: 0,
    auto_saved: 0,
    pending_review: 0,
    partial_rejected: 0,
    pending_ai: 0,
    manual: 0,
  };

  for (const inv of invoices) {
    if (inv.verification_status === "verified") {
      counts.verified += 1;
      counts.verified_all += 1;
    } else if (inv.verification_status === "auto_saved") {
      counts.auto_saved += 1;
      counts.verified_all += 1;
    } else if (inv.verification_status === "pending_review") {
      counts.pending_review += 1;
    } else if (inv.verification_status === "partial_rejected") {
      counts.partial_rejected += 1;
    }

    if (inv.ocr_status === "pending_ai") counts.pending_ai += 1;
    if (inv.ocr_status === "manual") counts.manual += 1;
  }

  return counts;
}
