import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  BadgeIndianRupee,
  Coins,
  Gamepad2,
  Globe,
  Image as ImageIcon,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  ShoppingBag,
  Store,
  Truck,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { ROUTES } from '../configuration/routes';
import { useAuth } from '../hooks/useAuth';
import { apiClient } from '../services/apiClient';

const ADMIN_NAV_ITEMS = [
  { to: ROUTES.ADMIN_DASHBOARD, label: 'Dashboard', Icon: LayoutDashboard },
  { to: ROUTES.ADMIN_GAMES, label: 'Games Management', Icon: Gamepad2 },
  { to: ROUTES.ADMIN_CURRENCIES, label: 'Currency Management', Icon: Coins },
  { to: ROUTES.ADMIN_PACKAGES, label: 'Package Management', Icon: Package },
  { to: ROUTES.ADMIN_PRICING, label: 'Price Management', Icon: BadgeIndianRupee },
  { to: ROUTES.ADMIN_ORDERS, label: 'Orders', Icon: ShoppingBag },
  { to: ROUTES.ADMIN_SUPPLIERS, label: 'Suppliers & Delivery', Icon: Truck },
  { to: ROUTES.ADMIN_CUSTOMERS, label: 'Customers', Icon: Users },
  { to: ROUTES.ADMIN_MEDIA, label: 'Media Library', Icon: ImageIcon },
  { to: ROUTES.ADMIN_WEBSITE_SETTINGS, label: 'Website Settings', Icon: Globe },
  { to: ROUTES.ADMIN_PROFILE, label: 'Admin Profile', Icon: UserCog },
];

export function AdminLayout({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [pendingOrdersCount, setPendingOrdersCount] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .getAdminOverview()
      .then((res) => {
        if (!cancelled) {
          setPendingOrdersCount(res.stats.pendingOrders);
        }
      })
      .catch(() => {
        // Non-blocking badge fetch
      });
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  async function handleSignOut() {
    await logout();
    setMobileDrawerOpen(false);
    navigate(ROUTES.ADMIN_LOGIN);
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#09090E] text-[#F4F4F8]">
      {/* Mobile Drawer Backdrop */}
      {mobileDrawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/70 lg:hidden"
          onClick={() => setMobileDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 shrink-0 border-r border-white/[0.08] bg-[#0D0D14] flex flex-col justify-between transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileDrawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex-1 flex flex-col min-h-0">
          <div className="h-16 px-5 flex items-center justify-between border-b border-white/[0.08] shrink-0">
            <Link
              to={ROUTES.ADMIN_DASHBOARD}
              onClick={() => setMobileDrawerOpen(false)}
              className="font-display text-base font-bold tracking-tight text-white whitespace-nowrap"
            >
              LPS STORE Admin
            </Link>
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(false)}
              aria-label="Close admin sidebar"
              className="lg:hidden p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <nav aria-label="Admin Navigation" className="p-3.5 space-y-1 overflow-y-auto flex-1">
            {ADMIN_NAV_ITEMS.map(({ to, label, Icon }) => {
              const showPendingCount = to === ROUTES.ADMIN_ORDERS && pendingOrdersCount > 0;
              return (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setMobileDrawerOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                      isActive
                        ? 'bg-violet-600/20 text-white border border-violet-500/35'
                        : 'text-zinc-400 border border-transparent hover:text-white hover:bg-white/[0.04]'
                    }`
                  }
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{label}</span>
                  </span>
                  {showPendingCount && (
                    <span
                      aria-label={`${pendingOrdersCount} pending orders`}
                      className="shrink-0 rounded-md border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 font-mono tabular-nums text-[11px] font-semibold text-amber-300"
                    >
                      {pendingOrdersCount}
                    </span>
                  )}
                </NavLink>
              );
            })}

            <div className="pt-3 mt-3 border-t border-white/[0.08]">
              <Link
                to={ROUTES.HOME}
                onClick={() => setMobileDrawerOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-zinc-400 hover:text-white hover:bg-white/[0.04] whitespace-nowrap transition-colors"
              >
                <Store className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>View Storefront</span>
              </Link>
            </div>
          </nav>
        </div>

        <div className="p-4 border-t border-white/[0.08] space-y-3 shrink-0 bg-[#0D0D14]">
          {user && (
            <div className="text-xs space-y-0.5">
              <div className="font-medium text-white truncate">{user.fullName}</div>
              <div className="text-zinc-400 truncate">
                {user.email} · {user.roleCode}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-white/[0.12] text-xs font-medium text-zinc-200 hover:bg-white/[0.05] transition-colors whitespace-nowrap"
          >
            <LogOut className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 px-4 sm:px-6 lg:px-8 border-b border-white/[0.08] flex items-center justify-between gap-4 bg-[#09090E] sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(true)}
              aria-label="Open admin sidebar"
              aria-expanded={mobileDrawerOpen}
              className="lg:hidden p-2 rounded-lg border border-white/[0.12] text-zinc-200 hover:bg-white/[0.06] shrink-0"
            >
              <Menu className="h-4 w-4" aria-hidden="true" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-zinc-500 hidden sm:inline">Admin</span>
              <span className="text-zinc-600 hidden sm:inline">/</span>
              <h1 className="font-semibold text-white truncate">{title}</h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <Link
              to={ROUTES.ADMIN_SETTINGS}
              className="px-3 py-1.5 rounded-lg border border-white/[0.12] text-xs font-medium text-zinc-300 hover:text-white hover:bg-white/[0.05] whitespace-nowrap hidden sm:inline-flex"
            >
              Gateway Readiness
            </Link>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="lg:hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.12] text-xs font-medium text-zinc-200 whitespace-nowrap"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Logout</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1280px] w-full">{children}</main>
      </div>
    </div>
  );
}
