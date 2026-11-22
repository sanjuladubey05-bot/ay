import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Lock, ShieldCheck } from 'lucide-react';
import { ROUTES } from '../../configuration/routes';
import { useAuth } from '../../hooks/useAuth';
import { apiClient } from '../../services/apiClient';

export function AdminLoginPage() {
  const { user, loading, adminBootstrapRequired, setUser, refreshAuth } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'login' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  if (!loading && user?.isAdmin) {
    return <Navigate to={ROUTES.ADMIN_DASHBOARD} replace />;
  }

  async function handleBootstrap(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await apiClient.bootstrapOwnerAdmin({ email, fullName, password });
      setUser(res.user);
      await refreshAuth();
      navigate(ROUTES.ADMIN_DASHBOARD, { replace: true });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to claim owner account.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const res = await apiClient.adminLogin({ email, password });
      setUser(res.user);
      await refreshAuth();
      navigate(ROUTES.ADMIN_DASHBOARD, { replace: true });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Administrator sign in failed.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetRequest(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const res = await apiClient.requestPasswordReset(email);
      setInfoMsg(res.message);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Reset request failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#09090E] text-[#F4F4F8] flex flex-col justify-center px-6 py-12">
      <div className="mx-auto max-w-[460px] w-full space-y-6">
        <div className="flex items-center justify-between">
          <Link to={ROUTES.HOME} className="font-display text-lg font-bold text-white">
            LPS STORE
          </Link>
          <span className="text-xs text-zinc-400">Restricted Admin Access</span>
        </div>

        <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-8 space-y-6">
          {adminBootstrapRequired ? (
            <>
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 text-xs font-medium text-blue-400">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  <span>First-Run Owner Setup</span>
                </div>
                <h1 className="text-2xl font-bold text-white">Claim Store Owner Account</h1>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  No owner administrator password is configured yet. Complete this one-time
                  setup to create the sole Store Owner account. This endpoint locks
                  permanently once claimed.
                </p>
              </div>

              {errorMsg && (
                <div
                  role="alert"
                  className="bg-red-500/10 border border-red-500/30 rounded-lg p-3.5 text-sm text-red-200"
                >
                  {errorMsg}
                </div>
              )}

              <form onSubmit={(e) => void handleBootstrap(e)} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="owner-name" className="block text-xs font-medium text-zinc-300">
                    Owner Name
                  </label>
                  <input
                    id="owner-name"
                    type="text"
                    required
                    minLength={2}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Store Owner"
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2.5 text-sm text-white focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="owner-email" className="block text-xs font-medium text-zinc-300">
                    Owner Email
                  </label>
                  <input
                    id="owner-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="owner@lpsstore.com"
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2.5 text-sm text-white focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="owner-password" className="block text-xs font-medium text-zinc-300">
                    Owner Password (minimum 10 characters)
                  </label>
                  <input
                    id="owner-password"
                    type="password"
                    required
                    minLength={10}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2.5 text-sm text-white focus:border-blue-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 rounded-lg bg-violet-600 text-sm font-semibold text-white hover:bg-violet-500 transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Configuring Owner...' : 'Create Owner & Sign In'}
                </button>
              </form>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 text-xs font-medium text-zinc-400">
                  <Lock className="h-3.5 w-3.5 text-violet-400" aria-hidden="true" />
                  <span>Public Admin Registration Disabled</span>
                </div>
                <h1 className="text-2xl font-bold text-white">
                  {mode === 'login' ? 'Administrator Sign In' : 'Admin Password Reset'}
                </h1>
                <p className="text-sm text-zinc-400">
                  {mode === 'login'
                    ? 'Authorized owner and role-verified staff accounts only.'
                    : 'Submit your administrator email to record a single-use reset request.'}
                </p>
              </div>

              {errorMsg && (
                <div
                  role="alert"
                  className="bg-red-500/10 border border-red-500/30 rounded-lg p-3.5 text-sm text-red-200"
                >
                  {errorMsg}
                </div>
              )}

              {infoMsg && (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3.5 text-sm text-blue-200">
                  {infoMsg}
                </div>
              )}

              {mode === 'login' ? (
                <form onSubmit={(e) => void handleLogin(e)} className="space-y-4">
                  <div className="space-y-1.5">
                    <label htmlFor="admin-email" className="block text-xs font-medium text-zinc-300">
                      Administrator Email
                    </label>
                    <input
                      id="admin-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2.5 text-sm text-white focus:border-blue-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="admin-password" className="block text-xs font-medium text-zinc-300">
                      Password
                    </label>
                    <input
                      id="admin-password"
                      type="password"
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2.5 text-sm text-white focus:border-blue-500"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-2.5 rounded-lg bg-violet-600 text-sm font-semibold text-white hover:bg-violet-500 transition-colors disabled:opacity-50"
                  >
                    {submitting ? 'Authenticating...' : 'Sign In to Admin Console'}
                  </button>
                </form>
              ) : (
                <form onSubmit={(e) => void handleResetRequest(e)} className="space-y-4">
                  <div className="space-y-1.5">
                    <label htmlFor="admin-reset-email" className="block text-xs font-medium text-zinc-300">
                      Administrator Email
                    </label>
                    <input
                      id="admin-reset-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2.5 text-sm text-white focus:border-blue-500"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-2.5 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
                  >
                    {submitting ? 'Submitting...' : 'Request Password Reset'}
                  </button>
                </form>
              )}

              <div className="pt-4 border-t border-white/[0.08] flex items-center justify-between text-xs text-zinc-400">
                <button
                  type="button"
                  onClick={() => {
                    setMode(mode === 'login' ? 'reset' : 'login');
                    setErrorMsg(null);
                    setInfoMsg(null);
                  }}
                  className="hover:text-white transition-colors"
                >
                  {mode === 'login' ? 'Reset admin password' : 'Back to Admin Sign In'}
                </button>
                <Link to={ROUTES.HOME} className="hover:text-white transition-colors">
                  Return to Storefront
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
