import type { InvoiceRecord } from "@/types/invoice";

/**
 * Convert Eastern Arabic (٠-٩) and Persian (۰-۹) digits plus Arabic decimal/grouping
 * separators into standard ASCII numeric format.
 */
export function normalizeArabicDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (ch) => String(ch.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (ch) => String(ch.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .replace(/[٬،]/g, "");
}

export function roundCurrency(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Parse numbers from numeric values or localized Arabic/currency strings such as "١٬٢٥٠٫٧٥ ر.س".
 */
export function parseFlexibleNumber(value: unknown, fallback = 0, decimals = 2): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? roundCurrency(value, decimals) : fallback;
  }
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = normalizeArabicDigits(value).trim();
  if (!normalized) return fallback;

  const cleaned = normalized.replace(/[^0-9.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") {
    return fallback;
  }
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? roundCurrency(parsed, decimals) : fallback;
}

/**
 * Normalize common invoice date strings (YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY) with Arabic digits.
 */
export function normalizeIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const ascii = normalizeArabicDigits(raw).trim();
  if (!ascii) return null;

  const ymd = ascii.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymd) {
    const [, y, m, d] = ymd;
    const candidate = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    return isValidCalendarDate(candidate) ? candidate : null;
  }

  const dmy = ascii.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const candidate = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    return isValidCalendarDate(candidate) ? candidate : null;
  }

  return null;
}

function isValidCalendarDate(isoDate: string): boolean {
  const [yStr, mStr, dStr] = isoDate.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function sanitizeStorageFilename(rawName: string): string {
  const base = rawName.split(/[/\\]/).pop()?.trim() ?? "";
  const cleaned = base
    .replace(/[^\w.\-\u0600-\u06FF ]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^[._]+|[._]+$/g, "");
  if (!cleaned || /^\.+$/.test(cleaned)) {
    return "invoice.bin";
  }
  return cleaned.slice(0, 140);
}

export function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function invoicesToCsvWithBom(invoices: InvoiceRecord[]): string {
  const headers = [
    "رقم الفاتورة",
    "المورد",
    "الرقم الضريبي",
    "تاريخ الفاتورة",
    "العملة",
    "المجموع قبل الضريبة",
    "الخصم",
    "ضريبة القيمة المضافة VAT",
    "الإجمالي النهائي",
    "التطابق الرياضي",
    "حالة المراجعة",
    "حالة التحليل",
    "نموذج الذكاء الاصطناعي",
    "اسم الملف",
    "تاريخ الرفع",
  ];

  const rows = invoices.map((inv) =>
    [
      inv.invoice_number ?? "",
      inv.vendor_name ?? "",
      inv.vendor_tax_number ?? "",
      inv.invoice_date ?? "",
      inv.currency,
      inv.subtotal.toFixed(2),
      inv.discount_amount.toFixed(2),
      inv.vat_amount.toFixed(2),
      inv.grand_total.toFixed(2),
      inv.math_consistent ? "متطابق" : `فرق ${inv.math_difference.toFixed(2)}`,
      inv.verification_status,
      inv.ocr_status,
      inv.ai_model ?? inv.processing_mode,
      inv.file_name,
      inv.created_at,
    ]
      .map(csvEscape)
      .join(",")
  );

  return `\uFEFF${[headers.map(csvEscape).join(","), ...rows].join("\r\n")}`;
}
