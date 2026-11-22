-- LPS STORE - Phase 1 Initial PostgreSQL Schema
-- All 21 foundational tables, constraints, foreign keys, indexes, and updated_at triggers.
-- Uses built-in PostgreSQL gen_random_uuid() (PostgreSQL 13+ / Supabase / PGlite).

-- Trigger function to automatically maintain updated_at timestamps
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- 1. profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_auth_id UUID UNIQUE,
  email TEXT NOT NULL UNIQUE CHECK (position('@' IN email) > 1),
  full_name TEXT NOT NULL DEFAULT '',
  phone TEXT,
  password_hash TEXT,
  account_status TEXT NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('active', 'suspended', 'pending')),
  is_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. roles
CREATE TABLE IF NOT EXISTS public.roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE CHECK (code ~ '^[a-z_]+$'),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_system BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. admin_users
CREATE TABLE IF NOT EXISTS public.admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
  is_owner BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. games
CREATE TABLE IF NOT EXISTS public.games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  title TEXT NOT NULL,
  publisher TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'top_up',
  description TEXT NOT NULL DEFAULT '',
  cover_media_id UUID,
  delivery_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (delivery_mode IN ('manual', 'automatic', 'hybrid')),
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. game_regions
CREATE TABLE IF NOT EXISTS public.game_regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  region_code TEXT NOT NULL,
  region_name TEXT NOT NULL,
  server_hint TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (game_id, region_code)
);

-- 6. currencies
CREATE TABLE IF NOT EXISTS public.currencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE CHECK (char_length(code) BETWEEN 3 AND 6),
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  decimal_places SMALLINT NOT NULL DEFAULT 2 CHECK (decimal_places BETWEEN 0 AND 4),
  exchange_rate_to_inr NUMERIC(14, 6) NOT NULL CHECK (exchange_rate_to_inr > 0),
  is_base BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. suppliers (created before packages so packages.supplier_id can reference it)
