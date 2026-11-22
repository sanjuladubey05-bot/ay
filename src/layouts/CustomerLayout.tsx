import { useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Gamepad2, Menu, X } from 'lucide-react';
import { ROUTES } from '../configuration/routes';
import { useAuth } from '../hooks/useAuth';
import { useStorefrontSettings } from '../hooks/useStorefrontSettings';
import { sanitizeExternalHref } from '../utilities/displayUrl';

const NAV_LINKS = [
  { to: ROUTES.HOME, label: 'Home' },
  { to: ROUTES.GAMES, label: 'All Games' },
  { to: ROUTES.ORDERS, label: 'My Orders' },
  { to: ROUTES.CONTACT, label: 'Contact Us' },
];

export function CustomerLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { settings } = useStorefrontSettings();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [logoImgFailed, setLogoImgFailed] = useState(false);

  async function handleSignOut() {
    await logout();
    setMobileMenuOpen(false);
    navigate(ROUTES.HOME);
  }

  const socialEntries = [
    { label: 'Discord', url: sanitizeExternalHref(settings.socialLinks.discord) },
    { label: 'Instagram', url: sanitizeExternalHref(settings.socialLinks.instagram) },
    { label: 'YouTube', url: sanitizeExternalHref(settings.socialLinks.youtube) },
    { label: 'X', url: sanitizeExternalHref(settings.socialLinks.x) },
  ].filter((entry): entry is { label: string; url: string } => Boolean(entry.url));

  return (
    <div className="min-h-screen flex flex-col bg-[#09090E] text-[#F4F4F8]">
      {settings.announcementEnabled && settings.announcementText.trim() && (
        <div className="bg-violet-600/20 border-b border-violet-500/30 px-4 py-2 text-center text-xs font-medium text-violet-100">
          {settings.announcementText}
        </div>
      )}

      <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#09090E]/92 backdrop-blur-md">
        <div className="mx-auto max-w-[1200px] px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Brand mark + wordmark */}
          <Link
            to={ROUTES.HOME}
            className="inline-flex items-center gap-2.5 font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            {settings.storeLogoUrl && !logoImgFailed ? (
              <img
                src={settings.storeLogoUrl}
                alt={settings.storeName}
                referrerPolicy="no-referrer"
                onError={() => setLogoImgFailed(true)}
                className="h-8 w-8 rounded-lg object-cover border border-white/[0.1]"
              />
            ) : (
              <span className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center text-white">
                <Gamepad2 className="h-4 w-4" aria-hidden="true" />
              </span>
            )}
            <span>{settings.storeName}</span>
          </Link>

          {/* Zone 2: 4 concise single-line navigation links */}
          <nav aria-label="Primary" className="hidden md:flex items-center gap-7">
            {NAV_LINKS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === ROUTES.HOME}
                className={({ isActive }) =>
                  `text-sm font-medium whitespace-nowrap shrink-0 transition-colors border-b-2 py-1 ${
                    isActive
                      ? 'text-white border-violet-500'
                      : 'text-zinc-400 border-transparent hover:text-white'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Zone 3: Single primary account action */}
          <div className="hidden md:flex items-center shrink-0">
            {user ? (
              user.isAdmin ? (
                <Link
                  to={ROUTES.ADMIN_DASHBOARD}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-500 transition-colors whitespace-nowrap shrink-0"
                >
                  Admin Console
                </Link>
              ) : (
                <Link
                  to={ROUTES.ACCOUNT}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-white/[0.14] bg-[#12121A] text-white hover:bg-white/[0.07] transition-colors whitespace-nowrap shrink-0"
                >
                  Account
                </Link>
              )
            ) : (
              <Link
                to={ROUTES.LOGIN}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-500 transition-colors whitespace-nowrap shrink-0"
              >
                Login
              </Link>
            )}
          </div>

          <button
            type="button"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="md:hidden p-2 rounded-lg border border-white/[0.12] text-zinc-200 hover:bg-white/[0.06]"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden border-t border-white/[0.08] bg-[#111118] px-6 py-4 space-y-3">
            <nav aria-label="Mobile Primary" className="flex flex-col space-y-2">
              {NAV_LINKS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === ROUTES.HOME}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `py-2 text-sm font-medium ${isActive ? 'text-white' : 'text-zinc-400'}`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <div className="pt-3 border-t border-white/[0.08] space-y-2">
              {user ? (
                user.isAdmin ? (
                  <Link
                    to={ROUTES.ADMIN_DASHBOARD}
                    onClick={() => setMobileMenuOpen(false)}
                    className="block w-full text-center py-2.5 text-sm font-medium rounded-lg bg-violet-600 text-white"
                  >
                    Admin Console
                  </Link>
                ) : (
                  <>
                    <Link
                      to={ROUTES.ACCOUNT}
                      onClick={() => setMobileMenuOpen(false)}
                      className="block w-full text-center py-2.5 text-sm font-medium rounded-lg bg-violet-600 text-white"
                    >
                      Account
                    </Link>
                    <button
                      type="button"
                      onClick={() => void handleSignOut()}
                      className="w-full py-2.5 text-sm font-medium rounded-lg border border-white/[0.14] text-zinc-200"
                    >
                      Sign Out
                    </button>
                  </>
                )
              ) : (
                <Link
                  to={ROUTES.LOGIN}
                  onClick={() => setMobileMenuOpen(false)}
                  className="block w-full text-center py-2.5 text-sm font-medium rounded-lg bg-violet-600 text-white"
                >
                  Login
                </Link>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-white/[0.08] bg-[#0B0B11] py-12">
        <div className="mx-auto max-w-[1200px] px-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
          <div className="space-y-2.5">
            <div className="font-display text-base font-bold text-white">{settings.storeName}</div>
            <p className="text-xs text-zinc-400 leading-relaxed">{settings.footerDescription}</p>
            {socialEntries.length > 0 && (
              <div className="flex flex-wrap gap-3 pt-1 text-xs text-violet-400">
                {socialEntries.map((s) => (
                  <a
                    key={s.label}
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-violet-300"
                  >
                    {s.label}
                  </a>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2.5">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
              Storefront
            </div>
            <ul className="space-y-2 text-xs text-zinc-400">
              <li>
                <Link to={ROUTES.GAMES} className="hover:text-white transition-colors">
                  All Games
                </Link>
              </li>
              <li>
                <Link to={ROUTES.ORDERS} className="hover:text-white transition-colors">
                  My Orders
                </Link>
              </li>
              <li>
                <Link to={ROUTES.ACCOUNT} className="hover:text-white transition-colors">
                  Customer Account
                </Link>
              </li>
              <li>
                <Link to={ROUTES.ADMIN_LOGIN} className="hover:text-white transition-colors">
                  Admin Portal
                </Link>
              </li>
            </ul>
          </div>

          <div className="space-y-2.5">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
              Policies
            </div>
            <ul className="space-y-2 text-xs text-zinc-400">
              <li>
                <Link to={ROUTES.TERMS} className="hover:text-white transition-colors">
                  Terms and Conditions
                </Link>
              </li>
              <li>
                <Link to={ROUTES.PRIVACY} className="hover:text-white transition-colors">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link to={ROUTES.REFUND_POLICY} className="hover:text-white transition-colors">
                  Refund Policy
                </Link>
              </li>
            </ul>
          </div>

          <div className="space-y-2.5">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
              Customer Support
            </div>
            <div className="space-y-1.5 text-xs text-zinc-400">
              <p>Email: {settings.supportEmail}</p>
              {settings.whatsappContact && <p>WhatsApp: {settings.whatsappContact}</p>}
              <p>Hours: {settings.supportHours}</p>
              <div className="pt-1">
                <Link to={ROUTES.CONTACT} className="text-violet-400 hover:text-violet-300">
                  Open Support Form
                </Link>
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-[1200px] px-6 mt-10 pt-6 border-t border-white/[0.06] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-zinc-500">
          <span>{settings.storeName} · Gaming Top-Up Marketplace</span>
          <span>Payment options will be available soon.</span>
        </div>
      </footer>
    </div>
  );
}
