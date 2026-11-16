export type OcrStatus = "analyzed" | "pending_ai" | "manual" | "unsupported";

export type VerificationStatus =
  | "pending_review"
  | "verified"
  | "partial_rejected"
  | "auto_saved";

export type ItemReviewStatus = "pending" | "approved" | "edited" | "rejected";

export type InvoiceHeaderFieldKey =
  | "vendor_name"
  | "vendor_tax_number"
  | "invoice_number"
  | "invoice_date"
  | "subtotal"
  | "discount_amount"
  | "vat_amount"
  | "grand_total";

export type FieldApprovalsMap = Partial<Record<InvoiceHeaderFieldKey, ItemReviewStatus>>;

export interface InvoiceItemRecord {
  id: string;
  invoice_id: string;
  user_id: string;
  line_index: number;
  item_name: string;
  quantity: number;
  unit_price: number;
  tax_amount: number;
  line_total: number;
  review_status: ItemReviewStatus;
  review_note: string | null;
  created_at: string;
}

export interface InvoiceRecord {
  id: string;
  user_id: string;
  file_path: string;
  file_name: string;
  mime_type: string | null;
  file_size: number;
  vendor_name: string | null;
  vendor_tax_number: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  currency: string;
  subtotal: number;
  vat_amount: number;
  discount_amount: number;
  grand_total: number;
  category: string | null;
  notes: string | null;
  raw_extracted_text: string | null;
  ocr_status: OcrStatus;
  verification_status: VerificationStatus;
  processing_mode: string;
  ai_model: string | null;
  field_approvals: FieldApprovalsMap;
  math_consistent: boolean;
  math_difference: number;
  created_at: string;
  updated_at: string;
  items: InvoiceItemRecord[];
  ai_analyzable?: boolean;
}

export interface UserSettings {
  user_id: string;
  require_line_by_line_review: boolean;
  default_currency: string;
  auto_delete_days: number | null;
  updated_at: string;
}

export interface AiQuotaStatus {
  enabled: boolean;
  available: boolean;
  reason: "ready" | "quota_exhausted" | "models_in_cooldown" | "missing_api_key" | "api_auth_error";
  models: string[];
  eligible_models: string[];
  active_model: string | null;
  retry_after_seconds: number;
  last_error_code: number | null;
  last_error: string | null;
  checked_at: string | null;
}

export interface DashboardKpis {
  total_invoices: number;
  verified_count: number;
  pending_review_count: number;
  pending_ai_count: number;
  total_spend: number;
  total_vat: number;
}
