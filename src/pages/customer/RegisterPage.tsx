import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ROUTES } from '../../configuration/routes';
import { useAuth } from '../../hooks/useAuth';
import { apiClient } from '../../services/apiClient';

export function RegisterPage() {
  const { setUser, refreshAuth, signInWithGoogle, firebaseReady } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = (location.state as { from?: string; orderDraft?: unknown } | null) || null;
  const redirectTo = locationState?.from || ROUTES.ORDERS;

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await apiClient.customerRegister({ fullName, email, password });
      setUser(res.user);
      await refreshAuth();
      navigate(redirectTo, {
        replace: true,
        state: locationState?.orderDraft ? { orderDraft: locationState.orderDraft } : undefined,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to create account.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleSignup() {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await signInWithGoogle();
      navigate(redirectTo, {
        replace: true,
        state: locationState?.orderDraft ? { orderDraft: locationState.orderDraft } : undefined,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Google sign-in was cancelled or failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-[460px] px-6 py-16">
      <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-8 space-y-6">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-bold text-white">Create Customer Account</h1>
          <p className="text-sm text-zinc-400">
            Register an LPS STORE customer account to place top-up orders and track delivery.
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

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="reg-name" className="block text-xs font-medium text-zinc-300">
              Full Name
            </label>
            <input
              id="reg-name"
              type="text"
              required
              minLength={2}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Alex Mercer"
              className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="reg-email" className="block text-xs font-medium text-zinc-300">
              Email Address
            </label>
            <input
              id="reg-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alex@example.com"
              className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="reg-password" className="block text-xs font-medium text-zinc-300">
              Password (minimum 10 characters)
            </label>
            <input
              id="reg-password"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 rounded-lg bg-violet-600 text-sm font-semibold text-white hover:bg-violet-500 transition-colors disabled:opacity-50"
          >
            {submitting ? 'Creating Account...' : 'Create Account'}
          </button>

          {firebaseReady && (
            <>
              <div className="relative flex items-center py-1">
                <div className="flex-grow border-t border-white/[0.08]" />
                <span className="px-3 text-[11px] uppercase tracking-wider text-zinc-500">or</span>
                <div className="flex-grow border-t border-white/[0.08]" />
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleGoogleSignup()}
                className="w-full py-2.5 rounded-lg bg-[#09090E] border border-white/[0.14] text-sm font-medium text-white hover:border-white/[0.28] hover:bg-white/[0.04] transition-colors disabled:opacity-50"
              >
                Continue with Google
              </button>
            </>
          )}
        </form>

        <div className="pt-4 border-t border-white/[0.08] text-xs text-zinc-400 text-center">
          Already have a customer account?{' '}
          <Link
            to={ROUTES.LOGIN}
            state={locationState || undefined}
            className="text-violet-400 hover:text-violet-300"
          >
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
