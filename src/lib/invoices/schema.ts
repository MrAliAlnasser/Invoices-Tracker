import { z } from "zod";
import { normalizeArabicDigits, normalizeIsoDate, parseFlexibleNumber, roundCurrency } from "./arabic-utils";

const FlexibleNumber = z.union([z.number(), z.string()]).transform((val) => parseFlexibleNumber(val, 0, 2));
const FlexibleQty = z.union([z.number(), z.string()]).transform((val) => parseFlexibleNumber(val, 1, 3));

export const ExtractedInvoiceItemSchema = z.object({
  item_name: z.string().trim().min(1).default("صنف غير مسمى"),
  quantity: FlexibleQty.default(1),
  unit_price: FlexibleNumber.default(0),
  tax_amount: FlexibleNumber.default(0),
  line_total: FlexibleNumber.default(0),
});

export const ArabicInvoiceExtractionSchema = z.object({
  vendor_name: z.string().trim().nullable().optional().default(null),
  vendor_tax_number: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v) => (v ? normalizeArabicDigits(v).replace(/\s+/g, "") : null))
    .default(null),
  invoice_number: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v) => (v ? normalizeArabicDigits(v) : null))
    .default(null),
  invoice_date: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v) => normalizeIsoDate(v))
    .default(null),
  currency: z.string().trim().min(2).max(10).default("SAR"),
  subtotal: FlexibleNumber.default(0),
  discount_amount: FlexibleNumber.default(0),
  vat_amount: FlexibleNumber.default(0),
  grand_total: FlexibleNumber.default(0),
  category: z.string().trim().nullable().optional().default("مشتريات عامة"),
  notes: z.string().trim().nullable().optional().default(null),
  raw_extracted_text: z.string().trim().nullable().optional().default(null),
  items: z.array(ExtractedInvoiceItemSchema).default([]),
});

export type ArabicInvoiceExtraction = z.infer<typeof ArabicInvoiceExtractionSchema>;

export const ReviewStatusSchema = z.enum(["pending", "approved", "edited", "rejected"]);

export const FieldApprovalsSchema = z
  .object({
    vendor_name: ReviewStatusSchema.optional(),
    vendor_tax_number: ReviewStatusSchema.optional(),
    invoice_number: ReviewStatusSchema.optional(),
    invoice_date: ReviewStatusSchema.optional(),
    subtotal: ReviewStatusSchema.optional(),
    discount_amount: ReviewStatusSchema.optional(),
    vat_amount: ReviewStatusSchema.optional(),
    grand_total: ReviewStatusSchema.optional(),
  })
  .default({});

export const VerifyInvoicePayloadSchema = z.object({
  vendor_name: z.string().trim().nullable(),
  vendor_tax_number: z
    .string()
    .trim()
    .nullable()
    .transform((v) => (v ? normalizeArabicDigits(v).replace(/\s+/g, "") : null)),
  invoice_number: z
    .string()
    .trim()
    .nullable()
    .transform((v) => (v ? normalizeArabicDigits(v) : null)),
  invoice_date: z
    .string()
    .trim()
    .nullable()
    .transform((v) => normalizeIsoDate(v)),
  currency: z.string().trim().min(2).max(10).default("SAR"),
  subtotal: FlexibleNumber,
  discount_amount: FlexibleNumber,
  vat_amount: FlexibleNumber,
  grand_total: FlexibleNumber,
  category: z.string().trim().nullable().optional().default(null),
  notes: z.string().trim().nullable().optional().default(null),
  field_approvals: FieldApprovalsSchema,
  recalculate_totals_from_items: z.boolean().optional().default(false),
  mark_as_manual: z.boolean().optional().default(false),
  items: z
    .array(
      z.object({
        id: z.string().optional(),
        line_index: z.number().int().min(0),
        item_name: z.string().trim().min(1),
        quantity: FlexibleQty,
        unit_price: FlexibleNumber,
        tax_amount: FlexibleNumber,
        line_total: FlexibleNumber,
        review_status: ReviewStatusSchema,
        review_note: z.string().trim().nullable().optional().default(null),
      })
    )
    .default([]),
});

export const SettingsUpdateSchema = z.object({
  require_line_by_line_review: z.boolean().optional(),
  default_currency: z.string().trim().min(2).max(10).optional(),
  auto_delete_days: z.number().int().min(1).max(3650).nullable().optional(),
});

export const UploadSignRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(180),
  mimeType: z.string().trim().min(1).max(120),
  fileSize: z.number().int().positive(),
});

export interface MathReconciliationResult {
  consistent: boolean;
  difference: number;
  itemsSum: number;
  expectedGrandTotal: number;
  issues: string[];
}

const MATH_TOLERANCE = 0.05;

export function reconcileInvoiceMath(input: {
  subtotal: number;
  discount_amount: number;
  vat_amount: number;
  grand_total: number;
  items: Array<{ quantity: number; unit_price: number; line_total: number; review_status?: string }>;
}): MathReconciliationResult {
  const issues: string[] = [];
  const activeItems = input.items.filter((it) => it.review_status !== "rejected");
  const itemsSum = roundCurrency(
    activeItems.reduce((acc, item) => acc + (Number.isFinite(item.line_total) ? item.line_total : 0), 0)
  );

  for (let i = 0; i < activeItems.length; i += 1) {
    const it = activeItems[i];
    const expectedLine = roundCurrency(it.quantity * it.unit_price);
    // Allow either pre-tax or tax-inclusive item line_total as long as within small rounding tolerance
    const diff = Math.abs(expectedLine - it.line_total);
    if (it.quantity > 0 && it.unit_price > 0 && diff > 1.0 && Math.abs(expectedLine * 1.15 - it.line_total) > 1.0) {
      issues.push(
        `السطر رقم ${i + 1}: حاصل الكمية × السعر (${expectedLine.toFixed(2)}) لا يطابق إجمالي السطر (${it.line_total.toFixed(2)}).`
      );
    }
  }

  const effectiveSubtotal = input.subtotal > 0 ? input.subtotal : itemsSum;
  if (activeItems.length > 0 && input.subtotal > 0) {
    const subVsItems = Math.abs(itemsSum - input.subtotal);
    const vatInclusiveSubVsItems = Math.abs(itemsSum - input.grand_total);
    if (subVsItems > MATH_TOLERANCE && vatInclusiveSubVsItems > MATH_TOLERANCE) {
      issues.push(
        `مجموع البنود (${itemsSum.toFixed(2)}) يختلف عن المجموع قبل الضريبة (${input.subtotal.toFixed(2)}).`
      );
    }
  }

  const expectedGrandTotal = roundCurrency(effectiveSubtotal - input.discount_amount + input.vat_amount);
  const totalDiff = roundCurrency(Math.abs(expectedGrandTotal - input.grand_total));
  if (input.grand_total > 0 && totalDiff > MATH_TOLERANCE && Math.abs(itemsSum - input.grand_total) > MATH_TOLERANCE) {
    issues.push(
      `الحساب المتوقع (${expectedGrandTotal.toFixed(2)}) يختلف عن الإجمالي النهائي المستخرج (${input.grand_total.toFixed(2)}) بفارق ${totalDiff.toFixed(2)}.`
    );
  }

  return {
    consistent: issues.length === 0,
    difference: totalDiff,
    itemsSum,
    expectedGrandTotal,
    issues,
  };
}
