import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, LogOut, User } from 'lucide-react';
import { ROUTES } from '../../configuration/routes';
import { useAuth } from '../../hooks/useAuth';
import { apiClient } from '../../services/apiClient';
import type { CustomerProfileResponse } from '../../types/api';

export function AccountPage() {
  const { user, logout, refreshAuth } = useAuth();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<CustomerProfileResponse['profile'] | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiClient
      .getCustomerProfile()
      .then((res) => {
        if (!active) return;
        setProfile(res.profile);
        setFullName(res.profile.fullName);
        setPhone(res.profile.phone || '');
      })
      .catch((err) => {
        if (active) {
          setErrorMsg(err instanceof Error ? err.message : 'Unable to load customer profile.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);
    setSavedMsg(null);
    try {
      const res = await apiClient.updateCustomerProfile({
        fullName,
        phone: phone.trim() || null,
      });
      setProfile((prev) =>
        prev ? { ...prev, fullName: res.fullName, phone: res.phone } : prev
      );
      await refreshAuth();
      setSavedMsg('Account details updated.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not save account details.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    await logout();
    navigate(ROUTES.HOME);
  }

  return (
    <div className="mx-auto max-w-[960px] px-6 py-14 space-y-8">
      <div className="border-b border-white/[0.08] pb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-blue-400">Customer Account</div>
          <h1 className="mt-1 font-display text-3xl font-bold text-white">My Account</h1>
        </div>
        <button
          type="button"
          onClick={() => void handleSignOut()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-white/[0.14] text-xs font-medium text-zinc-200 hover:bg-white/[0.06] transition-colors whitespace-nowrap self-start sm:self-auto"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Sign Out</span>
        </button>
      </div>

      {loading ? (
        <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-8 text-sm text-zinc-400">
          Loading account profile...
        </div>
      ) : (
        <div className="grid md:grid-cols-12 gap-6 items-start">
          <div className="md:col-span-5 bg-[#111118] border border-white/[0.08] rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-violet-600/15 text-violet-400 flex items-center justify-center">
                <User className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <div className="font-semibold text-white">{profile?.fullName || user?.fullName}</div>
                <div className="text-xs text-zinc-400">{profile?.email || user?.email}</div>
              </div>
            </div>

            {profile && (
              <dl className="pt-3 border-t border-white/[0.06] space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <dt className="text-zinc-400">Customer Code</dt>
                  <dd className="font-mono text-zinc-200">{profile.customerCode}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-zinc-400">Total Orders</dt>
                  <dd className="font-mono tabular-nums text-white">{profile.totalOrders}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-zinc-400">Store Currency</dt>
                  <dd className="font-mono text-zinc-200">{profile.defaultCurrencyCode}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-zinc-400">Member Since</dt>
                  <dd className="text-zinc-200">
                    {new Date(profile.createdAt).toLocaleDateString('en-IN', {
                      dateStyle: 'medium',
                    })}
                  </dd>
                </div>
              </dl>
            )}

            <div className="pt-3 border-t border-white/[0.06] flex flex-col gap-2">
              <Link
                to={ROUTES.ORDERS}
                className="inline-flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-[#09090E] border border-white/[0.08] text-xs font-medium text-white hover:border-violet-500/40"
              >
                <span>View My Orders</span>
                <ArrowRight className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
              </Link>
              <Link
                to={ROUTES.GAMES}
                className="inline-flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-[#09090E] border border-white/[0.08] text-xs font-medium text-white hover:border-violet-500/40"
              >
                <span>Browse All Games</span>
                <ArrowRight className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
              </Link>
            </div>
          </div>

          <div className="md:col-span-7 bg-[#111118] border border-white/[0.08] rounded-xl p-6 sm:p-8 space-y-5">
            <h2 className="text-base font-semibold text-white">Profile Information</h2>

            {errorMsg && (
              <div
                role="alert"
                className="bg-red-500/10 border border-red-500/30 rounded-lg p-3.5 text-sm text-red-200"
              >
                {errorMsg}
              </div>
            )}

            {savedMsg && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3.5 text-sm text-emerald-200">
                {savedMsg}
              </div>
            )}

            <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="account-email" className="block text-xs font-medium text-zinc-400">
                  Account Email
                </label>
                <input
                  id="account-email"
                  type="email"
                  disabled
                  value={profile?.email || user?.email || ''}
                  className="w-full rounded-lg bg-[#09090E]/60 border border-white/[0.08] px-3.5 py-2.5 text-sm text-zinc-400 cursor-not-allowed"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="account-name" className="block text-xs font-medium text-zinc-300">
                  Full Name
                </label>
                <input
                  id="account-name"
                  type="text"
                  required
                  minLength={2}
                  maxLength={120}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2.5 text-sm text-white focus:border-blue-500"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="account-phone" className="block text-xs font-medium text-zinc-300">
                  Phone Number (Optional)
                </label>
                <input
                  id="account-phone"
                  type="tel"
                  maxLength={24}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Optional contact number"
                  className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500"
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2.5 rounded-lg bg-violet-600 text-sm font-semibold text-white hover:bg-violet-500 transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
