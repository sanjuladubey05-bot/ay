import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  Edit3,
  Gamepad2,
  Plus,
  Power,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { ConfirmDialog } from '../../components/admin/ConfirmDialog';
import { MediaPickerField } from '../../components/admin/MediaPickerField';
import { AdminLayout } from '../../layouts/AdminLayout';
import { ApiError, apiClient } from '../../services/apiClient';
import type { AdminGameItem, AdminRegionItem, AdminSupplierItem } from '../../types/api';
import type { PlayerFieldDefinition } from '../../types/database';
import { slugifyCatalogText } from '../../utilities/pricing';

interface GameFormState {
  title: string;
  slug: string;
  category: string;
  publisher: string;
  description: string;
  coverImageUrl: string | null;
  coverMediaId: string | null;
  deliveryMode: 'manual' | 'automatic' | 'hybrid';
  defaultSupplierId: string;
  isActive: boolean;
  isFeatured: boolean;
  sortOrder: number;
  playerFields: PlayerFieldDefinition[];
}

const DEFAULT_PLAYER_FIELD: PlayerFieldDefinition = {
  key: 'player_id',
  label: 'Player ID',
  type: 'text',
  placeholder: 'Enter your Player ID',
  required: true,
};

function createEmptyGameForm(nextOrder: number): GameFormState {
  return {
    title: '',
    slug: '',
    category: 'FPS',
    publisher: '',
    description: '',
    coverImageUrl: null,
    coverMediaId: null,
    deliveryMode: 'manual',
    defaultSupplierId: '',
    isActive: true,
    isFeatured: false,
    sortOrder: nextOrder,
    playerFields: [{ ...DEFAULT_PLAYER_FIELD }],
  };
}

