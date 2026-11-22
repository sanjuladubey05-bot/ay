import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Edit3,
  Link2,
  Plus,
  Power,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { ConfirmDialog } from '../../components/admin/ConfirmDialog';
import { AdminLayout } from '../../layouts/AdminLayout';
import { apiClient } from '../../services/apiClient';
import type {
  AdminPackageItem,
  AdminSupplierItem,
  SupplierOrderItem,
  SupplierPackageMappingItem,
} from '../../types/api';
import { formatInrPrice } from '../../utilities/orderDraft';
import { slugifyCatalogText } from '../../utilities/pricing';

interface SupplierFormState {
  name: string;
  code: string;
  integrationType: 'manual' | 'api' | 'webhook';
  mode: 'mock' | 'live';
  apiBaseUrl: string;
  apiKeyEnvName: string;
  timeoutMs: string;
  maxRetries: string;
  supportedGamesNote: string;
  notes: string;
  isActive: boolean;
}

const EMPTY_SUPPLIER_FORM: SupplierFormState = {
  name: '',
  code: '',
  integrationType: 'api',
  mode: 'mock',
  apiBaseUrl: '',
  apiKeyEnvName: 'SUPPLIER_DIRECT_API_KEY',
  timeoutMs: '8000',
  maxRetries: '2',
  supportedGamesNote: '',
  notes: '',
  isActive: true,
};

