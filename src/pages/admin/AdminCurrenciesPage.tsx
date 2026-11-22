import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Coins, Edit3, Plus, Power, Search, Trash2, X } from 'lucide-react';
import { ConfirmDialog } from '../../components/admin/ConfirmDialog';
import { MediaPickerField } from '../../components/admin/MediaPickerField';
import { AdminLayout } from '../../layouts/AdminLayout';
import { ApiError, apiClient } from '../../services/apiClient';
import type { AdminCurrencyItem, AdminGameItem } from '../../types/api';

interface CurrencyFormState {
  code: string;
  name: string;
  symbol: string;
  description: string;
  imageUrl: string | null;
  mediaId: string | null;
  gameId: string;
  isActive: boolean;
  sortOrder: number;
}

function emptyCurrencyForm(nextOrder: number): CurrencyFormState {
  return {
    code: '',
    name: '',
    symbol: '',
    description: '',
    imageUrl: null,
    mediaId: null,
    gameId: '',
    isActive: true,
    sortOrder: nextOrder,
  };
}

export function AdminCurrenciesPage() {
  const [currencies, setCurrencies] = useState<AdminCurrencyItem[]>([]);
  const [games, setGames] = useState<AdminGameItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [gameFilter, setGameFilter] = useState('all');

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminCurrencyItem | null>(null);
  const [form, setForm] = useState<CurrencyFormState>(() => emptyCurrencyForm(0));
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<AdminCurrencyItem | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [currRes, gamesRes] = await Promise.all([
        apiClient.getAdminCurrencies(),
        apiClient.getAdminGames(),
      ]);
      setCurrencies(currRes.currencies);
      setGames(gamesRes.games);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to load currencies.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  function openAddModal() {
    setEditing(null);
    setForm(emptyCurrencyForm(currencies.length + 1));
    setFormError(null);
    setModalOpen(true);
  }

  function openEditModal(item: AdminCurrencyItem) {
    setEditing(item);
    setForm({
      code: item.code,
      name: item.name,
      symbol: item.symbol,
      description: item.description || '',
      imageUrl: item.imageUrl,
      mediaId: item.mediaId,
      gameId: item.gameId || '',
      isActive: item.isActive,
      sortOrder: item.sortOrder,
    });
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSuccessMsg(null);

    if (!form.name.trim() || !form.code.trim()) {
      setFormError('Currency name and short code are required.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        symbol: (form.symbol.trim() || form.code.trim().toUpperCase()).slice(0, 12),
        description: form.description.trim(),
        imageUrl: form.imageUrl,
        mediaId: form.mediaId,
        gameId: form.gameId || null,
        isActive: form.isActive,
        sortOrder: Number.isFinite(form.sortOrder) ? form.sortOrder : 0,
      };

      if (editing) {
        await apiClient.updateAdminCurrency(editing.id, payload);
        setSuccessMsg(`Currency "${payload.name}" updated.`);
      } else {
        await apiClient.createAdminCurrency(payload);
        setSuccessMsg(`Currency "${payload.name}" created.`);
      }
      setModalOpen(false);
      await loadData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save currency.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(item: AdminCurrencyItem) {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await apiClient.updateAdminCurrency(item.id, { isActive: !item.isActive });
      setSuccessMsg(
        `Currency "${item.name}" ${!item.isActive ? 'enabled' : 'disabled'}.`
      );
      await loadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to update currency.');
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await apiClient.deleteAdminCurrency(deleteTarget.id);
      setSuccessMsg(`Currency "${deleteTarget.name}" deleted.`);
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setDeleteError(err.message);
      } else {
        setDeleteError(err instanceof Error ? err.message : 'Unable to delete currency.');
      }
    } finally {
      setDeleteLoading(false);
    }
  }

  const filteredCurrencies = currencies.filter((item) => {
    const matchesGame =
      gameFilter === 'all' ||
      (gameFilter === 'unassigned' ? !item.gameId : item.gameId === gameFilter);
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      item.name.toLowerCase().includes(q) ||
      item.code.toLowerCase().includes(q) ||
      (item.gameTitle || '').toLowerCase().includes(q);
    return matchesGame && matchesSearch;
  });

  return (
    <AdminLayout title="Currency Management">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-white">In-Game Currencies</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Manage currencies like Diamonds, UC, CP, Gold, Gems, or VP and assign them to games.
            </p>
          </div>
          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-violet-600 text-xs font-semibold text-white hover:bg-violet-500 transition-colors whitespace-nowrap self-start"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>Add Currency</span>
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
              placeholder="Search currencies by name, code, or game..."
              aria-label="Search currencies"
              className="w-full rounded-lg bg-[#09090E] border border-white/[0.12] pl-9 pr-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-blue-500"
            />
          </div>

          <select
            value={gameFilter}
            onChange={(e) => setGameFilter(e.target.value)}
            aria-label="Filter currencies by game"
            className="rounded-lg bg-[#09090E] border border-white/[0.12] px-3 py-2 text-sm text-white focus:border-blue-500"
          >
            <option value="all">All Games</option>
            <option value="unassigned">Unassigned / Global</option>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </div>

        <div className="bg-[#111118] border border-white/[0.08] rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-8 text-sm text-zinc-400">Loading in-game currencies...</div>
          ) : filteredCurrencies.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <p className="text-sm font-semibold text-white">No currencies found</p>
              <p className="text-xs text-zinc-400">
                Create your first in-game currency (e.g. Diamonds, UC, CP) to link with packages.
              </p>
              <button
                type="button"
                onClick={openAddModal}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 text-xs font-semibold text-white hover:bg-violet-500"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Add Currency</span>
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/[0.08] text-zinc-400">
                  <tr>
                    <th className="py-3.5 px-4 font-medium">Currency</th>
                    <th className="py-3.5 px-4 font-medium">Code</th>
                    <th className="py-3.5 px-4 font-medium">Associated Game</th>
                    <th className="py-3.5 px-4 font-medium text-right">Packages</th>
                    <th className="py-3.5 px-4 font-medium text-right">Order</th>
                    <th className="py-3.5 px-4 font-medium">Status</th>
                    <th className="py-3.5 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {filteredCurrencies.map((item) => (
                    <tr key={item.id} className="hover:bg-white/[0.02]">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3 min-w-[180px]">
                          <div className="h-10 w-10 rounded-lg overflow-hidden bg-[#09090E] border border-white/[0.08] shrink-0 flex items-center justify-center">
                            {item.imageUrl ? (
                              <img
                                src={item.imageUrl}
                                alt={item.name}
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <Coins className="h-4 w-4 text-blue-400" aria-hidden="true" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-white truncate">
                              {item.name}
                            </div>
                            {item.description && (
                              <div className="text-[11px] text-zinc-400 truncate max-w-[220px]">
                                {item.description}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-zinc-200 whitespace-nowrap">
                        {item.code} ({item.symbol})
                      </td>
                      <td className="py-3.5 px-4 text-zinc-300 whitespace-nowrap">
                        {item.gameTitle || 'Global / All Games'}
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-right text-zinc-300">
                        {item.packageCount}
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-right text-zinc-300">
                        {item.sortOrder}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => void handleToggleActive(item)}
                          aria-label={`Toggle status for ${item.name}`}
                          className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            item.isActive
                              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
                              : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400'
                          }`}
                        >
                          <Power className="h-3 w-3" aria-hidden="true" />
                          <span>{item.isActive ? 'Enabled' : 'Disabled'}</span>
                        </button>
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditModal(item)}
                            aria-label={`Edit ${item.name}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/[0.12] text-zinc-200 hover:bg-white/[0.06]"
                          >
                            <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteError(null);
                              setDeleteTarget(item);
                            }}
                            aria-label={`Delete ${item.name}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-500/25 text-red-300 hover:bg-red-500/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="currency-modal-title"
        >
          <div className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-xl border border-white/[0.12] bg-[#111118] overflow-hidden">
            <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between gap-4">
              <h3 id="currency-modal-title" className="text-base font-semibold text-white">
                {editing ? `Edit Currency: ${editing.name}` : 'Add In-Game Currency'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close currency form"
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
                  <label htmlFor="curr-name" className="block text-xs font-medium text-zinc-300">
                    Currency Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="curr-name"
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g. Diamonds, UC, CP"
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm text-white focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="curr-code" className="block text-xs font-medium text-zinc-300">
                    Short Code <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="curr-code"
                    type="text"
                    required
                    value={form.code}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''),
                      }))
                    }
                    placeholder="e.g. DIAMONDS, UC, VP"
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm font-mono text-white focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="curr-symbol" className="block text-xs font-medium text-zinc-300">
                    Symbol / Unit Tag <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="curr-symbol"
                    type="text"
                    required
                    value={form.symbol}
                    onChange={(e) => setForm((prev) => ({ ...prev, symbol: e.target.value }))}
                    placeholder="e.g. Diamonds or UC"
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm text-white focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="curr-game" className="block text-xs font-medium text-zinc-300">
                    Associated Game
                  </label>
                  <select
                    id="curr-game"
                    value={form.gameId}
                    onChange={(e) => setForm((prev) => ({ ...prev, gameId: e.target.value }))}
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-2 text-sm text-white focus:border-blue-500"
                  >
                    <option value="">Global / Any Game</option>
                    {games.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="curr-desc" className="block text-xs font-medium text-zinc-300">
                  Description
                </label>
                <textarea
                  id="curr-desc"
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="Optional currency description shown on game detail pages..."
                  className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm text-white focus:border-blue-500"
                />
              </div>

              <MediaPickerField
                label="Currency Image"
                imageUrl={form.imageUrl}
                mediaId={form.mediaId}
                onChange={({ imageUrl, mediaId }) =>
                  setForm((prev) => ({ ...prev, imageUrl, mediaId }))
                }
              />

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="curr-status" className="block text-xs font-medium text-zinc-300">
                    Status
                  </label>
                  <select
                    id="curr-status"
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
                  <label htmlFor="curr-sort" className="block text-xs font-medium text-zinc-300">
                    Display Order
                  </label>
                  <input
                    id="curr-sort"
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
                  {saving ? 'Saving...' : editing ? 'Save Currency' : 'Create Currency'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete Currency: ${deleteTarget?.name || ''}?`}
        message="Currencies linked to active or archived packages cannot be deleted until packages are reassigned or deleted."
        confirmLabel="Delete Currency"
        destructive
        loading={deleteLoading}
        errorMessage={deleteError}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
      />
    </AdminLayout>
  );
}
