import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Search, ShieldCheck, Users } from 'lucide-react';
import { AdminLayout } from '../../layouts/AdminLayout';
import { apiClient } from '../../services/apiClient';
import type { AdminCustomerItem } from '../../types/api';

export function AdminCustomersPage() {
  const [customers, setCustomers] = useState<AdminCustomerItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiClient.getAdminCustomers(search.trim() || undefined);
      setCustomers(res.customers);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to load customers.');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  return (
    <AdminLayout title="Customers">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-white">Customers Directory</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Registered customer profiles, account verification statuses, and order counts.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadCustomers()}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-white/[0.14] text-xs font-medium text-zinc-200 hover:bg-white/[0.05] self-start whitespace-nowrap"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </div>

        <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-4">
          <div className="relative max-w-md">
            <Search
              className="h-4 w-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer name, email, or code..."
              aria-label="Search customers"
              className="w-full rounded-lg bg-[#09090E] border border-white/[0.12] pl-9 pr-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-blue-500"
            />
          </div>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-200"
          >
            {errorMsg}
          </div>
        )}

        <div className="bg-[#111118] border border-white/[0.08] rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-8 text-sm text-zinc-400">Loading customers...</div>
          ) : customers.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <Users className="h-7 w-7 text-zinc-500 mx-auto" aria-hidden="true" />
              <p className="text-sm font-semibold text-white">No customers registered yet</p>
              <p className="text-xs text-zinc-400">
                Customer records appear automatically once users register or submit orders.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/[0.08] text-zinc-400">
                  <tr>
                    <th className="py-3.5 px-4 font-medium">Customer</th>
                    <th className="py-3.5 px-4 font-medium">Customer Code</th>
                    <th className="py-3.5 px-4 font-medium">Phone</th>
                    <th className="py-3.5 px-4 font-medium">Status</th>
                    <th className="py-3.5 px-4 font-medium text-right">Orders</th>
                    <th className="py-3.5 px-4 font-medium">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {customers.map((c) => (
                    <tr key={c.id} className="hover:bg-white/[0.02]">
                      <td className="py-3.5 px-4">
                        <div className="text-sm font-semibold text-white">{c.fullName}</div>
                        <div className="text-[11px] text-zinc-400">{c.email}</div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-zinc-300">{c.customerCode}</td>
                      <td className="py-3.5 px-4 font-mono text-zinc-400">{c.phone || '—'}</td>
                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300 capitalize">
                          <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                          <span>{c.accountStatus}</span>
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-right font-semibold text-white">
                        {c.totalOrders}
                      </td>
                      <td className="py-3.5 px-4 text-zinc-400 whitespace-nowrap">
                        {new Date(c.createdAt).toLocaleDateString('en-IN', {
                          dateStyle: 'medium',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
