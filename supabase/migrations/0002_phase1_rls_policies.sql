-- LPS STORE - Phase 1 Row Level Security (RLS) & Access Control Policies
-- Enforces strict isolation between public/customer access and owner/admin access.

-- Context helper: resolves current authenticated profile UUID from transaction GUC
-- (`app.current_user_id` set by backend session middleware, or Supabase JWT sub if present).
CREATE OR REPLACE FUNCTION public.app_current_profile_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  raw_id TEXT;
BEGIN
  raw_id := NULLIF(current_setting('app.current_user_id', TRUE), '');
  IF raw_id IS NOT NULL THEN
    RETURN raw_id::uuid;
  END IF;

  -- Optional Supabase Auth fallback when invoked via PostgREST/Supabase client
  raw_id := NULLIF(current_setting('request.jwt.claim.sub', TRUE), '');
  IF raw_id IS NOT NULL THEN
    RETURN (
      SELECT id FROM public.profiles WHERE supabase_auth_id = raw_id::uuid LIMIT 1
    );
  END IF;

  RETURN NULL;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.app_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users au
    JOIN public.profiles p ON p.id = au.profile_id
    WHERE au.profile_id = public.app_current_profile_id()
      AND au.is_active = TRUE
      AND p.account_status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.app_is_owner()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.profile_id = public.app_current_profile_id()
      AND au.is_active = TRUE
      AND au.is_owner = TRUE
  );
$$;

CREATE OR REPLACE FUNCTION public.app_current_customer_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT id
  FROM public.customers
  WHERE profile_id = public.app_current_profile_id()
  LIMIT 1;
$$;

-- Enable RLS on all 21 foundational tables
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
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;

-- 1. profiles: users see/update own profile; admins see all
DROP POLICY IF EXISTS profiles_select_own_or_admin ON public.profiles;
CREATE POLICY profiles_select_own_or_admin ON public.profiles
  FOR SELECT USING (id = public.app_current_profile_id() OR public.app_is_admin());

DROP POLICY IF EXISTS profiles_update_own_or_admin ON public.profiles;
CREATE POLICY profiles_update_own_or_admin ON public.profiles
  FOR UPDATE USING (id = public.app_current_profile_id() OR public.app_is_admin());

-- 2. roles & 3. admin_users: strictly admin-only
DROP POLICY IF EXISTS roles_admin_only ON public.roles;
CREATE POLICY roles_admin_only ON public.roles
  FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_owner());

DROP POLICY IF EXISTS admin_users_admin_only ON public.admin_users;
CREATE POLICY admin_users_admin_only ON public.admin_users
  FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_owner());

-- 4-7. catalog tables (games, game_regions, currencies, packages): public read active only; admin manage all
DROP POLICY IF EXISTS games_public_read_active ON public.games;
CREATE POLICY games_public_read_active ON public.games
  FOR SELECT USING (is_active = TRUE OR public.app_is_admin());

DROP POLICY IF EXISTS games_admin_write ON public.games;
CREATE POLICY games_admin_write ON public.games
  FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

DROP POLICY IF EXISTS game_regions_public_read ON public.game_regions;
CREATE POLICY game_regions_public_read ON public.game_regions
  FOR SELECT USING (is_active = TRUE OR public.app_is_admin());

DROP POLICY IF EXISTS game_regions_admin_write ON public.game_regions;
CREATE POLICY game_regions_admin_write ON public.game_regions
  FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

DROP POLICY IF EXISTS currencies_public_read ON public.currencies;
CREATE POLICY currencies_public_read ON public.currencies
  FOR SELECT USING (is_active = TRUE OR public.app_is_admin());

DROP POLICY IF EXISTS currencies_admin_write ON public.currencies;
CREATE POLICY currencies_admin_write ON public.currencies
  FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

DROP POLICY IF EXISTS packages_public_read ON public.packages;
CREATE POLICY packages_public_read ON public.packages
  FOR SELECT USING (is_active = TRUE OR public.app_is_admin());

DROP POLICY IF EXISTS packages_admin_write ON public.packages;
CREATE POLICY packages_admin_write ON public.packages
  FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

-- 8. customers: own record or admin
DROP POLICY IF EXISTS customers_own_or_admin ON public.customers;
CREATE POLICY customers_own_or_admin ON public.customers
  FOR SELECT USING (profile_id = public.app_current_profile_id() OR public.app_is_admin());

DROP POLICY IF EXISTS customers_admin_write ON public.customers;
CREATE POLICY customers_admin_write ON public.customers
  FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

-- 9. orders & 10. order_items: strictly customer-owned or admin
DROP POLICY IF EXISTS orders_own_or_admin ON public.orders;
CREATE POLICY orders_own_or_admin ON public.orders
  FOR SELECT USING (customer_id = public.app_current_customer_id() OR public.app_is_admin());

