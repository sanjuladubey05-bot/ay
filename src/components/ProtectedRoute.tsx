import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { ROUTES } from '../configuration/routes';
import { useAuth } from '../hooks/useAuth';

export function ProtectedRoute({
  children,
  requireAdmin = false,
}: {
  children: ReactNode;
  requireAdmin?: boolean;
}) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-6">
        <div className="text-sm text-zinc-400">Verifying session permissions...</div>
      </div>
    );
  }

  if (!user) {
    const target = requireAdmin ? ROUTES.ADMIN_LOGIN : ROUTES.LOGIN;
    const existingState = (location.state as Record<string, unknown> | null) || {};
    return (
      <Navigate
        to={target}
        state={{ ...existingState, from: location.pathname }}
        replace
      />
    );
  }

  if (requireAdmin && !user.isAdmin) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-6 py-16">
        <div className="max-w-md w-full bg-[#111118] border border-white/[0.08] rounded-xl p-8 text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-red-500/10 text-red-400">
            <ShieldAlert className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold text-white">Administrator Access Required</h1>
          <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
            Your signed-in customer account ({user.email}) does not hold administrator
            permissions. Owner and staff consoles are strictly isolated.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Link
              to={ROUTES.HOME}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-500 transition-colors whitespace-nowrap"
            >
              Return to Storefront
            </Link>
            <Link
              to={ROUTES.ORDERS}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-white/[0.12] text-zinc-200 hover:bg-white/[0.04] transition-colors whitespace-nowrap"
            >
              My Orders
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
