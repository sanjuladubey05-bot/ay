-- LPS STORE - Phase 1 Session Persistence, Password Reset Architecture & Contact Inquiries

CREATE TABLE IF NOT EXISTS public.auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  role_scope TEXT NOT NULL CHECK (role_scope IN ('customer', 'admin')),
  ip_address TEXT,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  requested_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.contact_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL CHECK (position('@' IN email) > 1),
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_profile ON public.auth_sessions(profile_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON public.auth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_pwd_reset_profile ON public.password_reset_tokens(profile_id);
CREATE INDEX IF NOT EXISTS idx_contact_inquiries_created ON public.contact_inquiries(created_at DESC);

ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_inquiries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_sessions_own_or_admin ON public.auth_sessions;
CREATE POLICY auth_sessions_own_or_admin ON public.auth_sessions
  FOR SELECT USING (profile_id = public.app_current_profile_id() OR public.app_is_admin());

DROP POLICY IF EXISTS pwd_reset_admin_only ON public.password_reset_tokens;
CREATE POLICY pwd_reset_admin_only ON public.password_reset_tokens
  FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

DROP POLICY IF EXISTS contact_inquiries_admin_only ON public.contact_inquiries;
CREATE POLICY contact_inquiries_admin_only ON public.contact_inquiries
  FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_sessions, public.password_reset_tokens, public.contact_inquiries TO lps_rls_enforced;

DROP TRIGGER IF EXISTS trg_auth_sessions_updated_at ON public.auth_sessions;
CREATE TRIGGER trg_auth_sessions_updated_at BEFORE UPDATE ON public.auth_sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_password_reset_tokens_updated_at ON public.password_reset_tokens;
CREATE TRIGGER trg_password_reset_tokens_updated_at BEFORE UPDATE ON public.password_reset_tokens FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_contact_inquiries_updated_at ON public.contact_inquiries;
CREATE TRIGGER trg_contact_inquiries_updated_at BEFORE UPDATE ON public.contact_inquiries FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
