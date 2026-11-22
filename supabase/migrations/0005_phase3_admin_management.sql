-- LPS STORE - Phase 3 Admin Management Schema Extensions
-- Extends existing tables cleanly without creating duplicate catalog tables.

-- 1. Extend public.currencies to support unlimited game currencies alongside settlement currencies
ALTER TABLE public.currencies
  DROP CONSTRAINT IF EXISTS currencies_code_check;

ALTER TABLE public.currencies
  ADD CONSTRAINT currencies_code_check CHECK (char_length(code) BETWEEN 2 AND 24);

ALTER TABLE public.currencies
  ADD COLUMN IF NOT EXISTS currency_kind TEXT NOT NULL DEFAULT 'in_game'
    CHECK (currency_kind IN ('settlement', 'in_game')),
  ADD COLUMN IF NOT EXISTS game_id UUID REFERENCES public.games(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS media_id UUID REFERENCES public.uploaded_media(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- Mark existing INR / USD settlement currencies explicitly
UPDATE public.currencies
SET currency_kind = 'settlement'
WHERE code IN ('INR', 'USD');

-- 2. Extend public.packages for Phase 3 package & price management
ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS game_currency_id UUID REFERENCES public.currencies(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS media_id UUID REFERENCES public.uploaded_media(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS original_price_inr NUMERIC(12, 2)
    CHECK (original_price_inr IS NULL OR original_price_inr > 0),
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0
    CHECK (discount_percent >= 0 AND discount_percent <= 95),
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Add internal admin notes to public.orders (non-customer-facing)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS admin_note TEXT NOT NULL DEFAULT '';

-- 4. Indexes for Phase 3 admin filtering & media usage checks
CREATE INDEX IF NOT EXISTS idx_currencies_kind_game ON public.currencies(currency_kind, game_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_packages_game_currency ON public.packages(game_currency_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_desc ON public.orders(created_at DESC);
