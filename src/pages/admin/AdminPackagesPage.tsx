import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  Copy,
  Edit3,
  Package as PackageIcon,
  Plus,
  Power,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { ConfirmDialog } from '../../components/admin/ConfirmDialog';
import { MediaPickerField } from '../../components/admin/MediaPickerField';
import { AdminLayout } from '../../layouts/AdminLayout';
import { ApiError, apiClient } from '../../services/apiClient';
import type {
  AdminCurrencyItem,
  AdminGameItem,
  AdminPackageItem,
  AdminSupplierItem,
} from '../../types/api';
import { formatInrPrice } from '../../utilities/orderDraft';
import {
  computeNormalizedPackagePricing,
  computeProfitMargin,
  slugifyCatalogText,
} from '../../utilities/pricing';

interface PackageFormState {
  gameId: string;
  gameCurrencyId: string;
  sku: string;
  name: string;
  description: string;
  inGameAmount: string;
  inGameUnit: string;
  priceInr: string;
  originalPriceInr: string;
  bonusBadge: string;
  imageUrl: string | null;
  mediaId: string | null;
  deliveryType: 'manual' | 'automatic' | 'both';
  supplierId: string;
  supplierProductCode: string;
  supplierCostInr: string;
  isFeatured: boolean;
  isActive: boolean;
  sortOrder: number;
}

