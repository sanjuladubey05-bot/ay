import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Save, ShieldCheck, UserCog } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { AdminLayout } from '../../layouts/AdminLayout';
import { apiClient } from '../../services/apiClient';
import type { AdminProfileResponse } from '../../types/api';

export function AdminProfilePage() {
  const { refreshAuth } = useAuth();
  const [data, setData] = useState<AdminProfileResponse | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .getAdminProfile()
      .then((res) => {
        setData(res);
        setFullName(res.profile.fullName);
        setPhone(res.profile.phone || '');
      })
      .catch((err) =>
        setErrorMsg(err instanceof Error ? err.message : 'Unable to load admin profile.')
      )
      .finally(() => setLoading(false));
  }, []);

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await apiClient.updateAdminProfile({
        fullName: fullName.trim(),
        phone: phone.trim() || null,
      });
      await refreshAuth();
      const updated = await apiClient.getAdminProfile();
      setData(updated);
      setSuccessMsg('Admin profile updated successfully.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to update admin profile.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminLayout title="Admin Profile">
      <div className="space-y-6">
        <div>
          <h2 className="font-display text-2xl font-bold text-white">Administrator Profile</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Inspect your role credentials, update display contact info, and review recent actions.
          </p>
        </div>

        {loading || !data ? (
          <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-8 text-sm text-zinc-400">
            {errorMsg || 'Loading admin profile...'}
          </div>
        ) : (
          <div className="grid lg:grid-cols-12 gap-6">
            <form
              onSubmit={(e) => void handleSaveProfile(e)}
              className="lg:col-span-5 bg-[#111118] border border-white/[0.08] rounded-xl p-6 space-y-5 self-start"
            >
              <div className="flex items-center gap-3 border-b border-white/[0.08] pb-4">
                <div className="h-10 w-10 rounded-lg bg-violet-600/20 border border-violet-500/35 flex items-center justify-center text-violet-300">
                  <UserCog className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">{data.profile.roleName}</div>
                  <div className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{data.profile.isOwner ? 'Store Owner' : data.profile.roleCode}</span>
                  </div>
                </div>
              </div>

              {successMsg && (
                <div
                  role="status"
                  className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-200"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                  <span>{successMsg}</span>
                </div>
              )}

              {errorMsg && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-200"
                >
                  {errorMsg}
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="adm-email" className="block text-xs font-medium text-zinc-400">
                  Admin Email (Read-only)
                </label>
                <input
                  id="adm-email"
                  type="email"
                  disabled
                  value={data.profile.email}
                  className="w-full rounded-lg bg-[#09090E] border border-white/[0.08] px-3.5 py-2 text-sm text-zinc-400"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="adm-name" className="block text-xs font-medium text-zinc-300">
                  Full Name <span className="text-red-400">*</span>
                </label>
                <input
                  id="adm-name"
                  type="text"
                  required
                  minLength={2}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm text-white focus:border-blue-500"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="adm-phone" className="block text-xs font-medium text-zinc-300">
                  Phone (Optional)
                </label>
                <input
                  id="adm-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 ..."
                  className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm font-mono text-white focus:border-blue-500"
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-violet-600 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
              >
                <Save className="h-4 w-4" aria-hidden="true" />
                <span>{saving ? 'Saving Profile...' : 'Save Admin Profile'}</span>
              </button>
            </form>

            <section className="lg:col-span-7 bg-[#111118] border border-white/[0.08] rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Your Recent Admin Actions</h3>
                <span className="text-xs text-zinc-400 tabular-nums">
                  {data.recentActions.length} event(s)
                </span>
              </div>
              {data.recentActions.length === 0 ? (
                <div className="p-8 text-sm text-zinc-400">No recent admin actions logged.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-white/[0.08] text-zinc-400">
                      <tr>
                        <th className="py-3 px-4 font-medium">Timestamp</th>
                        <th className="py-3 px-4 font-medium">Action</th>
                        <th className="py-3 px-4 font-medium">Resource</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      {data.recentActions.map((act) => (
                        <tr key={act.id} className="hover:bg-white/[0.02]">
                          <td className="py-3 px-4 font-mono text-zinc-400 whitespace-nowrap">
                            {new Date(act.created_at).toLocaleString('en-IN')}
                          </td>
                          <td className="py-3 px-4 font-mono text-white">{act.action}</td>
                          <td className="py-3 px-4 text-zinc-400">{act.resource_type}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