export function AdminGamesPage() {
  const [games, setGames] = useState<AdminGameItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [suppliers, setSuppliers] = useState<AdminSupplierItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingGame, setEditingGame] = useState<AdminGameItem | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [form, setForm] = useState<GameFormState>(() => createEmptyGameForm(0));
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<AdminGameItem | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [regions, setRegions] = useState<AdminRegionItem[]>([]);
  const [regionsLoading, setRegionsLoading] = useState(false);
  const [newRegionCode, setNewRegionCode] = useState('');
  const [newRegionName, setNewRegionName] = useState('');
  const [newServerHint, setNewServerHint] = useState('');
  const [regionBusy, setRegionBusy] = useState(false);

  const fetchGames = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [res, supRes] = await Promise.all([
        apiClient.getAdminGames({
          search: search.trim() || undefined,
          category: categoryFilter,
          status: statusFilter,
        }),
        apiClient.getAdminSuppliers().catch(() => ({ suppliers: [] })),
      ]);
      setGames(res.games);
      setCategories(res.categories);
      setSuppliers(supRes.suppliers);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to load games.');
    } finally {
      setLoading(false);
    }
  }, [search, categoryFilter, statusFilter]);

  useEffect(() => {
    void fetchGames();
  }, [fetchGames]);

  async function fetchGameRegions(gameId: string) {
    setRegionsLoading(true);
    try {
      const res = await apiClient.getAdminGameRegions(gameId);
      setRegions(res.regions);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to load server regions.');
    } finally {
      setRegionsLoading(false);
    }
  }

  function openAddModal() {
    setEditingGame(null);
    setSlugTouched(false);
    setForm(createEmptyGameForm(games.length + 1));
    setRegions([]);
    setNewRegionCode('');
    setNewRegionName('');
    setNewServerHint('');
    setFormError(null);
    setModalOpen(true);
  }

  function openEditModal(game: AdminGameItem) {
    setEditingGame(game);
    setSlugTouched(true);
    setForm({
      title: game.title,
      slug: game.slug,
      category: game.category,
      publisher: game.publisher || '',
      description: game.description || '',
      coverImageUrl: game.coverImageUrl,
      coverMediaId: game.coverMediaId,
      deliveryMode: game.deliveryMode,
      defaultSupplierId: game.defaultSupplierId || '',
      isActive: game.isActive,
      isFeatured: game.isFeatured,
      sortOrder: game.sortOrder,
      playerFields:
        game.playerFields.length > 0 ? game.playerFields : [{ ...DEFAULT_PLAYER_FIELD }],
    });
    setRegions([]);
    setNewRegionCode('');
    setNewRegionName('');
    setNewServerHint('');
    setFormError(null);
    setModalOpen(true);
    void fetchGameRegions(game.id);
  }

  function updatePlayerField(index: number, patch: Partial<PlayerFieldDefinition>) {
    setForm((prev) => {
      const nextFields = prev.playerFields.map((f, i) => {
        if (i !== index) return f;
        const updated = { ...f, ...patch };
        if (patch.label !== undefined && !editingGame) {
          const generatedKey = slugifyCatalogText(patch.label).replace(/-/g, '_');
          if (generatedKey) updated.key = generatedKey;
        }
        return updated;
      });
      return { ...prev, playerFields: nextFields };
    });
  }

  async function handleSaveGame(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSuccessMsg(null);

    if (!form.title.trim()) {
      setFormError('Game name is required.');
      return;
    }
    const cleanSlug = slugifyCatalogText(form.slug || form.title);
    if (!cleanSlug || cleanSlug.length < 2) {
      setFormError('Valid URL slug is required (minimum 2 characters).');
      return;
    }
    if (!form.category.trim()) {
      setFormError('Game category is required.');
      return;
    }

    const cleanedFields = form.playerFields
      .filter((f) => f.label.trim().length > 0)
      .map((f) => ({
        ...f,
        key: (f.key || slugifyCatalogText(f.label).replace(/-/g, '_')).slice(0, 40) || 'player_id',
        label: f.label.trim(),
        placeholder: f.placeholder?.trim() || undefined,
        validationRegex: f.validationRegex?.trim() || undefined,
        validationMessage: f.validationMessage?.trim() || undefined,
      }));

    if (cleanedFields.length === 0) {
      setFormError('Add at least one Player ID input field for customers.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        slug: cleanSlug,
        title: form.title.trim(),
        publisher: form.publisher.trim(),
        category: form.category.trim(),
        description: form.description.trim(),
        coverImageUrl: form.coverImageUrl,
        coverMediaId: form.coverMediaId,
        deliveryMode: form.deliveryMode,
        defaultSupplierId: form.defaultSupplierId || null,
        isActive: form.isActive,
        isFeatured: form.isFeatured,
        sortOrder: Number.isFinite(form.sortOrder) ? form.sortOrder : 0,
        playerFields: cleanedFields,
      };

      if (editingGame) {
        await apiClient.updateAdminGame(editingGame.id, payload);
        setSuccessMsg(`Game "${payload.title}" updated and published to storefront catalog.`);
      } else {
        await apiClient.createAdminGame(payload);
        setSuccessMsg(`Game "${payload.title}" added to storefront catalog.`);
      }
      setModalOpen(false);
      await fetchGames();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save game.');
    } finally {
      setSaving(false);
    }
  }

  async function handleQuickToggle(game: AdminGameItem, patch: { isActive?: boolean; isFeatured?: boolean }) {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await apiClient.updateAdminGame(game.id, patch);
      setSuccessMsg(`Updated "${game.title}".`);
      await fetchGames();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to update game.');
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await apiClient.deleteAdminGame(deleteTarget.id);
      setSuccessMsg(`Game "${deleteTarget.title}" removed safely.`);
      setDeleteTarget(null);
      await fetchGames();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setDeleteError(err.message);
      } else {
        setDeleteError(err instanceof Error ? err.message : 'Unable to delete game.');
      }
    } finally {
      setDeleteLoading(false);
    }
  }

  async function handleDeactivateFromDialog() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await apiClient.updateAdminGame(deleteTarget.id, { isActive: false });
      setSuccessMsg(`Game "${deleteTarget.title}" has been deactivated.`);
      setDeleteTarget(null);
      setDeleteError(null);
      await fetchGames();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Unable to deactivate game.');
    } finally {
      setDeleteLoading(false);
    }
  }

  async function handleAddRegion() {
    if (!editingGame) return;
    const code = newRegionCode.trim().toUpperCase();
    const name = newRegionName.trim();
    if (!code || !name) {
      setFormError('Both Region Code and Region Name are required.');
      return;
    }
    setRegionBusy(true);
    setFormError(null);
    try {
      const res = await apiClient.createAdminGameRegion(editingGame.id, {
        regionCode: code,
        regionName: name,
        serverHint: newServerHint.trim() || null,
        isActive: true,
      });
      setRegions((prev) => [...prev, res.region]);
      setNewRegionCode('');
      setNewRegionName('');
      setNewServerHint('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to add region.');
    } finally {
      setRegionBusy(false);
    }
  }

  async function handleToggleRegion(region: AdminRegionItem) {
    if (!editingGame) return;
    setRegionBusy(true);
    setFormError(null);
    try {
      const res = await apiClient.updateAdminGameRegion(editingGame.id, region.id, {
        isActive: !region.isActive,
      });
      setRegions((prev) => prev.map((r) => (r.id === region.id ? res.region : r)));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to update region.');
    } finally {
      setRegionBusy(false);
    }
  }

  async function handleDeleteRegion(regionId: string) {
    if (!editingGame) return;
    setRegionBusy(true);
    setFormError(null);
    try {
      await apiClient.deleteAdminGameRegion(editingGame.id, regionId);
      setRegions((prev) => prev.filter((r) => r.id !== regionId));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to delete region.');
    } finally {
      setRegionBusy(false);
    }
  }

  return (
    <AdminLayout title="Games Management">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-white">Games Catalog</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Add, edit, activate, feature, reorder, or safely remove games displayed on LPS STORE.
            </p>
          </div>
          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-violet-600 text-xs font-semibold text-white hover:bg-violet-500 transition-colors whitespace-nowrap self-start"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>Add Game</span>
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

        {/* Search & Filters */}
        <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-4 flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search
              className="h-4 w-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search games by name, slug, or publisher..."
              aria-label="Search games"
              className="w-full rounded-lg bg-[#09090E] border border-white/[0.12] pl-9 pr-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-blue-500"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filter by category"
            className="rounded-lg bg-[#09090E] border border-white/[0.12] px-3 py-2 text-sm text-white focus:border-blue-500"
          >
            <option value="all">All Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
            className="rounded-lg bg-[#09090E] border border-white/[0.12] px-3 py-2 text-sm text-white focus:border-blue-500"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active Only</option>
            <option value="inactive">Disabled Only</option>
          </select>
        </div>

        {/* Games Table */}
        <div className="bg-[#111118] border border-white/[0.08] rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-8 text-sm text-zinc-400">Loading games catalog...</div>
          ) : games.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <p className="text-sm font-semibold text-white">No games match your filters</p>
              <p className="text-xs text-zinc-400">
                Add a new game title or clear your search filter.
              </p>
              <button
                type="button"
                onClick={openAddModal}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 text-xs font-semibold text-white hover:bg-violet-500"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Add First Game</span>
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/[0.08] text-zinc-400">
                  <tr>
                    <th className="py-3.5 px-4 font-medium">Game</th>
                    <th className="py-3.5 px-4 font-medium">Category</th>
                    <th className="py-3.5 px-4 font-medium text-right">Order</th>
                    <th className="py-3.5 px-4 font-medium text-right">Packages</th>
                    <th className="py-3.5 px-4 font-medium">Featured</th>
                    <th className="py-3.5 px-4 font-medium">Status</th>
                    <th className="py-3.5 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {games.map((game) => (
                    <tr key={game.id} className="hover:bg-white/[0.02]">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3 min-w-[200px]">
                          <div className="h-11 w-14 rounded-lg overflow-hidden bg-[#09090E] border border-white/[0.08] shrink-0 flex items-center justify-center">
                            {game.coverImageUrl ? (
                              <img
                                src={game.coverImageUrl}
                                alt={game.title}
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <Gamepad2 className="h-4 w-4 text-violet-400" aria-hidden="true" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-white truncate">
                              {game.title}
                            </div>
                            <div className="text-[11px] font-mono text-zinc-400 truncate">
                              /{game.slug}
                              {game.publisher ? ` · ${game.publisher}` : ''}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-zinc-300 whitespace-nowrap">{game.category}</td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-right text-zinc-300">
                        {game.sortOrder}
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-right text-zinc-300">
                        {game.packageCount}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() =>
                            void handleQuickToggle(game, { isFeatured: !game.isFeatured })
                          }
                          aria-label={`Toggle featured status for ${game.title}`}
                          className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            game.isFeatured
                              ? 'border-violet-500/40 bg-violet-600/15 text-violet-200'
                              : 'border-white/[0.1] text-zinc-400 hover:text-white'
                          }`}
                        >
                          <Star className="h-3 w-3" aria-hidden="true" />
                          <span>{game.isFeatured ? 'Featured' : 'Standard'}</span>
                        </button>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => void handleQuickToggle(game, { isActive: !game.isActive })}
                          aria-label={`Toggle active status for ${game.title}`}
                          className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            game.isActive
                              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
                              : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400'
                          }`}
                        >
                          <Power className="h-3 w-3" aria-hidden="true" />
                          <span>{game.isActive ? 'Active' : 'Disabled'}</span>
                        </button>
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditModal(game)}
                            aria-label={`Edit ${game.title}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/[0.12] text-zinc-200 hover:bg-white/[0.06]"
                          >
                            <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteError(null);
                              setDeleteTarget(game);
                            }}
                            aria-label={`Delete ${game.title}`}
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

      {/* Add / Edit Game Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="game-modal-title"
        >
          <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border border-white/[0.12] bg-[#111118] overflow-hidden">
            <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between gap-4">
              <h3 id="game-modal-title" className="text-base font-semibold text-white">
                {editingGame ? `Edit Game: ${editingGame.title}` : 'Add New Game'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close game form"
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSaveGame(e)}
              className="flex-1 overflow-y-auto p-6 space-y-5"
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
                  <label htmlFor="game-title" className="block text-xs font-medium text-zinc-300">
                    Game Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="game-title"
                    type="text"
                    required
                    value={form.title}
                    onChange={(e) => {
                      const title = e.target.value;
                      setForm((prev) => ({
                        ...prev,
                        title,
                        slug: slugTouched ? prev.slug : slugifyCatalogText(title),
                      }));
                    }}
                    placeholder="e.g. VALORANT"
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm text-white focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="game-slug" className="block text-xs font-medium text-zinc-300">
                    URL Slug <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="game-slug"
                    type="text"
                    required
                    value={form.slug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setForm((prev) => ({ ...prev, slug: e.target.value }));
                    }}
                    placeholder="e.g. valorant"
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm font-mono text-white focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="game-category" className="block text-xs font-medium text-zinc-300">
                    Category <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="game-category"
                    type="text"
                    required
                    value={form.category}
                    onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                    placeholder="FPS, Battle Royale, Action RPG"
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm text-white focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="game-publisher" className="block text-xs font-medium text-zinc-300">
                    Publisher (Optional)
                  </label>
                  <input
                    id="game-publisher"
                    type="text"
                    value={form.publisher}
                    onChange={(e) => setForm((prev) => ({ ...prev, publisher: e.target.value }))}
                    placeholder="e.g. Riot Games"
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm text-white focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="game-sort" className="block text-xs font-medium text-zinc-300">
                    Display Order
                  </label>
                  <input
                    id="game-sort"
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

              <div className="space-y-1.5">
                <label htmlFor="game-description" className="block text-xs font-medium text-zinc-300">
                  Game Description
                </label>
                <textarea
                  id="game-description"
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="Describe top-up delivery details and supported accounts..."
                  className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm text-white focus:border-blue-500"
                />
              </div>

              <MediaPickerField
                label="Game Image"
                imageUrl={form.coverImageUrl}
                mediaId={form.coverMediaId}
                onChange={({ imageUrl, mediaId }) =>
                  setForm((prev) => ({ ...prev, coverImageUrl: imageUrl, coverMediaId: mediaId }))
                }
              />

              <div className="grid sm:grid-cols-3 gap-4 pt-1">
                <div className="space-y-1.5">
                  <label htmlFor="game-status" className="block text-xs font-medium text-zinc-300">
                    Game Status
                  </label>
                  <select
                    id="game-status"
                    value={form.isActive ? 'active' : 'inactive'}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, isActive: e.target.value === 'active' }))
                    }
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-2 text-sm text-white focus:border-blue-500"
                  >
                    <option value="active">Active (Published)</option>
                    <option value="inactive">Disabled (Hidden)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="game-featured" className="block text-xs font-medium text-zinc-300">
                    Featured / Popular
                  </label>
                  <select
                    id="game-featured"
                    value={form.isFeatured ? 'featured' : 'standard'}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, isFeatured: e.target.value === 'featured' }))
                    }
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-2 text-sm text-white focus:border-blue-500"
                  >
                    <option value="featured">Featured on Homepage</option>
                    <option value="standard">Standard Listing</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="game-delivery" className="block text-xs font-medium text-zinc-300">
                    Delivery Workflow
                  </label>
                  <select
                    id="game-delivery"
                    value={form.deliveryMode}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        deliveryMode: e.target.value as 'manual' | 'automatic' | 'hybrid',
                      }))
                    }
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-2 text-sm text-white focus:border-blue-500"
                  >
                    <option value="manual">Manual Delivery</option>
                    <option value="automatic">Automatic (Supplier API)</option>
                    <option value="hybrid">Hybrid (Both Available)</option>
                  </select>
                </div>
              </div>

              {(form.deliveryMode === 'automatic' || form.deliveryMode === 'hybrid') && (
                <div className="space-y-1.5">
                  <label htmlFor="game-supplier" className="block text-xs font-medium text-zinc-300">
                    Default Supplier Route (Optional)
                  </label>
                  <select
                    id="game-supplier"
                    value={form.defaultSupplierId}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, defaultSupplierId: e.target.value }))
                    }
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-2 text-sm text-white focus:border-blue-500"
                  >
                    <option value="">Auto-select active supplier</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.mode === 'mock' ? 'MOCK MODE' : 'LIVE'})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Player Info Fields */}
              <div className="space-y-3 pt-2 border-t border-white/[0.08]">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-white">
                      Required Player ID / Server Fields
                    </div>
                    <p className="text-[11px] text-zinc-400">
                      Only non-sensitive identifiers (Player ID, UID, Server). Passwords &amp; OTPs
                      are blocked.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        playerFields: [
                          ...prev.playerFields,
                          {
                            key: `field_${prev.playerFields.length + 1}`,
                            label: 'Server / Zone',
                            type: 'text',
                            placeholder: 'Enter details',
                            required: false,
                          },
                        ],
                      }))
                    }
                    className="px-2.5 py-1.5 rounded-lg border border-white/[0.14] text-xs font-medium text-zinc-200 hover:bg-white/[0.06] whitespace-nowrap"
                  >
                    + Add Field
                  </button>
                </div>

                <div className="space-y-2.5">
                  {form.playerFields.map((field, index) => (
                    <div
                      key={`${field.key}-${index}`}
                      className="rounded-lg border border-white/[0.08] bg-[#09090E] p-3 space-y-2"
                    >
                      <div className="grid sm:grid-cols-12 gap-2 items-center">
                        <input
                          type="text"
                          value={field.label}
                          onChange={(e) => updatePlayerField(index, { label: e.target.value })}
                          placeholder="Field Label (e.g. Player ID)"
                          aria-label={`Player field ${index + 1} label`}
                          className="sm:col-span-4 rounded-md bg-[#111118] border border-white/[0.1] px-2.5 py-1.5 text-xs text-white"
                        />
                        <input
                          type="text"
                          value={field.placeholder || ''}
                          onChange={(e) => updatePlayerField(index, { placeholder: e.target.value })}
                          placeholder="Placeholder hint"
                          aria-label={`Player field ${index + 1} placeholder`}
                          className="sm:col-span-4 rounded-md bg-[#111118] border border-white/[0.1] px-2.5 py-1.5 text-xs text-white"
                        />
                        <label className="sm:col-span-2 inline-flex items-center gap-1.5 text-xs text-zinc-300 px-1">
                          <input
                            type="checkbox"
                            checked={field.required}
                            onChange={(e) =>
                              updatePlayerField(index, { required: e.target.checked })
                            }
                            className="rounded border-white/20 bg-[#111118]"
                          />
                          <span>Required</span>
                        </label>
                        <div className="sm:col-span-2 flex justify-end">
                          <button
                            type="button"
                            disabled={form.playerFields.length <= 1}
                            onClick={() =>
                              setForm((prev) => ({
                                ...prev,
                                playerFields: prev.playerFields.filter((_, idx) => idx !== index),
                              }))
                            }
                            aria-label={`Remove player field ${index + 1}`}
                            className="px-2 py-1 text-xs text-red-300 hover:text-red-200 disabled:opacity-40"
                          >
                            Remove
                          </button>
                        </div>
                      </div>

                      <div className="grid sm:grid-cols-12 gap-2 items-center pt-1 border-t border-white/[0.05]">
                        <div className="sm:col-span-5 flex items-center gap-1.5">
                          <input
                            type="text"
                            value={field.validationRegex || ''}
                            onChange={(e) =>
                              updatePlayerField(index, { validationRegex: e.target.value })
                            }
                            placeholder="Validation regex (e.g. ^\\d{6,15}$)"
                            aria-label={`Player field ${index + 1} validation regex`}
                            className="w-full rounded-md bg-[#111118] border border-white/[0.1] px-2.5 py-1.5 text-xs font-mono text-zinc-200"
                          />
                        </div>
                        <input
                          type="text"
                          value={field.validationMessage || ''}
                          onChange={(e) =>
                            updatePlayerField(index, { validationMessage: e.target.value })
                          }
                          placeholder="Custom format error message"
                          aria-label={`Player field ${index + 1} validation message`}
                          className="sm:col-span-4 rounded-md bg-[#111118] border border-white/[0.1] px-2.5 py-1.5 text-xs text-zinc-200"
                        />
                        <div className="sm:col-span-3 flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              updatePlayerField(index, {
                                validationRegex: '^\\d{6,15}$',
                                validationMessage: `${field.label || 'Player ID'} must be 6 to 15 digits.`,
                              })
                            }
                            className="rounded border border-white/[0.1] px-2 py-1 text-[10px] text-zinc-300 hover:bg-white/[0.06]"
                          >
                            Digits
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updatePlayerField(index, {
                                validationRegex: '^[A-Za-z0-9#_-]{3,24}$',
                                validationMessage: `${field.label || 'Field'} must be 3-24 alphanumeric characters.`,
                              })
                            }
                            className="rounded border border-white/[0.1] px-2 py-1 text-[10px] text-zinc-300 hover:bg-white/[0.06]"
                          >
                            Alnum
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Game Server / Region Management (Edit Mode) */}
              {editingGame && (
                <div className="space-y-3 pt-3 border-t border-white/[0.08]">
                  <div>
                    <div className="text-xs font-semibold text-white">
                      Server / Region List
                    </div>
                    <p className="text-[11px] text-zinc-400">
                      Configure selectable server regions shown to customers on the storefront.
                    </p>
                  </div>

                  {regionsLoading ? (
                    <div className="text-xs text-zinc-400">Loading server regions...</div>
                  ) : regions.length === 0 ? (
                    <div className="rounded-lg border border-white/[0.06] bg-[#09090E] p-3 text-xs text-zinc-500">
                      No server regions configured for this game yet.
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {regions.map((reg) => (
                        <div
                          key={reg.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.08] bg-[#09090E] px-3 py-2 text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono font-semibold text-white">
                              {reg.regionCode}
                            </span>
                            <span className="text-zinc-300 truncate">{reg.regionName}</span>
                            {reg.serverHint && (
                              <span className="text-zinc-500 truncate">({reg.serverHint})</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              disabled={regionBusy}
                              onClick={() => void handleToggleRegion(reg)}
                              className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                                reg.isActive
                                  ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
                                  : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400'
                              }`}
                            >
                              {reg.isActive ? 'Active' : 'Disabled'}
                            </button>
                            <button
                              type="button"
                              disabled={regionBusy}
                              onClick={() => void handleDeleteRegion(reg.id)}
                              className="px-2 py-0.5 text-[11px] text-red-300 hover:text-red-200"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="grid sm:grid-cols-12 gap-2 items-center rounded-lg border border-white/[0.08] bg-[#09090E] p-2.5">
                    <input
                      type="text"
                      value={newRegionCode}
                      onChange={(e) => setNewRegionCode(e.target.value.toUpperCase())}
                      placeholder="Code (e.g. IN)"
                      aria-label="New region code"
                      className="sm:col-span-3 rounded-md bg-[#111118] border border-white/[0.1] px-2.5 py-1.5 text-xs font-mono text-white"
                    />
                    <input
                      type="text"
                      value={newRegionName}
                      onChange={(e) => setNewRegionName(e.target.value)}
                      placeholder="Region Name (e.g. India)"
                      aria-label="New region name"
                      className="sm:col-span-4 rounded-md bg-[#111118] border border-white/[0.1] px-2.5 py-1.5 text-xs text-white"
                    />
                    <input
                      type="text"
                      value={newServerHint}
                      onChange={(e) => setNewServerHint(e.target.value)}
                      placeholder="Server hint (Opt.)"
                      aria-label="New server hint"
                      className="sm:col-span-3 rounded-md bg-[#111118] border border-white/[0.1] px-2.5 py-1.5 text-xs text-white"
                    />
                    <button
                      type="button"
                      disabled={regionBusy}
                      onClick={() => void handleAddRegion()}
                      className="sm:col-span-2 rounded-md border border-violet-500/40 bg-violet-600/20 px-2.5 py-1.5 text-xs font-medium text-violet-200 hover:bg-violet-600/35 disabled:opacity-50 whitespace-nowrap"
                    >
                      + Add Region
                    </button>
                  </div>
                </div>
              )}

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
                  {saving ? 'Saving...' : editingGame ? 'Save Changes' : 'Create Game'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete ${deleteTarget?.title || 'Game'}?`}
        message="Deleting a game removes its catalog listing. Games linked to customer orders cannot be deleted to preserve order history and can be deactivated instead."
        confirmLabel="Delete Game"
        destructive
        loading={deleteLoading}
        errorMessage={deleteError}
        secondaryActionLabel={deleteError ? 'Disable Game Instead' : undefined}
        onSecondaryAction={deleteError ? () => void handleDeactivateFromDialog() : undefined}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
      />
    </AdminLayout>
  );
}