export function AdminPackagesPage() {
  const [packages, setPackages] = useState<AdminPackageItem[]>([]);
  const [games, setGames] = useState<AdminGameItem[]>([]);
  const [currencies, setCurrencies] = useState<AdminCurrencyItem[]>([]);
  const [suppliers, setSuppliers] = useState<AdminSupplierItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [gameFilter, setGameFilter] = useState('all');
  const [currencyFilter, setCurrencyFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminPackageItem | null>(null);
  const [skuTouched, setSkuTouched] = useState(false);
  const [form, setForm] = useState<PackageFormState>({
    gameId: '',
    gameCurrencyId: '',
    sku: '',
    name: '',
    description: '',
    inGameAmount: '100',
    inGameUnit: 'Diamonds',
    priceInr: '99',
    originalPriceInr: '',
    bonusBadge: '',
    imageUrl: null,
    mediaId: null,
    deliveryType: 'manual',
    supplierId: '',
    supplierProductCode: '',
    supplierCostInr: '0',
    isFeatured: false,
    isActive: true,
    sortOrder: 0,
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<AdminPackageItem | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [pkgRes, gameRes, currRes, supRes] = await Promise.all([
        apiClient.getAdminPackages({
          gameId: gameFilter,
          currencyId: currencyFilter,
          status: statusFilter,
          search: search.trim() || undefined,
        }),
        apiClient.getAdminGames(),
        apiClient.getAdminCurrencies(),
        apiClient.getAdminSuppliers().catch(() => ({ suppliers: [] })),
      ]);
      setPackages(pkgRes.packages);
      setGames(gameRes.games);
      setCurrencies(currRes.currencies);
      setSuppliers(supRes.suppliers);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to load packages.');
    } finally {
      setLoading(false);
    }
  }, [gameFilter, currencyFilter, statusFilter, search]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  function openAddModal() {
    const defaultGameId = gameFilter !== 'all' ? gameFilter : games[0]?.id || '';
    const matchingCurr = currencies.find((c) => c.gameId === defaultGameId) || currencies[0];
    setEditing(null);
    setSkuTouched(false);
    setForm({
      gameId: defaultGameId,
      gameCurrencyId: matchingCurr?.id || '',
      sku: '',
      name: '',
      description: '',
      inGameAmount: '100',
      inGameUnit: matchingCurr?.name || 'Coins',
      priceInr: '99',
      originalPriceInr: '',
      bonusBadge: '',
      imageUrl: null,
      mediaId: null,
      deliveryType: 'manual',
      supplierId: '',
      supplierProductCode: '',
      supplierCostInr: '0',
      isFeatured: false,
      isActive: true,
      sortOrder: packages.length + 1,
    });
    setFormError(null);
    setModalOpen(true);
  }

  function openEditModal(pkg: AdminPackageItem) {
    setEditing(pkg);
    setSkuTouched(true);
    setForm({
      gameId: pkg.gameId,
      gameCurrencyId: pkg.gameCurrencyId || '',
      sku: pkg.sku,
      name: pkg.name,
      description: pkg.description || '',
      inGameAmount: String(pkg.inGameAmount),
      inGameUnit: pkg.inGameUnit,
      priceInr: String(pkg.priceInr),
      originalPriceInr: pkg.originalPriceInr !== null ? String(pkg.originalPriceInr) : '',
      bonusBadge: pkg.bonusBadge || '',
      imageUrl: pkg.imageUrl,
      mediaId: pkg.mediaId,
      deliveryType: pkg.deliveryType,
      supplierId: pkg.supplierId || '',
      supplierProductCode: pkg.supplierProductCode || '',
      supplierCostInr: String(pkg.supplierCostInr || 0),
      isFeatured: pkg.isFeatured,
      isActive: pkg.isActive,
      sortOrder: pkg.sortOrder,
    });
    setFormError(null);
    setModalOpen(true);
  }

  function computePreviewPricing() {
    const price = Number(form.priceInr);
    const original = form.originalPriceInr.trim() ? Number(form.originalPriceInr) : null;
    return computeNormalizedPackagePricing({
      priceInr: Number.isFinite(price) ? price : undefined,
      originalPriceInr: original,
    });
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSuccessMsg(null);

    if (!form.gameId) {
      setFormError('Please select a game.');
      return;
    }
    if (!form.name.trim()) {
      setFormError('Package name is required.');
      return;
    }

    const amount = Number.parseInt(form.inGameAmount, 10);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError('Quantity / amount must be a positive whole number.');
      return;
    }

    const pricing = computePreviewPricing();
    if (!pricing.valid) {
      setFormError(pricing.error || 'Please verify selling price and original price.');
      return;
    }

    const generatedSku =
      form.sku.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '-') ||
      `${slugifyCatalogText(form.name).toUpperCase()}-${Date.now().toString().slice(-4)}`;

    setSaving(true);
    try {
      const payload = {
        gameId: form.gameId,
        gameCurrencyId: form.gameCurrencyId || null,
        sku: generatedSku,
        name: form.name.trim(),
        description: form.description.trim(),
        inGameAmount: amount,
        inGameUnit: form.inGameUnit.trim() || 'Units',
        priceInr: pricing.priceInr,
        originalPriceInr: pricing.originalPriceInr,
        discountPercent: pricing.discountPercent,
        bonusBadge: form.bonusBadge.trim(),
        imageUrl: form.imageUrl,
        mediaId: form.mediaId,
        deliveryType: form.deliveryType,
        supplierId: form.supplierId || null,
        supplierProductCode: form.supplierProductCode.trim(),
        supplierCostInr: Number.parseFloat(form.supplierCostInr || '0') || 0,
        isFeatured: form.isFeatured,
        isActive: form.isActive,
        sortOrder: Number.isFinite(form.sortOrder) ? form.sortOrder : 0,
      };

      if (editing) {
        await apiClient.updateAdminPackage(editing.id, payload);
        setSuccessMsg(`Package "${payload.name}" updated.`);
      } else {
        await apiClient.createAdminPackage(payload);
        setSuccessMsg(`Package "${payload.name}" created.`);
      }
      setModalOpen(false);
      await loadData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save package.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDuplicate(pkg: AdminPackageItem) {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await apiClient.duplicateAdminPackage(pkg.id);
      setSuccessMsg(`Duplicated "${pkg.name}" as "${res.package.name}".`);
      await loadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to duplicate package.');
    }
  }

  async function handleToggleActive(pkg: AdminPackageItem) {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await apiClient.updateAdminPackage(pkg.id, { isActive: !pkg.isActive });
      setSuccessMsg(`Package "${pkg.name}" ${!pkg.isActive ? 'enabled' : 'disabled'}.`);
      await loadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to update package status.');
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await apiClient.deleteAdminPackage(deleteTarget.id);
      setSuccessMsg(`Package "${deleteTarget.name}" deleted.`);
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setDeleteError(err.message);
      } else {
        setDeleteError(err instanceof Error ? err.message : 'Unable to delete package.');
      }
    } finally {
      setDeleteLoading(false);
    }
  }

  async function handleDisableInstead() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await apiClient.updateAdminPackage(deleteTarget.id, { isActive: false });
      setSuccessMsg(`Package "${deleteTarget.name}" disabled.`);
      setDeleteTarget(null);
      setDeleteError(null);
      await loadData();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Unable to disable package.');
    } finally {
      setDeleteLoading(false);
    }
  }

  const previewPricing = computePreviewPricing();
  const gameScopedCurrencies = form.gameId
    ? currencies.filter((c) => !c.gameId || c.gameId === form.gameId)
    : currencies;

  return (
    <AdminLayout title="Package Management">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-white">Packages Catalog</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Create, edit, duplicate, price, enable, disable, or safely delete top-up packages for
              any game.
            </p>
          </div>
          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-violet-600 text-xs font-semibold text-white hover:bg-violet-500 transition-colors whitespace-nowrap self-start"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>Add Package</span>
          </button>
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

        {/* Filters */}
        <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-4 grid md:grid-cols-4 gap-3">
          <div className="relative md:col-span-1">
            <Search
              className="h-4 w-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search packages or SKU..."
              aria-label="Search packages"
              className="w-full rounded-lg bg-[#09090E] border border-white/[0.12] pl-9 pr-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-blue-500"
            />
          </div>

          <select
            value={gameFilter}
            onChange={(e) => setGameFilter(e.target.value)}
            aria-label="Filter packages by game"
            className="rounded-lg bg-[#09090E] border border-white/[0.12] px-3 py-2 text-sm text-white focus:border-blue-500"
          >
            <option value="all">All Games</option>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>

          <select
            value={currencyFilter}
            onChange={(e) => setCurrencyFilter(e.target.value)}
            aria-label="Filter packages by currency"
            className="rounded-lg bg-[#09090E] border border-white/[0.12] px-3 py-2 text-sm text-white focus:border-blue-500"
          >
            <option value="all">All Currencies</option>
            {currencies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter packages by status"
            className="rounded-lg bg-[#09090E] border border-white/[0.12] px-3 py-2 text-sm text-white focus:border-blue-500"
          >
            <option value="all">All Statuses</option>
            <option value="active">Enabled Only</option>
            <option value="inactive">Disabled Only</option>
          </select>
        </div>

        {/* Table */}
        <div className="bg-[#111118] border border-white/[0.08] rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-8 text-sm text-zinc-400">Loading packages...</div>
          ) : packages.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <p className="text-sm font-semibold text-white">No packages match your filters</p>
              <button
                type="button"
                onClick={openAddModal}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 text-xs font-semibold text-white hover:bg-violet-500"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Add Package</span>
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/[0.08] text-zinc-400">
                  <tr>
                    <th className="py-3.5 px-4 font-medium">Package</th>
                    <th className="py-3.5 px-4 font-medium">Game &amp; Currency</th>
                    <th className="py-3.5 px-4 font-medium text-right">Quantity</th>
                    <th className="py-3.5 px-4 font-medium text-right">Selling Price</th>
                    <th className="py-3.5 px-4 font-medium">Status</th>
                    <th className="py-3.5 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {packages.map((pkg) => {
                    const margin = computeProfitMargin({
                      sellingPriceInr: pkg.priceInr,
                      supplierCostInr: pkg.supplierCostInr,
                    });
                    return (
                    <tr key={pkg.id} className="hover:bg-white/[0.02]">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3 min-w-[200px]">
                          <div className="h-10 w-10 rounded-lg overflow-hidden bg-[#09090E] border border-white/[0.08] shrink-0 flex items-center justify-center">
                            {pkg.imageUrl ? (
                              <img
                                src={pkg.imageUrl}
                                alt={pkg.name}
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <PackageIcon className="h-4 w-4 text-violet-400" aria-hidden="true" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-sm font-semibold text-white truncate">
                                {pkg.name}
                              </span>
                              {pkg.bonusBadge && (
                                <span className="rounded-md border border-blue-500/35 bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-blue-300">
                                  {pkg.bonusBadge}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] font-mono text-zinc-400 truncate">
                              {pkg.sku}
                              {pkg.isFeatured ? ' · Featured' : ''}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="text-zinc-200 font-medium">{pkg.gameTitle}</div>
                        <div className="text-[11px] text-zinc-400">
                          {pkg.gameCurrencyName || pkg.inGameUnit} ·{' '}
                          <span className="capitalize">
                            {pkg.deliveryType === 'both' ? 'Manual + Auto' : pkg.deliveryType}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-right text-zinc-200 whitespace-nowrap">
                        {pkg.inGameAmount.toLocaleString('en-IN')} {pkg.inGameUnit}
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="font-mono tabular-nums font-semibold text-white">
                          {formatInrPrice(pkg.priceInr)}
                        </div>
                        {pkg.originalPriceInr && pkg.discountPercent > 0 && (
                          <div className="text-[11px] font-mono tabular-nums text-zinc-400">
                            <span className="line-through mr-1">
                              {formatInrPrice(pkg.originalPriceInr)}
                            </span>
                            <span className="text-emerald-400">-{pkg.discountPercent}%</span>
                          </div>
                        )}
                        <div className="text-[11px] font-mono tabular-nums text-zinc-500">
                          Cost {formatInrPrice(pkg.supplierCostInr)} ·{' '}
                          <span className={margin.netProfitInr >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                            {margin.marginPercent.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => void handleToggleActive(pkg)}
                          aria-label={`Toggle status for ${pkg.name}`}
                          className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            pkg.isActive
                              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
                              : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400'
                          }`}
                        >
                          <Power className="h-3 w-3" aria-hidden="true" />
                          <span>{pkg.isActive ? 'Enabled' : 'Disabled'}</span>
                        </button>
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditModal(pkg)}
                            aria-label={`Edit ${pkg.name}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/[0.12] text-zinc-200 hover:bg-white/[0.06]"
                          >
                            <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDuplicate(pkg)}
                            aria-label={`Duplicate ${pkg.name}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/[0.12] text-zinc-200 hover:bg-white/[0.06]"
                          >
                            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Duplicate</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteError(null);
                              setDeleteTarget(pkg);
                            }}
                            aria-label={`Delete ${pkg.name}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-500/25 text-red-300 hover:bg-red-500/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Delete</span>
                          </button>
                        </div>
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

      {/* Add / Edit Package Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="package-modal-title"
        >
          <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border border-white/[0.12] bg-[#111118] overflow-hidden">
            <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between gap-4">
              <h3 id="package-modal-title" className="text-base font-semibold text-white">
                {editing ? `Edit Package: ${editing.name}` : 'Create Top-Up Package'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close package form"
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSave(e)}
              className="flex-1 overflow-y-auto p-6 space-y-4"
            >
              {formError && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200"
                >
                  {formError}
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="pkg-game" className="block text-xs font-medium text-zinc-300">
                    Game <span className="text-red-400">*</span>
                  </label>
                  <select
                    id="pkg-game"
                    required
                    value={form.gameId}
                    onChange={(e) => {
                      const nextGameId = e.target.value;
                      const matchedCurr = currencies.find((c) => c.gameId === nextGameId);
                      setForm((prev) => ({
                        ...prev,
                        gameId: nextGameId,
                        gameCurrencyId: matchedCurr?.id || prev.gameCurrencyId,
                        inGameUnit: matchedCurr?.name || prev.inGameUnit,
                      }));
                    }}
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-2 text-sm text-white focus:border-blue-500"
                  >
                    <option value="">Select Game</option>
                    {games.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="pkg-currency" className="block text-xs font-medium text-zinc-300">
                    In-Game Currency
                  </label>
                  <select
                    id="pkg-currency"
                    value={form.gameCurrencyId}
                    onChange={(e) => {
                      const curr = currencies.find((c) => c.id === e.target.value);
                      setForm((prev) => ({
                        ...prev,
                        gameCurrencyId: e.target.value,
                        inGameUnit: curr?.name || prev.inGameUnit,
                      }));
                    }}
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-2 text-sm text-white focus:border-blue-500"
                  >
                    <option value="">None / Custom Unit</option>
                    {gameScopedCurrencies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.code})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="pkg-name" className="block text-xs font-medium text-zinc-300">
                    Package Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="pkg-name"
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => {
                      const name = e.target.value;
                      setForm((prev) => ({
                        ...prev,
                        name,
                        sku: skuTouched
                          ? prev.sku
                          : slugifyCatalogText(name).toUpperCase(),
                      }));
                    }}
                    placeholder="e.g. 1,000 VP"
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm text-white focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="pkg-sku" className="block text-xs font-medium text-zinc-300">
                    SKU Code <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="pkg-sku"
                    type="text"
                    required
                    value={form.sku}
                    onChange={(e) => {
                      setSkuTouched(true);
                      setForm((prev) => ({ ...prev, sku: e.target.value.toUpperCase() }));
                    }}
                    placeholder="e.g. VAL-1000VP"
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm font-mono text-white focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="pkg-amount" className="block text-xs font-medium text-zinc-300">
                    Quantity <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="pkg-amount"
                    type="number"
                    required
                    min={1}
                    value={form.inGameAmount}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, inGameAmount: e.target.value }))
                    }
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-2 text-sm font-mono text-white focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="pkg-unit" className="block text-xs font-medium text-zinc-300">
                    Unit Label <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="pkg-unit"
                    type="text"
                    required
                    value={form.inGameUnit}
                    onChange={(e) => setForm((prev) => ({ ...prev, inGameUnit: e.target.value }))}
                    placeholder="Diamonds, UC..."
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-2 text-sm text-white focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="pkg-price" className="block text-xs font-medium text-zinc-300">
                    Selling Price (INR) <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="pkg-price"
                    type="number"
                    required
                    min={1}
                    step="0.01"
                    value={form.priceInr}
                    onChange={(e) => setForm((prev) => ({ ...prev, priceInr: e.target.value }))}
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-2 text-sm font-mono text-white focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="pkg-orig-price" className="block text-xs font-medium text-zinc-300">
                    Original Price (Opt.)
                  </label>
                  <input
                    id="pkg-orig-price"
                    type="number"
                    min={1}
                    step="0.01"
                    value={form.originalPriceInr}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, originalPriceInr: e.target.value }))
                    }
                    placeholder="MRP"
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-2 text-sm font-mono text-white focus:border-blue-500"
                  />
                </div>
              </div>

              {previewPricing.valid && previewPricing.discountPercent > 0 && (
                <div className="text-xs text-emerald-400 font-mono tabular-nums">
                  Calculated Discount: {previewPricing.discountPercent}% OFF (₹
                  {previewPricing.originalPriceInr} → ₹{previewPricing.priceInr})
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="pkg-desc" className="block text-xs font-medium text-zinc-300">
                    Description (Optional)
                  </label>
                  <input
                    id="pkg-desc"
                    type="text"
                    value={form.description}
                    onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                    placeholder="Optional bonus note or bundle highlight"
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm text-white focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="pkg-bonus-badge" className="block text-xs font-medium text-zinc-300">
                    Bonus Badge (Optional)
                  </label>
                  <input
                    id="pkg-bonus-badge"
                    type="text"
                    maxLength={40}
                    value={form.bonusBadge}
                    onChange={(e) => setForm((prev) => ({ ...prev, bonusBadge: e.target.value }))}
                    placeholder="e.g. +10% Extra, Best Value"
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm text-white focus:border-blue-500"
                  />
                </div>
              </div>

              <MediaPickerField
                label="Package Image"
                imageUrl={form.imageUrl}
                mediaId={form.mediaId}
                onChange={({ imageUrl, mediaId }) =>
                  setForm((prev) => ({ ...prev, imageUrl, mediaId }))
                }
              />

              <div className="grid sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="pkg-status" className="block text-xs font-medium text-zinc-300">
                    Status
                  </label>
                  <select
                    id="pkg-status"
                    value={form.isActive ? 'enabled' : 'disabled'}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, isActive: e.target.value === 'enabled' }))
                    }
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-2 text-sm text-white focus:border-blue-500"
                  >
                    <option value="enabled">Enabled</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="pkg-featured" className="block text-xs font-medium text-zinc-300">
                    Featured Package
                  </label>
                  <select
                    id="pkg-featured"
                    value={form.isFeatured ? 'featured' : 'standard'}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, isFeatured: e.target.value === 'featured' }))
                    }
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-2 text-sm text-white focus:border-blue-500"
                  >
                    <option value="standard">Standard</option>
                    <option value="featured">Featured Highlight</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="pkg-sort" className="block text-xs font-medium text-zinc-300">
                    Display Order
                  </label>
                  <input
                    id="pkg-sort"
                    type="number"
                    min={0}
                    max={9999}
                    value={form.sortOrder}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        sortOrder: Number.parseInt(e.target.value || '0', 10) || 0,
                      }))
                    }
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm font-mono text-white focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-3 gap-4 pt-1 border-t border-white/[0.08]">
                <div className="space-y-1.5">
                  <label htmlFor="pkg-delivery" className="block text-xs font-medium text-zinc-300">
                    Delivery Method
                  </label>
                  <select
                    id="pkg-delivery"
                    value={form.deliveryType}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        deliveryType: e.target.value as 'manual' | 'automatic' | 'both',
                      }))
                    }
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-2 text-sm text-white focus:border-blue-500"
                  >
                    <option value="manual">Manual Only</option>
                    <option value="automatic">Automatic (Supplier API)</option>
                    <option value="both">Both (Manual &amp; Automatic)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="pkg-supplier" className="block text-xs font-medium text-zinc-300">
                    Assigned Supplier (Opt.)
                  </label>
                  <select
                    id="pkg-supplier"
                    value={form.supplierId}
                    onChange={(e) => setForm((prev) => ({ ...prev, supplierId: e.target.value }))}
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-2 text-sm text-white focus:border-blue-500"
                  >
                    <option value="">Use Game Default</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.mode === 'mock' ? 'MOCK' : 'LIVE'})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="pkg-supplier-sku"
                    className="block text-xs font-medium text-zinc-300"
                  >
                    Supplier SKU / Cost
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      id="pkg-supplier-sku"
                      type="text"
                      value={form.supplierProductCode}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, supplierProductCode: e.target.value }))
                      }
                      placeholder="EXT-SKU"
                      aria-label="Supplier external product code"
                      className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-2.5 py-2 text-xs font-mono text-white focus:border-blue-500"
                    />
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={form.supplierCostInr}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, supplierCostInr: e.target.value }))
                      }
                      placeholder="Cost ₹"
                      aria-label="Supplier cost in INR"
                      className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-2.5 py-2 text-xs font-mono text-white focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-white/[0.08] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-white/[0.14] text-xs font-medium text-zinc-200 hover:bg-white/[0.06]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-lg bg-violet-600 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editing ? 'Save Package' : 'Create Package'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete Package: ${deleteTarget?.name || ''}?`}
        message="Packages referenced by past customer orders cannot be deleted to preserve invoice history and can be disabled instead."
        confirmLabel="Delete Package"
        destructive
        loading={deleteLoading}
        errorMessage={deleteError}
        secondaryActionLabel={deleteError ? 'Disable Package Instead' : undefined}
        onSecondaryAction={deleteError ? () => void handleDisableInstead() : undefined}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
      />
    </AdminLayout>
  );
}
