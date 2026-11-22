import { useCallback, useEffect, useState } from 'react';
import { Check, CheckCircle2, Edit3, Search, X } from 'lucide-react';
import { AdminLayout } from '../../layouts/AdminLayout';
import { apiClient } from '../../services/apiClient';
import type { AdminCurrencyItem, AdminPackageItem } from '../../types/api';
import { formatInrPrice } from '../../utilities/orderDraft';
import { computeNormalizedPackagePricing, computeProfitMargin } from '../../utilities/pricing';

interface InlineDraft {
  priceInr: string;
  originalPriceInr: string;
  supplierCostInr: string;
  bonusBadge: string;
}

export function AdminPricingPage() {
  const [packages, setPackages] = useState<AdminPackageItem[]>([]);
  const [currencies, setCurrencies] = useState<AdminCurrencyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [currencyFilter, setCurrencyFilter] = useState('all');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<InlineDraft>({
    priceInr: '',
    originalPriceInr: '',
    supplierCostInr: '',
    bonusBadge: '',
  });
  const [savingId, setSavingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [pkgRes, currRes] = await Promise.all([
        apiClient.getAdminPackages({
          currencyId: currencyFilter,
          search: search.trim() || undefined,
        }),
        apiClient.getAdminCurrencies(),
      ]);
      setPackages(pkgRes.packages);
      setCurrencies(currRes.currencies);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to load pricing table.');
    } finally {
      setLoading(false);
    }
  }, [currencyFilter, search]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  function startEdit(pkg: AdminPackageItem) {
    setEditingId(pkg.id);
    setDraft({
      priceInr: String(pkg.priceInr),
      originalPriceInr: pkg.originalPriceInr !== null ? String(pkg.originalPriceInr) : '',
      supplierCostInr: String(pkg.supplierCostInr ?? 0),
      bonusBadge: pkg.bonusBadge || '',
    });
    setErrorMsg(null);
    setSuccessMsg(null);
  }

  async function savePrice(pkg: AdminPackageItem) {
    setErrorMsg(null);
    setSuccessMsg(null);

    const parsedPrice = Number(draft.priceInr);
    const parsedOriginal = draft.originalPriceInr.trim()
      ? Number(draft.originalPriceInr)
      : null;
    const parsedCost = draft.supplierCostInr.trim() ? Number(draft.supplierCostInr) : 0;
    if (!Number.isFinite(parsedCost) || parsedCost < 0) {
      setErrorMsg('Supplier cost in INR cannot be negative.');
      return;
    }

    const computed = computeNormalizedPackagePricing({
      priceInr: Number.isFinite(parsedPrice) ? parsedPrice : undefined,
      originalPriceInr: parsedOriginal,
    });

    if (!computed.valid) {
      setErrorMsg(computed.error || 'Invalid pricing values.');
      return;
    }

    setSavingId(pkg.id);
    try {
      const updated = await apiClient.updateAdminPackagePrice(pkg.id, {
        priceInr: computed.priceInr,
        originalPriceInr: computed.originalPriceInr,
        discountPercent: computed.discountPercent,
        supplierCostInr: parsedCost,
        bonusBadge: draft.bonusBadge.trim(),
      });
      setPackages((prev) =>
        prev.map((row) =>
          row.id === pkg.id
            ? {
                ...row,
                priceInr: updated.priceInr,
                originalPriceInr: updated.originalPriceInr,
                discountPercent: updated.discountPercent,
                supplierCostInr: updated.supplierCostInr,
                bonusBadge: updated.bonusBadge,
              }
            : row
        )
      );
      setEditingId(null);
      setSuccessMsg(
        `Updated "${pkg.name}" selling price to ${formatInrPrice(updated.priceInr)} (Net Profit ${formatInrPrice(
          updated.netProfitInr
        )}, Margin ${updated.marginPercent.toFixed(1)}%).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to update package price.');
    } finally {
      setSavingId(null);
    }
  }

  const liveDraftCheck = editingId
    ? computeNormalizedPackagePricing({
        priceInr: Number(draft.priceInr),
        originalPriceInr: draft.originalPriceInr.trim() ? Number(draft.originalPriceInr) : null,
      })
    : null;

  const liveDraftMargin = editingId
    ? computeProfitMargin({
        sellingPriceInr: Number(draft.priceInr) || 0,
        supplierCostInr: Number(draft.supplierCostInr) || 0,
      })
    : null;

  return (
    <AdminLayout title="Price Management">
      <div className="space-y-6">
        <div>
          <h2 className="font-display text-2xl font-bold text-white">Price &amp; Margin Control (INR)</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Update package selling prices, MRP discounts, supplier wholesale costs, and promotional
            bonus badges in INR. Margins recalculate immediately.
          </p>
        </div>

        {successMsg && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
            <span>{successMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-200"
          >
            {errorMsg}
          </div>
        )}

        <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-4 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search
              className="h-4 w-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by game or package name..."
              aria-label="Search packages for pricing"
              className="w-full rounded-lg bg-[#09090E] border border-white/[0.12] pl-9 pr-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-blue-500"
            />
          </div>

          <select
            value={currencyFilter}
            onChange={(e) => setCurrencyFilter(e.target.value)}
            aria-label="Filter pricing by currency"
            className="rounded-lg bg-[#09090E] border border-white/[0.12] px-3 py-2 text-sm text-white focus:border-blue-500"
          >
            <option value="all">All Currencies</option>
            {currencies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
        </div>

        <div className="bg-[#111118] border border-white/[0.08] rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-8 text-sm text-zinc-400">Loading package pricing...</div>
          ) : packages.length === 0 ? (
            <div className="p-10 text-center text-sm text-zinc-400">
              No packages found matching your filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/[0.08] text-zinc-400">
                  <tr>
                    <th className="py-3.5 px-4 font-medium">Game &amp; Package</th>
                    <th className="py-3.5 px-4 font-medium">Bonus Badge</th>
                    <th className="py-3.5 px-4 font-medium text-right">Original (INR)</th>
                    <th className="py-3.5 px-4 font-medium text-right">Selling (INR)</th>
                    <th className="py-3.5 px-4 font-medium text-right">Supplier Cost</th>
                    <th className="py-3.5 px-4 font-medium text-right">Net Profit / Margin</th>
                    <th className="py-3.5 px-4 font-medium text-right">Discount</th>
                    <th className="py-3.5 px-4 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {packages.map((pkg) => {
                    const isEditing = editingId === pkg.id;
                    const isSaving = savingId === pkg.id;
                    const rowMargin = computeProfitMargin({
                      sellingPriceInr: pkg.priceInr,
                      supplierCostInr: pkg.supplierCostInr,
                    });
                    const displayedMargin = isEditing && liveDraftMargin ? liveDraftMargin : rowMargin;

                    return (
                      <tr key={pkg.id} className="hover:bg-white/[0.02]">
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-white">{pkg.name}</div>
                          <div className="text-[11px] text-zinc-400">
                            {pkg.gameTitle} ·{' '}
                            <span className="font-mono">
                              {pkg.inGameAmount.toLocaleString('en-IN')} {pkg.inGameUnit}
                            </span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {isEditing ? (
                            <input
                              type="text"
                              maxLength={40}
                              value={draft.bonusBadge}
                              onChange={(e) =>
                                setDraft((prev) => ({ ...prev, bonusBadge: e.target.value }))
                              }
                              aria-label={`Bonus badge for ${pkg.name}`}
                              placeholder="+10% Extra"
                              className="w-28 rounded-md bg-[#09090E] border border-white/[0.2] px-2.5 py-1.5 text-xs text-white"
                            />
                          ) : pkg.bonusBadge ? (
                            <span className="rounded-md border border-blue-500/35 bg-blue-500/15 px-2 py-0.5 text-[11px] font-medium text-blue-300">
                              {pkg.bonusBadge}
                            </span>
                          ) : (
                            <span className="text-zinc-500">—</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                          {isEditing ? (
                            <input
                              type="number"
                              min={1}
                              step="0.01"
                              value={draft.originalPriceInr}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  originalPriceInr: e.target.value,
                                }))
                              }
                              aria-label={`Original price INR for ${pkg.name}`}
                              placeholder="Optional"
                              className="w-24 rounded-md bg-[#09090E] border border-white/[0.2] px-2.5 py-1.5 text-right text-xs font-mono text-white"
                            />
                          ) : pkg.originalPriceInr !== null ? (
                            <span className="text-zinc-400 line-through">
                              {formatInrPrice(pkg.originalPriceInr)}
                            </span>
                          ) : (
                            <span className="text-zinc-500">—</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                          {isEditing ? (
                            <input
                              type="number"
                              min={1}
                              step="0.01"
                              value={draft.priceInr}
                              onChange={(e) =>
                                setDraft((prev) => ({ ...prev, priceInr: e.target.value }))
                              }
                              aria-label={`Selling price INR for ${pkg.name}`}
                              className="w-24 rounded-md bg-[#09090E] border border-violet-500/60 px-2.5 py-1.5 text-right text-xs font-mono text-white"
                            />
                          ) : (
                            <span className="font-semibold text-white">
                              {formatInrPrice(pkg.priceInr)}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                          {isEditing ? (
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={draft.supplierCostInr}
                              onChange={(e) =>
                                setDraft((prev) => ({ ...prev, supplierCostInr: e.target.value }))
                              }
                              aria-label={`Supplier cost INR for ${pkg.name}`}
                              className="w-24 rounded-md bg-[#09090E] border border-white/[0.2] px-2.5 py-1.5 text-right text-xs font-mono text-white"
                            />
                          ) : (
                            <span className="text-zinc-300">
                              {formatInrPrice(pkg.supplierCostInr)}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                          <div
                            className={`font-semibold ${
                              displayedMargin.netProfitInr >= 0
                                ? 'text-emerald-400'
                                : 'text-red-400'
                            }`}
                          >
                            {formatInrPrice(displayedMargin.netProfitInr)}
                          </div>
                          <div className="text-[11px] text-zinc-400">
                            {displayedMargin.marginPercent.toFixed(1)}%
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                          {isEditing ? (
                            liveDraftCheck?.valid && liveDraftCheck.discountPercent > 0 ? (
                              <span className="text-emerald-400">
                                {liveDraftCheck.discountPercent}% OFF
                              </span>
                            ) : (
                              <span className="text-zinc-500">0%</span>
                            )
                          ) : pkg.discountPercent > 0 ? (
                            <span className="text-emerald-400">{pkg.discountPercent}% OFF</span>
                          ) : (
                            <span className="text-zinc-500">0%</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          {isEditing ? (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={isSaving}
                                onClick={() => void savePrice(pkg)}
                                aria-label={`Save price for ${pkg.name}`}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-600 text-white font-semibold hover:bg-violet-500 disabled:opacity-50"
                              >
                                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>{isSaving ? 'Saving...' : 'Save'}</span>
                              </button>
                              <button
                                type="button"
                                disabled={isSaving}
                                onClick={() => setEditingId(null)}
                                aria-label={`Cancel editing ${pkg.name}`}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/[0.14] text-zinc-300 hover:bg-white/[0.06]"
                              >
                                <X className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Cancel</span>
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => startEdit(pkg)}
                              aria-label={`Edit price for ${pkg.name}`}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-white/[0.12] text-zinc-200 hover:bg-white/[0.06]"
                            >
                              <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Edit Price</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
