-- Arabic Purchase Invoices OCR (Plan 1: Supabase Postgres + Storage + RLS)
-- Run this script once in your Supabase SQL Editor. It is safe to re-run (idempotent).

-- 1. User settings (controls line-by-line review toggle & permanent vs optional expiry)
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  require_line_by_line_review BOOLEAN NOT NULL DEFAULT true,
  default_currency TEXT NOT NULL DEFAULT 'SAR',
  auto_delete_days INTEGER NULL CHECK (auto_delete_days IS NULL OR auto_delete_days BETWEEN 1 AND 3650),
  custom_gemini_api_key TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS custom_gemini_api_key TEXT NULL;

-- 2. Invoices master table
CREATE TABLE IF NOT EXISTS public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  vendor_name TEXT NULL,
  vendor_tax_number TEXT NULL,
  invoice_number TEXT NULL,
  invoice_date DATE NULL,
  currency TEXT NOT NULL DEFAULT 'SAR',
  subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
  vat_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  grand_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  category TEXT NULL,
  notes TEXT NULL,
  raw_extracted_text TEXT NULL,
  ocr_status TEXT NOT NULL DEFAULT 'pending_ai'
    CHECK (ocr_status IN ('analyzed', 'pending_ai', 'manual', 'unsupported')),
  verification_status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (verification_status IN ('pending_review', 'verified', 'partial_rejected', 'auto_saved')),
  processing_mode TEXT NOT NULL DEFAULT 'pending_ai',
  ai_model TEXT NULL,
  field_approvals JSONB NOT NULL DEFAULT '{}'::jsonb,
  math_consistent BOOLEAN NOT NULL DEFAULT true,
  math_difference NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Extracted invoice line items (reviewed line by line)
CREATE TABLE IF NOT EXISTS public.invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  line_index INTEGER NOT NULL DEFAULT 0,
  item_name TEXT NOT NULL,
  quantity NUMERIC(12, 3) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  line_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved', 'edited', 'rejected')),
  review_note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Persistent AI model cooldown state across Serverless invocations
CREATE TABLE IF NOT EXISTS public.ai_model_cooldowns (
  model_name TEXT PRIMARY KEY,
  cooldown_until TIMESTAMPTZ NULL,
  last_error_code INTEGER NULL,
  last_error_message TEXT NULL,
  is_quota_error BOOLEAN NOT NULL DEFAULT false,
  last_success_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for fast filtering & Arabic/numeric text search
CREATE INDEX IF NOT EXISTS invoices_user_created_idx
  ON public.invoices (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS invoices_user_status_idx
  ON public.invoices (user_id, verification_status, ocr_status);

CREATE INDEX IF NOT EXISTS invoice_items_invoice_line_idx
  ON public.invoice_items (invoice_id, line_index ASC);

CREATE INDEX IF NOT EXISTS invoices_search_gin_idx
  ON public.invoices USING GIN (
    to_tsvector(
      'simple',
      coalesce(vendor_name, '') || ' ' ||
      coalesce(invoice_number, '') || ' ' ||
      coalesce(vendor_tax_number, '') || ' ' ||
      coalesce(file_name, '')
    )
  );

-- Automatic updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_settings_updated_at ON public.user_settings;
CREATE TRIGGER trg_user_settings_updated_at
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON public.invoices;
CREATE TRIGGER trg_invoices_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Automatically seed default settings row when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_invoice_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_settings (user_id, require_line_by_line_review, default_currency, auto_delete_days)
  VALUES (NEW.id, true, 'SAR', NULL)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_settings ON auth.users;
CREATE TRIGGER on_auth_user_created_settings
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_invoice_user();

-- Row Level Security (RLS)
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_model_cooldowns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own settings" ON public.user_settings;
CREATE POLICY "Users manage own settings"
  ON public.user_settings
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own invoices" ON public.invoices;
CREATE POLICY "Users manage own invoices"
  ON public.invoices
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own invoice items" ON public.invoice_items;
CREATE POLICY "Users manage own invoice items"
  ON public.invoice_items
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Authenticated users read AI status" ON public.ai_model_cooldowns;
CREATE POLICY "Authenticated users read AI status"
  ON public.ai_model_cooldowns
  FOR SELECT
  TO authenticated
  USING (true);

-- Private Storage bucket for purchase invoices (50 MB max per file)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'invoices',
  'invoices',
  false,
  52428800,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 52428800;

DROP POLICY IF EXISTS "Users upload own invoice files" ON storage.objects;
CREATE POLICY "Users upload own invoice files"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'invoices'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users view own invoice files" ON storage.objects;
CREATE POLICY "Users view own invoice files"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'invoices'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users update own invoice files" ON storage.objects;
CREATE POLICY "Users update own invoice files"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'invoices'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users delete own invoice files" ON storage.objects;
CREATE POLICY "Users delete own invoice files"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'invoices'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
