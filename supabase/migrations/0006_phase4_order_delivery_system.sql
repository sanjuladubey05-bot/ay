-- LPS STORE - Phase 4 Order Processing and Delivery System Schema
-- Preserves all Phase 1, 2, 3 tables and constraints cleanly.

-- 1. Expand public.orders statuses and add manual/automatic delivery & idempotency tracking
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check CHECK (
    status IN (
      'pending',
      'payment_pending',
      'awaiting_payment',
      'payment_verified',
      'paid',
      'processing',
      'fulfilling',
      'awaiting_delivery',
      'completed',
      'failed',
      'cancelled',
      'refund_pending',
      'refunded'
    )
  );

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS delivery_method TEXT NOT NULL DEFAULT 'manual'
    CHECK (delivery_method IN ('manual', 'automatic', 'both')),
  ADD COLUMN IF NOT EXISTS customer_delivery_message TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS processed_by_admin_id UUID REFERENCES public.admin_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_by_admin_id UUID REFERENCES public.admin_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_notes TEXT NOT NULL DEFAULT '';

-- 2. Expand public.order_items fulfillment_status to cover all Phase 4 delivery stages
ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS order_items_fulfillment_status_check;

ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_fulfillment_status_check CHECK (
    fulfillment_status IN (
      'pending',
      'queued',
      'processing',
      'awaiting_delivery',
      'manual_review',
      'delivered',
      'failed'
    )
  );

-- 3. Expand public.packages.delivery_type to support manual, automatic, and both
ALTER TABLE public.packages
  DROP CONSTRAINT IF EXISTS packages_delivery_type_check;

ALTER TABLE public.packages
  ADD CONSTRAINT packages_delivery_type_check CHECK (
    delivery_type IN ('manual', 'automatic', 'both')
  );

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS supplier_product_code TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS supplier_cost_inr NUMERIC(12, 2) NOT NULL DEFAULT 0
    CHECK (supplier_cost_inr >= 0);

-- 4. Assign default supplier per game cleanly
ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS default_supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL;

-- 5. Expand public.suppliers for API configuration, mock/live mode, timeouts, and retries
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'mock'
    CHECK (mode IN ('mock', 'live')),
  ADD COLUMN IF NOT EXISTS api_key_env_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS timeout_ms INTEGER NOT NULL DEFAULT 8000
    CHECK (timeout_ms BETWEEN 1000 AND 60000),
  ADD COLUMN IF NOT EXISTS max_retries INTEGER NOT NULL DEFAULT 2
    CHECK (max_retries BETWEEN 0 AND 5),
  ADD COLUMN IF NOT EXISTS supported_games_note TEXT NOT NULL DEFAULT '';

-- 6. Supplier package mappings
CREATE TABLE IF NOT EXISTS public.supplier_package_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  package_id UUID NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  external_product_code TEXT NOT NULL,
  external_product_name TEXT NOT NULL DEFAULT '',
  supplier_cost_inr NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (supplier_cost_inr >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (supplier_id, package_id)
);

-- 7. Expand public.supplier_orders with mock-mode safety labels, idempotency, retries, and payloads
ALTER TABLE public.supplier_orders
  ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS is_mock BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS environment_label TEXT NOT NULL DEFAULT 'TEST ONLY (MOCK MODE)',
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  ADD COLUMN IF NOT EXISTS request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS error_message TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_supplier_order_per_item
  ON public.supplier_orders(order_item_id)
  WHERE status IN ('pending', 'submitted', 'completed');

-- 8. Delivery processing history log (admin actions & automatic attempts)
CREATE TABLE IF NOT EXISTS public.order_delivery_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  actor_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_label TEXT NOT NULL DEFAULT 'system',
  event_type TEXT NOT NULL,
  previous_status TEXT,
  next_status TEXT,
  delivery_method TEXT,
  is_mock BOOLEAN NOT NULL DEFAULT FALSE,
  message TEXT NOT NULL DEFAULT '',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_delivery_logs_order ON public.order_delivery_logs(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_mappings_pkg ON public.supplier_package_mappings(package_id);
CREATE INDEX IF NOT EXISTS idx_supplier_orders_order ON public.supplier_orders(order_id, created_at DESC);

-- Maintain updated_at trigger on supplier_package_mappings
DROP TRIGGER IF EXISTS trg_supplier_package_mappings_updated_at ON public.supplier_package_mappings;
CREATE TRIGGER trg_supplier_package_mappings_updated_at
  BEFORE UPDATE ON public.supplier_package_mappings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Enable RLS on new Phase 4 admin-only tables
ALTER TABLE public.supplier_package_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_delivery_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_mappings_admin_all ON public.supplier_package_mappings;
CREATE POLICY supplier_mappings_admin_all ON public.supplier_package_mappings
  FOR ALL USING (public.app_is_admin())
  WITH CHECK (public.app_is_admin());

DROP POLICY IF EXISTS order_delivery_logs_admin_all ON public.order_delivery_logs;
CREATE POLICY order_delivery_logs_admin_all ON public.order_delivery_logs
  FOR ALL USING (public.app_is_admin())
  WITH CHECK (public.app_is_admin());