export function AdminSuppliersPage() {
  const [activeTab, setActiveTab] = useState<'suppliers' | 'mappings' | 'dispatches'>('suppliers');
  const [suppliers, setSuppliers] = useState<AdminSupplierItem[]>([]);
  const [mappings, setMappings] = useState<SupplierPackageMappingItem[]>([]);
  const [supplierOrders, setSupplierOrders] = useState<SupplierOrderItem[]>([]);
  const [packages, setPackages] = useState<AdminPackageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Supplier Add/Edit Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<AdminSupplierItem | null>(null);
  const [form, setForm] = useState<SupplierFormState>(EMPTY_SUPPLIER_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [savingSupplier, setSavingSupplier] = useState(false);

  // Mapping Form
  const [mapSupplierId, setMapSupplierId] = useState('');
  const [mapPackageId, setMapPackageId] = useState('');
  const [mapExternalCode, setMapExternalCode] = useState('');
  const [mapExternalName, setMapExternalName] = useState('');
  const [mapCostInr, setMapCostInr] = useState('0');
  const [savingMapping, setSavingMapping] = useState(false);

  // Delete Supplier Dialog
  const [deleteTarget, setDeleteTarget] = useState<AdminSupplierItem | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [supRes, mapRes, ordRes, pkgRes] = await Promise.all([
        apiClient.getAdminSuppliers(),
        apiClient.getAdminSupplierMappings(),
        apiClient.getAdminSupplierOrders(),
        apiClient.getAdminPackages(),
      ]);
      setSuppliers(supRes.suppliers);
      setMappings(mapRes.mappings);
      setSupplierOrders(ordRes.supplierOrders);
      setPackages(pkgRes.packages);
      if (!mapSupplierId && supRes.suppliers[0]) {
        setMapSupplierId(supRes.suppliers[0].id);
      }
      if (!mapPackageId && pkgRes.packages[0]) {
        setMapPackageId(pkgRes.packages[0].id);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to load supplier delivery settings.');
    } finally {
      setLoading(false);
    }
  }, [mapSupplierId, mapPackageId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  function openAddSupplier() {
    setEditingSupplier(null);
    setForm(EMPTY_SUPPLIER_FORM);
    setFormError(null);
    setModalOpen(true);
  }

  function openEditSupplier(sup: AdminSupplierItem) {
    setEditingSupplier(sup);
    setForm({
      name: sup.name,
      code: sup.code,
      integrationType: sup.integrationType,
      mode: sup.mode,
      apiBaseUrl: sup.apiBaseUrl || '',
      apiKeyEnvName: sup.apiKeyEnvName || '',
      timeoutMs: String(sup.timeoutMs || 8000),
      maxRetries: String(sup.maxRetries ?? 2),
      supportedGamesNote: sup.supportedGamesNote || '',
      notes: sup.notes || '',
      isActive: sup.isActive,
    });
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSaveSupplier(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSuccessMsg(null);

    if (!form.name.trim()) {
      setFormError('Supplier name is required.');
      return;
    }
    const cleanCode = slugifyCatalogText(form.code || form.name);
    if (!cleanCode || cleanCode.length < 2) {
      setFormError('Valid supplier code is required.');
      return;
    }
    if (form.mode === 'live' && (!form.apiBaseUrl.trim() || !form.apiBaseUrl.startsWith('https://'))) {
      setFormError('Live supplier mode requires an authorized HTTPS API Base URL.');
      return;
    }

    setSavingSupplier(true);
    try {
      const payload = {
        name: form.name.trim(),
        code: cleanCode,
        integrationType: form.integrationType,
        mode: form.mode,
        apiBaseUrl: form.apiBaseUrl.trim() || null,
        apiKeyEnvName: form.apiKeyEnvName.trim(),
        isActive: form.isActive,
        timeoutMs: Number.parseInt(form.timeoutMs || '8000', 10) || 8000,
        maxRetries: Number.parseInt(form.maxRetries || '2', 10) || 0,
        supportedGamesNote: form.supportedGamesNote.trim(),
        notes: form.notes.trim(),
      };

      if (editingSupplier) {
        await apiClient.updateAdminSupplier(editingSupplier.id, payload);
        setSuccessMsg(`Supplier "${payload.name}" updated.`);
      } else {
        await apiClient.createAdminSupplier(payload);
        setSuccessMsg(`Supplier "${payload.name}" added.`);
      }
      setModalOpen(false);
      await loadAll();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save supplier.');
    } finally {
      setSavingSupplier(false);
    }
  }

  async function handleSaveMapping(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    if (!mapSupplierId || !mapPackageId || !mapExternalCode.trim()) {
      setErrorMsg('Supplier, package, and external supplier SKU code are required.');
      return;
    }

    setSavingMapping(true);
    try {
      await apiClient.saveAdminSupplierMapping({
        supplierId: mapSupplierId,
        packageId: mapPackageId,
        externalProductCode: mapExternalCode.trim(),
        externalProductName: mapExternalName.trim(),
        supplierCostInr: Number.parseFloat(mapCostInr || '0') || 0,
        isActive: true,
      });
      setMapExternalCode('');
      setMapExternalName('');
      setSuccessMsg('Package-to-supplier mapping saved.');
      await loadAll();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save supplier mapping.');
    } finally {
      setSavingMapping(false);
    }
  }

  async function handleConfirmDeleteSupplier() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await apiClient.deleteAdminSupplier(deleteTarget.id);
      setSuccessMsg(`Supplier "${deleteTarget.name}" removed.`);
      setDeleteTarget(null);
      await loadAll();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Unable to remove supplier.');
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <AdminLayout title="Suppliers & Delivery">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-white">
              Supplier &amp; Automatic Delivery Architecture
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Configure manual and API delivery providers, map store packages to supplier product
              SKUs, and audit dispatch retries. Unconfigured providers run in clearly labelled Mock Mode.
            </p>
          </div>
          <div className="flex items-center gap-2.5 self-start">
            <button
              type="button"
              onClick={() => void loadAll()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/[0.14] text-xs font-medium text-zinc-200 hover:bg-white/[0.05] whitespace-nowrap"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={openAddSupplier}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 text-xs font-semibold text-white hover:bg-violet-500 whitespace-nowrap"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Add Supplier</span>
            </button>
          </div>
        </div>

        {/* Mock Mode Safety Banner */}
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3 text-xs text-amber-100">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1">
            <div className="font-semibold text-white">
              TEST ONLY (MOCK MODE) Safety Active
            </div>
            <p className="text-amber-100/80">
              API secret keys are never stored in browser-readable tables — only server-side{' '}
              <code className="font-mono text-amber-200">process.env</code> variable names are
              referenced. Suppliers in Mock Mode never send real external API calls and never mark
              orders Completed automatically.
            </p>
          </div>
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

        {/* Navigation Tabs */}
        <div className="flex flex-wrap gap-2 border-b border-white/[0.08] pb-3">
          <button
            type="button"
            onClick={() => setActiveTab('suppliers')}
            className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'suppliers'
                ? 'bg-violet-600 text-white'
                : 'bg-[#111118] border border-white/[0.1] text-zinc-300 hover:text-white'
            }`}
          >
            Suppliers ({suppliers.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('mappings')}
            className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'mappings'
                ? 'bg-violet-600 text-white'
                : 'bg-[#111118] border border-white/[0.1] text-zinc-300 hover:text-white'
            }`}
          >
            Package SKU Mappings ({mappings.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('dispatches')}
            className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'dispatches'
                ? 'bg-violet-600 text-white'
                : 'bg-[#111118] border border-white/[0.1] text-zinc-300 hover:text-white'
            }`}
          >
            Supplier Dispatch Logs ({supplierOrders.length})
          </button>
        </div>

        {loading ? (
          <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-8 text-sm text-zinc-400">
            Loading supplier delivery data...
          </div>
        ) : activeTab === 'suppliers' ? (
          <div className="bg-[#111118] border border-white/[0.08] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/[0.08] text-zinc-400">
                  <tr>
                    <th className="py-3.5 px-4 font-medium">Supplier</th>
                    <th className="py-3.5 px-4 font-medium">Mode &amp; Endpoint</th>
                    <th className="py-3.5 px-4 font-medium">Server Secret Env</th>
                    <th className="py-3.5 px-4 font-medium text-right">Timeout / Retries</th>
                    <th className="py-3.5 px-4 font-medium">Status</th>
                    <th className="py-3.5 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {suppliers.map((sup) => (
                    <tr key={sup.id} className="hover:bg-white/[0.02]">
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-white">{sup.name}</div>
                        <div className="font-mono text-[11px] text-zinc-400">
                          {sup.code} · {sup.integrationType.toUpperCase()}
                        </div>
                        {sup.supportedGamesNote && (
                          <div className="text-[11px] text-zinc-500 mt-0.5">
                            {sup.supportedGamesNote}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-[10px] font-mono font-semibold border ${
                            sup.mode === 'mock'
                              ? 'border-amber-500/35 bg-amber-500/10 text-amber-200'
                              : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
                          }`}
                        >
                          {sup.mode === 'mock' ? 'TEST ONLY (MOCK MODE)' : 'LIVE API'}
                        </span>
                        <div className="text-[11px] font-mono text-zinc-400 mt-1 truncate max-w-[220px]">
                          {sup.apiBaseUrl || 'Simulated local adapter'}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-mono text-zinc-200">{sup.apiKeyEnvName || 'None'}</div>
                        <div className="text-[11px] text-zinc-400">
                          {sup.apiKeyEnvName
                            ? sup.apiKeyConfigured
                              ? 'Env var set on server'
                              : 'Env var not configured'
                            : 'N/A'}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-right text-zinc-300 whitespace-nowrap">
                        {sup.timeoutMs}ms · {sup.maxRetries} retries
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={async () => {
                            await apiClient.updateAdminSupplier(sup.id, { isActive: !sup.isActive });
                            await loadAll();
                          }}
                          className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium ${
                            sup.isActive
                              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
                              : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400'
                          }`}
                        >
                          <Power className="h-3 w-3" aria-hidden="true" />
                          <span>{sup.isActive ? 'Enabled' : 'Disabled'}</span>
                        </button>
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditSupplier(sup)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/[0.12] text-zinc-200 hover:bg-white/[0.06]"
                          >
                            <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteError(null);
                              setDeleteTarget(sup);
                            }}
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
          </div>
        ) : activeTab === 'mappings' ? (
          <div className="space-y-6">
            <form
              onSubmit={(e) => void handleSaveMapping(e)}
              className="bg-[#111118] border border-white/[0.08] rounded-xl p-5 grid md:grid-cols-6 gap-3 items-end"
            >
              <div className="md:col-span-1 space-y-1">
                <label htmlFor="map-sup" className="block text-xs font-medium text-zinc-300">
                  Supplier
                </label>
                <select
                  id="map-sup"
                  value={mapSupplierId}
                  onChange={(e) => setMapSupplierId(e.target.value)}
                  className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-2.5 py-2 text-xs text-white"
                >
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2 space-y-1">
                <label htmlFor="map-pkg" className="block text-xs font-medium text-zinc-300">
                  Store Package
                </label>
                <select
                  id="map-pkg"
                  value={mapPackageId}
                  onChange={(e) => setMapPackageId(e.target.value)}
                  className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-2.5 py-2 text-xs text-white"
                >
                  {packages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.gameTitle} — {p.name} ({p.sku})
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-1 space-y-1">
                <label htmlFor="map-ext-code" className="block text-xs font-medium text-zinc-300">
                  Supplier SKU
                </label>
                <input
                  id="map-ext-code"
                  type="text"
                  required
                  value={mapExternalCode}
                  onChange={(e) => setMapExternalCode(e.target.value)}
                  placeholder="SUP-SKU-100"
                  className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-2 text-xs font-mono text-white"
                />
              </div>

              <div className="md:col-span-1 space-y-1">
                <label htmlFor="map-cost" className="block text-xs font-medium text-zinc-300">
                  Supplier Cost (₹)
                </label>
                <input
                  id="map-cost"
                  type="number"
                  min={0}
                  step="0.01"
                  value={mapCostInr}
                  onChange={(e) => setMapCostInr(e.target.value)}
                  className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-2 text-xs font-mono text-white"
                />
              </div>

              <button
                type="submit"
                disabled={savingMapping}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
              >
                <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{savingMapping ? 'Saving...' : 'Save Mapping'}</span>
              </button>
            </form>

            <div className="bg-[#111118] border border-white/[0.08] rounded-xl overflow-hidden">
              {mappings.length === 0 ? (
                <div className="p-8 text-center text-sm text-zinc-400">
                  No package-to-supplier SKU mappings added yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-white/[0.08] text-zinc-400">
                      <tr>
                        <th className="py-3.5 px-4 font-medium">Game &amp; Package</th>
                        <th className="py-3.5 px-4 font-medium">Supplier</th>
                        <th className="py-3.5 px-4 font-medium">External Product Code</th>
                        <th className="py-3.5 px-4 font-medium text-right">Cost</th>
                        <th className="py-3.5 px-4 font-medium text-right">Remove</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      {mappings.map((m) => (
                        <tr key={m.id} className="hover:bg-white/[0.02]">
                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-white">{m.packageName}</div>
                            <div className="text-[11px] text-zinc-400">
                              {m.gameTitle} · {m.packageSku}
                            </div>
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="text-zinc-200">{m.supplierName}</span>
                            <span className="ml-2 text-[10px] font-mono uppercase text-amber-300">
                              {m.supplierMode}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 font-mono text-white">
                            {m.externalProductCode}
                          </td>
                          <td className="py-3.5 px-4 font-mono tabular-nums text-right text-zinc-200">
                            {formatInrPrice(m.supplierCostInr)}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={async () => {
                                await apiClient.deleteAdminSupplierMapping(m.id);
                                await loadAll();
                              }}
                              className="px-2.5 py-1 rounded-lg border border-red-500/25 text-red-300 hover:bg-red-500/10"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-[#111118] border border-white/[0.08] rounded-xl overflow-hidden">
            {supplierOrders.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-400">
                No automatic supplier dispatch attempts recorded yet. Dispatch an order from Admin
                Orders to test mock mode.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-white/[0.08] text-zinc-400">
                    <tr>
                      <th className="py-3.5 px-4 font-medium">Supplier &amp; Env</th>
                      <th className="py-3.5 px-4 font-medium">External Ref</th>
                      <th className="py-3.5 px-4 font-medium">Status</th>
                      <th className="py-3.5 px-4 font-medium text-right">Attempts</th>
                      <th className="py-3.5 px-4 font-medium">Error / Response</th>
                      <th className="py-3.5 px-4 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {supplierOrders.map((so) => (
                      <tr key={so.id} className="hover:bg-white/[0.02]">
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-white">{so.supplierName}</div>
                          <span
                            className={`mt-0.5 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-mono ${
                              so.isMock
                                ? 'border-amber-500/35 bg-amber-500/10 text-amber-200'
                                : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
                            }`}
                          >
                            <Bot className="h-3 w-3" aria-hidden="true" />
                            <span>{so.environmentLabel}</span>
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-mono text-zinc-200">
                          {so.externalReference || '—'}
                        </td>
                        <td className="py-3.5 px-4 uppercase font-medium text-white">
                          {so.status}
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums text-right text-zinc-300">
                          {so.attemptCount} / {so.maxAttempts}
                        </td>
                        <td className="py-3.5 px-4 text-zinc-400 max-w-[260px] truncate">
                          {so.errorMessage || (so.isMock ? 'Simulated mock dispatch' : 'OK')}
                        </td>
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={async () => {
                                const res = await apiClient.checkSupplierOrderStatus(so.id);
                                setSuccessMsg(res.notice);
                                await loadAll();
                              }}
                              className="px-2.5 py-1 rounded-lg border border-white/[0.12] text-zinc-200 hover:bg-white/[0.06]"
                            >
                              Check Status
                            </button>
                            {so.status !== 'completed' && so.attemptCount < so.maxAttempts && (
                              <button
                                type="button"
                                onClick={async () => {
                                  const res = await apiClient.retrySupplierOrder(so.id);
                                  setSuccessMsg(
                                    `${res.environmentLabel}: Retry #${res.attemptCount} (${res.status}).`
                                  );
                                  await loadAll();
                                }}
                                className="px-2.5 py-1 rounded-lg border border-blue-500/35 bg-blue-500/10 text-blue-200 hover:bg-blue-500/20"
                              >
                                Retry
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add / Edit Supplier Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="supplier-modal-title"
        >
          <div className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-xl border border-white/[0.12] bg-[#111118] overflow-hidden">
            <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between gap-4">
              <h3 id="supplier-modal-title" className="text-base font-semibold text-white">
                {editingSupplier ? `Edit Supplier: ${editingSupplier.name}` : 'Add Supplier'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close supplier form"
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSaveSupplier(e)}
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
                  <label htmlFor="sup-name" className="block text-xs font-medium text-zinc-300">
                    Supplier Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="sup-name"
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => {
                      const name = e.target.value;
                      setForm((prev) => ({
                        ...prev,
                        name,
                        code: editingSupplier ? prev.code : slugifyCatalogText(name),
                      }));
                    }}
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm text-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="sup-code" className="block text-xs font-medium text-zinc-300">
                    Code <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="sup-code"
                    type="text"
                    required
                    value={form.code}
                    onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm font-mono text-white"
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="sup-type" className="block text-xs font-medium text-zinc-300">
                    Integration Type
                  </label>
                  <select
                    id="sup-type"
                    value={form.integrationType}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        integrationType: e.target.value as 'manual' | 'api' | 'webhook',
                      }))
                    }
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-2 text-sm text-white"
                  >
                    <option value="api">Direct API</option>
                    <option value="manual">Manual Desk</option>
                    <option value="webhook">Webhook Provider</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="sup-mode" className="block text-xs font-medium text-zinc-300">
                    Execution Mode
                  </label>
                  <select
                    id="sup-mode"
                    value={form.mode}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, mode: e.target.value as 'mock' | 'live' }))
                    }
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-2 text-sm text-white"
                  >
                    <option value="mock">Mock Mode (TEST ONLY)</option>
                    <option value="live">Live HTTPS API</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="sup-url" className="block text-xs font-medium text-zinc-300">
                  API Base URL (Required HTTPS for Live Mode)
                </label>
                <input
                  id="sup-url"
                  type="url"
                  value={form.apiBaseUrl}
                  onChange={(e) => setForm((prev) => ({ ...prev, apiBaseUrl: e.target.value }))}
                  placeholder="https://api.supplier.example/v1"
                  className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm font-mono text-white"
                />
              </div>

              <div className="grid sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="sup-env" className="block text-xs font-medium text-zinc-300">
                    Server Env Var Name
                  </label>
                  <input
                    id="sup-env"
                    type="text"
                    value={form.apiKeyEnvName}
                    onChange={(e) => setForm((prev) => ({ ...prev, apiKeyEnvName: e.target.value }))}
                    placeholder="SUPPLIER_API_KEY"
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-2 text-xs font-mono text-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="sup-timeout" className="block text-xs font-medium text-zinc-300">
                    Timeout (ms)
                  </label>
                  <input
                    id="sup-timeout"
                    type="number"
                    min={1000}
                    max={60000}
                    value={form.timeoutMs}
                    onChange={(e) => setForm((prev) => ({ ...prev, timeoutMs: e.target.value }))}
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-2 text-sm font-mono text-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="sup-retries" className="block text-xs font-medium text-zinc-300">
                    Max Retries
                  </label>
                  <input
                    id="sup-retries"
                    type="number"
                    min={0}
                    max={10}
                    value={form.maxRetries}
                    onChange={(e) => setForm((prev) => ({ ...prev, maxRetries: e.target.value }))}
                    className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-2 text-sm font-mono text-white"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="sup-games-note" className="block text-xs font-medium text-zinc-300">
                  Supported Games / Notes
                </label>
                <input
                  id="sup-games-note"
                  type="text"
                  value={form.supportedGamesNote}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, supportedGamesNote: e.target.value }))
                  }
                  placeholder="e.g. VALORANT India, BGMI Direct"
                  className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm text-white"
                />
              </div>

              <div className="pt-3 border-t border-white/[0.08] flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-white/[0.14] text-xs font-medium text-zinc-200 hover:bg-white/[0.06]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingSupplier}
                  className="px-5 py-2 rounded-lg bg-violet-600 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
                >
                  {savingSupplier ? 'Saving...' : 'Save Supplier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete Supplier: ${deleteTarget?.name || ''}?`}
        message="Suppliers with recorded dispatch attempts cannot be deleted to preserve audit trails and can be disabled instead."
        confirmLabel="Delete Supplier"
        destructive
        loading={deleteLoading}
        errorMessage={deleteError}
        onConfirm={() => void handleConfirmDeleteSupplier()}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
      />
    </AdminLayout>
  );
}