DROP POLICY IF EXISTS orders_admin_manage ON public.orders;
CREATE POLICY orders_admin_manage ON public.orders
  FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

DROP POLICY IF EXISTS order_items_own_or_admin ON public.order_items;
CREATE POLICY order_items_own_or_admin ON public.order_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND (o.customer_id = public.app_current_customer_id() OR public.app_is_admin())
    )
  );

DROP POLICY IF EXISTS order_items_admin_manage ON public.order_items;
CREATE POLICY order_items_admin_manage ON public.order_items
  FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

-- 11. payments: customer can view own payment status; mutations server/admin only
DROP POLICY IF EXISTS payments_own_or_admin ON public.payments;
CREATE POLICY payments_own_or_admin ON public.payments
  FOR SELECT USING (customer_id = public.app_current_customer_id() OR public.app_is_admin());

DROP POLICY IF EXISTS payments_admin_manage ON public.payments;
CREATE POLICY payments_admin_manage ON public.payments
  FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

-- 12. payment_transactions, 13. refunds, 14. suppliers, 15. supplier_orders, 16. expenses: admin-only
DROP POLICY IF EXISTS payment_tx_admin_only ON public.payment_transactions;
CREATE POLICY payment_tx_admin_only ON public.payment_transactions
  FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

DROP POLICY IF EXISTS refunds_own_read_or_admin ON public.refunds;
CREATE POLICY refunds_own_read_or_admin ON public.refunds
  FOR SELECT USING (
    public.app_is_admin() OR EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = refunds.order_id AND o.customer_id = public.app_current_customer_id()
    )
  );

DROP POLICY IF EXISTS refunds_admin_manage ON public.refunds;
CREATE POLICY refunds_admin_manage ON public.refunds
  FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

DROP POLICY IF EXISTS suppliers_admin_only ON public.suppliers;
CREATE POLICY suppliers_admin_only ON public.suppliers
  FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

DROP POLICY IF EXISTS supplier_orders_admin_only ON public.supplier_orders;
CREATE POLICY supplier_orders_admin_only ON public.supplier_orders
  FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

DROP POLICY IF EXISTS expenses_admin_only ON public.expenses;
CREATE POLICY expenses_admin_only ON public.expenses
  FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

-- 17. website_settings: public only when is_public = true; otherwise strictly admin
DROP POLICY IF EXISTS website_settings_read ON public.website_settings;
CREATE POLICY website_settings_read ON public.website_settings
  FOR SELECT USING (is_public = TRUE OR public.app_is_admin());

DROP POLICY IF EXISTS website_settings_admin_write ON public.website_settings;
CREATE POLICY website_settings_admin_write ON public.website_settings
  FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

-- 18. website_layouts & 19. uploaded_media
DROP POLICY IF EXISTS website_layouts_read ON public.website_layouts;
CREATE POLICY website_layouts_read ON public.website_layouts
  FOR SELECT USING (is_published = TRUE OR public.app_is_admin());

DROP POLICY IF EXISTS website_layouts_admin_write ON public.website_layouts;
CREATE POLICY website_layouts_admin_write ON public.website_layouts
  FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

DROP POLICY IF EXISTS uploaded_media_read ON public.uploaded_media;
CREATE POLICY uploaded_media_read ON public.uploaded_media
  FOR SELECT USING (is_public = TRUE OR uploaded_by_profile_id = public.app_current_profile_id() OR public.app_is_admin());

DROP POLICY IF EXISTS uploaded_media_admin_write ON public.uploaded_media;
CREATE POLICY uploaded_media_admin_write ON public.uploaded_media
  FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

-- 20. notifications: own notifications or admin
DROP POLICY IF EXISTS notifications_own_or_admin ON public.notifications;
CREATE POLICY notifications_own_or_admin ON public.notifications
  FOR SELECT USING (recipient_profile_id = public.app_current_profile_id() OR public.app_is_admin());

DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own ON public.notifications
  FOR UPDATE USING (recipient_profile_id = public.app_current_profile_id() OR public.app_is_admin());

-- 21. audit_logs: strictly admin read, immutable insert by server/admin
DROP POLICY IF EXISTS audit_logs_admin_read ON public.audit_logs;
CREATE POLICY audit_logs_admin_read ON public.audit_logs
  FOR SELECT USING (public.app_is_admin());

DROP POLICY IF EXISTS audit_logs_admin_insert ON public.audit_logs;
CREATE POLICY audit_logs_admin_insert ON public.audit_logs
  FOR INSERT WITH CHECK (public.app_is_admin());

-- Non-superuser role for RLS enforcement tests and user-scoped query execution
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lps_rls_enforced') THEN
    CREATE ROLE lps_rls_enforced NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO lps_rls_enforced;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lps_rls_enforced;