CREATE TABLE IF NOT EXISTS public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_-]+$'),
  integration_type TEXT NOT NULL DEFAULT 'manual'
    CHECK (integration_type IN ('manual', 'api', 'webhook')),
  api_base_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  balance_inr NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (balance_inr >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. packages
CREATE TABLE IF NOT EXISTS public.packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  region_id UUID REFERENCES public.game_regions(id) ON DELETE SET NULL,
  currency_id UUID NOT NULL REFERENCES public.currencies(id) ON DELETE RESTRICT,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  in_game_amount NUMERIC(14, 2) NOT NULL CHECK (in_game_amount > 0),
  in_game_unit TEXT NOT NULL,
  price_inr NUMERIC(12, 2) NOT NULL CHECK (price_inr > 0),
  cost_inr NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (cost_inr >= 0),
  delivery_type TEXT NOT NULL DEFAULT 'manual'
    CHECK (delivery_type IN ('manual', 'automatic')),
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. customers
CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  customer_code TEXT NOT NULL UNIQUE,
  default_currency_code TEXT NOT NULL DEFAULT 'INR',
  country_code TEXT NOT NULL DEFAULT 'IN',
  total_orders INTEGER NOT NULL DEFAULT 0 CHECK (total_orders >= 0),
  lifetime_spend_inr NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (lifetime_spend_inr >= 0),
  risk_flag TEXT NOT NULL DEFAULT 'normal'
    CHECK (risk_flag IN ('normal', 'review', 'blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. orders
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT NOT NULL UNIQUE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'awaiting_payment', 'paid', 'fulfilling', 'completed', 'cancelled', 'failed', 'refunded')),
  payment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'processing', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded')),
  subtotal_inr NUMERIC(12, 2) NOT NULL CHECK (subtotal_inr >= 0),
  tax_inr NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (tax_inr >= 0),
  total_inr NUMERIC(12, 2) NOT NULL CHECK (total_inr > 0),
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  currency_code TEXT NOT NULL DEFAULT 'INR',
  payment_mode TEXT NOT NULL DEFAULT 'test' CHECK (payment_mode IN ('test', 'live')),
  customer_note TEXT,
  fulfilled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. order_items
CREATE TABLE IF NOT EXISTS public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  package_id UUID NOT NULL REFERENCES public.packages(id) ON DELETE RESTRICT,
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE RESTRICT,
  region_id UUID REFERENCES public.game_regions(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_inr NUMERIC(12, 2) NOT NULL CHECK (unit_price_inr > 0),
  total_price_inr NUMERIC(12, 2) NOT NULL CHECK (total_price_inr > 0),
  target_player_uid TEXT NOT NULL,
  target_server_id TEXT,
  fulfillment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (fulfillment_status IN ('pending', 'queued', 'manual_review', 'delivered', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. payments
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  gateway TEXT NOT NULL DEFAULT 'razorpay' CHECK (gateway IN ('razorpay')),
  mode TEXT NOT NULL DEFAULT 'test' CHECK (mode IN ('test', 'live')),
  razorpay_order_id TEXT UNIQUE,
  razorpay_payment_id TEXT UNIQUE,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  method TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded')),
  signature_verified BOOLEAN NOT NULL DEFAULT FALSE,
  authorized_at TIMESTAMPTZ,
  captured_at TIMESTAMPTZ,
  failure_code TEXT,
  failure_reason TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. payment_transactions
CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  gateway_event_id TEXT UNIQUE,
  gateway_payment_id TEXT,
  gateway_order_id TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'processing', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded')),
  amount_paise BIGINT NOT NULL CHECK (amount_paise >= 0),
  signature_valid BOOLEAN NOT NULL DEFAULT FALSE,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. refunds
CREATE TABLE IF NOT EXISTS public.refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  razorpay_refund_id TEXT UNIQUE,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processed', 'failed')),
  initiated_by_admin_id UUID REFERENCES public.admin_users(id) ON DELETE SET NULL,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15. supplier_orders
CREATE TABLE IF NOT EXISTS public.supplier_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id UUID NOT NULL REFERENCES public.order_items(id) ON DELETE RESTRICT,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  external_reference TEXT,
  cost_inr NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (cost_inr >= 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted', 'completed', 'failed', 'cancelled')),
  response_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 16. expenses
CREATE TABLE IF NOT EXISTS public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  amount_inr NUMERIC(12, 2) NOT NULL CHECK (amount_inr > 0),
  incurred_on DATE NOT NULL DEFAULT CURRENT_DATE,
  recorded_by_admin_id UUID REFERENCES public.admin_users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 17. website_settings
CREATE TABLE IF NOT EXISTS public.website_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key TEXT NOT NULL UNIQUE,
  setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by_admin_id UUID REFERENCES public.admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 18. website_layouts
CREATE TABLE IF NOT EXISTS public.website_layouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  updated_by_admin_id UUID REFERENCES public.admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 19. uploaded_media
CREATE TABLE IF NOT EXISTS public.uploaded_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_bucket TEXT NOT NULL DEFAULT 'lps-media',
  storage_path TEXT NOT NULL UNIQUE,
  public_url TEXT,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  alt_text TEXT,
  uploaded_by_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add deferred FK from games.cover_media_id to uploaded_media.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_games_cover_media'
  ) THEN
    ALTER TABLE public.games
      ADD CONSTRAINT fk_games_cover_media
      FOREIGN KEY (cover_media_id) REFERENCES public.uploaded_media(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 20. notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app', 'email')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 21. audit_logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast relational lookups & analytics
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_admin_users_role ON public.admin_users(role_id);
CREATE INDEX IF NOT EXISTS idx_games_active_sort ON public.games(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_game_regions_game ON public.game_regions(game_id);
CREATE INDEX IF NOT EXISTS idx_packages_game_active ON public.packages(game_id, is_active);
CREATE INDEX IF NOT EXISTS idx_customers_profile ON public.customers(profile_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON public.orders(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status, payment_status);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_order ON public.payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON public.payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_payment_tx_payment ON public.payment_transactions(payment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refunds_payment ON public.refunds(payment_id);
CREATE INDEX IF NOT EXISTS idx_supplier_orders_item ON public.supplier_orders(order_item_id);
CREATE INDEX IF NOT EXISTS idx_expenses_incurred ON public.expenses(incurred_on DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON public.notifications(recipient_profile_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs(actor_profile_id);

-- Attach updated_at triggers across all 21 tables
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'profiles', 'roles', 'admin_users', 'games', 'game_regions',
    'currencies', 'packages', 'customers', 'orders', 'order_items',
    'payments', 'payment_transactions', 'refunds', 'suppliers',
    'supplier_orders', 'expenses', 'website_settings', 'website_layouts',
    'uploaded_media', 'notifications', 'audit_logs'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON public.%I;', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();',
      t, t
    );
  END LOOP;
END $$;
