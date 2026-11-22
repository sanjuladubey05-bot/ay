import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  Eye,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  UserCheck,
  X,
} from 'lucide-react';
import { ConfirmDialog } from '../../components/admin/ConfirmDialog';
import { AdminLayout } from '../../layouts/AdminLayout';
import { apiClient } from '../../services/apiClient';
import type { AdminGameItem, AdminOrderItem, AdminSupplierItem } from '../../types/api';
import { formatInrPrice } from '../../utilities/orderDraft';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Order Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'payment_pending', label: 'Payment Pending' },
  { value: 'payment_verified', label: 'Payment Verified' },
  { value: 'processing', label: 'Processing' },
  { value: 'awaiting_delivery', label: 'Awaiting Delivery' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'refund_pending', label: 'Refund Pending' },
  { value: 'refunded', label: 'Refunded' },
];

const BADGE_CLASSES: Record<string, string> = {
  Pending: 'border-amber-500/35 bg-amber-500/10 text-amber-200',
  'Payment Pending': 'border-amber-500/35 bg-amber-500/10 text-amber-200',
  'Payment Verified': 'border-cyan-500/35 bg-cyan-500/10 text-cyan-200',
  Processing: 'border-blue-500/35 bg-blue-500/10 text-blue-200',
  'Awaiting Delivery': 'border-indigo-500/35 bg-indigo-500/10 text-indigo-200',
  Completed: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200',
  Failed: 'border-red-500/35 bg-red-500/10 text-red-200',
  Cancelled: 'border-zinc-500/35 bg-zinc-500/10 text-zinc-300',
  'Refund Pending': 'border-orange-500/35 bg-orange-500/10 text-orange-200',
  Refunded: 'border-zinc-500/35 bg-zinc-500/10 text-zinc-300',
};

export function AdminOrdersPage() {
  const [orders, setOrders] = useState<AdminOrderItem[]>([]);
  const [games, setGames] = useState<AdminGameItem[]>([]);
  const [suppliers, setSuppliers] = useState<AdminSupplierItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [gameFilter, setGameFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Selected Order Detail Modal state
  const [selectedOrder, setSelectedOrder] = useState<AdminOrderItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailNotice, setDetailNotice] = useState<string | null>(null);

  // Editable form inside drawer
  const [editStatus, setEditStatus] = useState('payment_pending');
  const [editDeliveryMethod, setEditDeliveryMethod] = useState<'manual' | 'automatic' | 'both'>(
    'manual'
  );
  const [editAdminNote, setEditAdminNote] = useState('');
  const [editDeliveryNotes, setEditDeliveryNotes] = useState('');
  const [editCustomerMsg, setEditCustomerMsg] = useState('');
  const [savingOrder, setSavingOrder] = useState(false);

  // Explicit confirmation dialog before marking Completed
  const [confirmCompleteOpen, setConfirmCompleteOpen] = useState(false);
  const [pendingCompletionNote, setPendingCompletionNote] = useState<string | undefined>(undefined);

  // Automatic Supplier Dispatch inside drawer
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [dispatchingSupplier, setDispatchingSupplier] = useState(false);
  const [supplierActionId, setSupplierActionId] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [ordRes, gameRes, supRes] = await Promise.all([
        apiClient.getAdminOrders({
          search: search.trim() || undefined,
          gameId: gameFilter,
          status: statusFilter,
        }),
        apiClient.getAdminGames(),
        apiClient.getAdminSuppliers().catch(() => ({ suppliers: [] })),
      ]);
      setOrders(ordRes.orders);
      setGames(gameRes.games);
      setSuppliers(supRes.suppliers);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to load orders.');
    } finally {
      setLoading(false);
    }
  }, [search, gameFilter, statusFilter]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  async function openOrderDetail(orderId: string, preserveBanner = false) {
    setDetailLoading(true);
    setDetailError(null);
    if (!preserveBanner) {
      setDetailNotice(null);
    }
    try {
      const res = await apiClient.getAdminOrderById(orderId);
      const ord = res.order;
      setSelectedOrder(ord);
      setEditStatus(ord.status);
      setEditDeliveryMethod(ord.deliveryMethod);
      setEditAdminNote(ord.adminNote || '');
      setEditDeliveryNotes(ord.deliveryNotes || '');
      setEditCustomerMsg(ord.customerDeliveryMessage || '');
      const defaultApiSup =
        suppliers.find((s) => s.isActive && s.integrationType === 'api')?.id ||
        suppliers.find((s) => s.isActive)?.id ||
        '';
      setSelectedSupplierId((prev) => prev || defaultApiSup);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to load order details.');
    } finally {
      setDetailLoading(false);
    }
  }

  async function applyOrderUpdate(payload: {
    status?: string;
    deliveryMethod?: 'manual' | 'automatic' | 'both';
    adminNote?: string;
    deliveryNotes?: string;
    customerDeliveryMessage?: string;
    confirmCompleted?: boolean;
  }) {
    if (!selectedOrder) return;
    setSavingOrder(true);
    setDetailError(null);
    setDetailNotice(null);
    try {
      const res = await apiClient.updateAdminOrder(selectedOrder.id, payload);
      setDetailNotice(
        `Order ${selectedOrder.orderNumber} updated to "${res.displayOrderStatus}".`
      );
      setSuccessMsg(
        `Updated ${selectedOrder.orderNumber} (${res.displayOrderStatus}).`
      );
      await Promise.all([openOrderDetail(selectedOrder.id, true), loadOrders()]);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Unable to update order.');
    } finally {
      setSavingOrder(false);
    }
  }

  async function handleSaveFormSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedOrder) return;

    if (editStatus === 'completed' && selectedOrder.status !== 'completed') {
      setPendingCompletionNote(editDeliveryNotes.trim() || undefined);
      setConfirmCompleteOpen(true);
      return;
    }

    await applyOrderUpdate({
      status: editStatus,
      deliveryMethod: editDeliveryMethod,
      adminNote: editAdminNote,
      deliveryNotes: editDeliveryNotes,
      customerDeliveryMessage: editCustomerMsg,
    });
  }

  function handleQuickManualAction(targetStatus: 'processing' | 'awaiting_delivery' | 'completed' | 'failed' | 'cancelled' | 'refund_pending') {
    if (!selectedOrder) return;
    if (targetStatus === 'completed') {
      setPendingCompletionNote(editDeliveryNotes.trim() || undefined);
      setConfirmCompleteOpen(true);
      return;
    }
    setEditStatus(targetStatus);
    void applyOrderUpdate({
      status: targetStatus,
      deliveryMethod: editDeliveryMethod,
      adminNote: editAdminNote,
      deliveryNotes: editDeliveryNotes,
      customerDeliveryMessage: editCustomerMsg,
    });
  }

  async function handleConfirmCompleteOrder() {
    if (!selectedOrder) return;
    setConfirmCompleteOpen(false);
    setEditStatus('completed');
    await applyOrderUpdate({
      status: 'completed',
      deliveryMethod: editDeliveryMethod,
      adminNote: editAdminNote,
      deliveryNotes: pendingCompletionNote ?? editDeliveryNotes,
      customerDeliveryMessage: editCustomerMsg,
      confirmCompleted: true,
    });
  }

  async function handleDispatchToSupplier() {
    if (!selectedOrder) return;
    setDispatchingSupplier(true);
    setDetailError(null);
    setDetailNotice(null);
    try {
      const res = await apiClient.dispatchOrderToSupplier(
        selectedOrder.id,
        selectedSupplierId || undefined
      );
      if (res.isMock) {
        setDetailNotice(
          `TEST ONLY (MOCK MODE): Simulated supplier dispatch recorded (${res.status}). Order remains open until real fulfillment or manual completion.`
        );
      } else {
        setDetailNotice(`Supplier dispatch recorded with status: ${res.status}.`);
      }
      await Promise.all([openOrderDetail(selectedOrder.id, true), loadOrders()]);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Supplier dispatch failed.');
    } finally {
      setDispatchingSupplier(false);
    }
  }

  async function handleCheckSupplierStatus(supplierOrderId: string) {
    if (!selectedOrder) return;
    setSupplierActionId(supplierOrderId);
    setDetailError(null);
    try {
      const res = await apiClient.checkSupplierOrderStatus(supplierOrderId);
      setDetailNotice(res.notice);
      await openOrderDetail(selectedOrder.id, true);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Unable to check supplier status.');
    } finally {
      setSupplierActionId(null);
    }
  }

  async function handleRetrySupplier(supplierOrderId: string) {
    if (!selectedOrder) return;
    setSupplierActionId(supplierOrderId);
    setDetailError(null);
    try {
      const res = await apiClient.retrySupplierOrder(supplierOrderId);
      setDetailNotice(
        `${res.environmentLabel}: Retry attempt #${res.attemptCount} finished (${res.status}).`
      );
      await Promise.all([openOrderDetail(selectedOrder.id, true), loadOrders()]);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Retry failed.');
    } finally {
      setSupplierActionId(null);
    }
  }

  return (
    <AdminLayout title="Orders & Delivery">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-white">
              Order Processing &amp; Delivery
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Process customer orders manually, review Player &amp; Server IDs, and manage automatic
              supplier dispatch workflows. Unpaid orders stay separated from delivery completion.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadOrders()}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-white/[0.14] text-xs font-medium text-zinc-200 hover:bg-white/[0.05] self-start whitespace-nowrap"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Refresh</span>
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
        <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-4 grid md:grid-cols-3 gap-3">
          <div className="relative">
            <Search
              className="h-4 w-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search Order #, Player ID, Gateway/Supplier Tx ID, email..."
              aria-label="Search orders"
              className="w-full rounded-lg bg-[#09090E] border border-white/[0.12] pl-9 pr-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-blue-500"
            />
          </div>

          <select
            value={gameFilter}
            onChange={(e) => setGameFilter(e.target.value)}
            aria-label="Filter orders by game"
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
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter orders by status"
            className="rounded-lg bg-[#09090E] border border-white/[0.12] px-3 py-2 text-sm text-white focus:border-blue-500"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Orders Table */}
        <div className="bg-[#111118] border border-white/[0.08] rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-8 text-sm text-zinc-400">Loading customer orders...</div>
          ) : orders.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <p className="text-sm font-semibold text-white">No orders found</p>
              <p className="text-xs text-zinc-400">
                Customer top-up orders appear here as soon as they are submitted.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/[0.08] text-zinc-400">
                  <tr>
                    <th className="py-3.5 px-4 font-medium">Order ID &amp; Date</th>
                    <th className="py-3.5 px-4 font-medium">Customer</th>
                    <th className="py-3.5 px-4 font-medium">Game &amp; Package</th>
                    <th className="py-3.5 px-4 font-medium">Player / Server</th>
                    <th className="py-3.5 px-4 font-medium text-right">Amount</th>
                    <th className="py-3.5 px-4 font-medium">Payment</th>
                    <th className="py-3.5 px-4 font-medium">Order &amp; Delivery</th>
                    <th className="py-3.5 px-4 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {orders.map((order) => (
                    <tr key={order.id} className="hover:bg-white/[0.02]">
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="font-mono font-semibold text-white">{order.orderNumber}</div>
                        <div className="text-[11px] text-zinc-400">
                          {new Date(order.createdAt).toLocaleString('en-IN', {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </div>
                        {(order.gatewayPaymentId || order.gatewayOrderId || order.supplierTxId) && (
                          <div className="text-[10px] font-mono text-zinc-500 mt-0.5 truncate max-w-[180px]">
                            {order.gatewayPaymentId || order.gatewayOrderId
                              ? `GW: ${order.gatewayPaymentId || order.gatewayOrderId}`
                              : ''}
                            {order.supplierTxId ? ` SUP: ${order.supplierTxId}` : ''}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="text-zinc-100 font-medium">{order.customerName}</div>
                        <div className="text-[11px] text-zinc-400 truncate max-w-[160px]">
                          {order.customerEmail}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="text-zinc-100 font-medium">{order.gameTitle}</div>
                        <div className="text-[11px] text-zinc-400">
                          {order.packageName} · Qty {order.quantity}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-mono text-white">{order.targetPlayerUid || '—'}</div>
                        <div className="text-[11px] text-zinc-400">
                          {order.targetServerId ? `Server: ${order.targetServerId}` : order.regionName || 'Default'}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-right whitespace-nowrap">
                        <div className="font-semibold text-white">
                          {formatInrPrice(order.totalInr)}
                        </div>
                        <div className="text-[11px] text-zinc-400">
                          Cost {formatInrPrice(order.supplierCostInr)} ·{' '}
                          <span className={order.netProfitInr >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                            {order.netProfitInr >= 0 ? '+' : ''}
                            {formatInrPrice(order.netProfitInr)}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className="inline-block rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-200">
                          {order.displayPaymentStatus}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap space-y-1">
                        <div>
                          <span
                            className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                              BADGE_CLASSES[order.displayOrderStatus] ||
                              'border-white/[0.12] text-zinc-300'
                            }`}
                          >
                            {order.displayOrderStatus}
                          </span>
                        </div>
                        <div className="text-[11px] text-zinc-400 capitalize">
                          {order.deliveryMethod} · {order.displayDeliveryStatus}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => void openOrderDetail(order.id)}
                          aria-label={`Process order ${order.orderNumber}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/20 border border-violet-500/35 text-violet-100 hover:bg-violet-600/35 transition-colors"
                        >
                          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Process</span>
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

      {/* Order Processing & Delivery Drawer/Modal */}
      {(selectedOrder || detailLoading) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="order-detail-title"
        >
          <div className="w-full max-w-4xl max-h-[92vh] flex flex-col rounded-xl border border-white/[0.12] bg-[#111118] overflow-hidden">
            <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between gap-4 shrink-0">
              <div>
                <h3 id="order-detail-title" className="text-base font-semibold text-white">
                  {selectedOrder ? `Order ${selectedOrder.orderNumber}` : 'Loading Order...'}
                </h3>
                {selectedOrder && (
                  <p className="text-xs text-zinc-400">
                    {selectedOrder.gameTitle} · {selectedOrder.packageName} (Qty{' '}
                    {selectedOrder.quantity}) · Created{' '}
                    {new Date(selectedOrder.createdAt).toLocaleString('en-IN')}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                aria-label="Close order details"
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {detailLoading && !selectedOrder ? (
              <div className="p-8 text-sm text-zinc-400">Loading order delivery workspace...</div>
            ) : selectedOrder ? (
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {detailNotice && (
                  <div
                    role="status"
                    className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200"
                  >
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                    <span>{detailNotice}</span>
                  </div>
                )}

                {detailError && (
                  <div
                    role="alert"
                    className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200"
                  >
                    {detailError}
                  </div>
                )}

                {/* Order & Player Summary Cards */}
                <div className="grid md:grid-cols-3 gap-4 text-xs">
                  <div className="rounded-lg border border-white/[0.08] bg-[#09090E] p-4 space-y-2">
                    <div className="text-zinc-400 font-medium">Customer &amp; Payment</div>
                    <div className="text-sm font-semibold text-white">
                      {selectedOrder.customerName}
                    </div>
                    <div className="text-zinc-400">{selectedOrder.customerEmail}</div>
                    <div className="pt-1 border-t border-white/[0.06] flex items-center justify-between">
                      <span className="text-zinc-400">Order Total</span>
                      <span className="font-mono tabular-nums font-semibold text-white">
                        {formatInrPrice(selectedOrder.totalInr)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-400">Supplier Cost</span>
                      <span className="font-mono tabular-nums text-zinc-300">
                        {formatInrPrice(selectedOrder.supplierCostInr)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-400">Net Profit</span>
                      <span
                        className={`font-mono tabular-nums font-semibold ${
                          selectedOrder.netProfitInr >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {formatInrPrice(selectedOrder.netProfitInr)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-400">Payment</span>
                      <span className="text-amber-300 font-medium">
                        {selectedOrder.displayPaymentStatus}
                      </span>
                    </div>
                    {(selectedOrder.gatewayOrderId || selectedOrder.gatewayPaymentId) && (
                      <div className="pt-1 border-t border-white/[0.06] space-y-1">
                        {selectedOrder.gatewayOrderId && (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-zinc-500">Gateway Order</span>
                            <span className="font-mono text-zinc-300 break-all text-right">
                              {selectedOrder.gatewayOrderId}
                            </span>
                          </div>
                        )}
                        {selectedOrder.gatewayPaymentId && (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-zinc-500">Gateway Tx ID</span>
                            <span className="font-mono text-emerald-300 break-all text-right">
                              {selectedOrder.gatewayPaymentId}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                    {selectedOrder.supplierTxId && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-zinc-500">Supplier Tx ID</span>
                        <span className="font-mono text-blue-300 break-all text-right">
                          {selectedOrder.supplierTxId}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-white/[0.08] bg-[#09090E] p-4 space-y-2">
                    <div className="text-zinc-400 font-medium">Target Player Details</div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-400">Player ID</span>
                      <span className="font-mono font-semibold text-white">
                        {selectedOrder.targetPlayerUid || '—'}
                      </span>
                    </div>
                    {selectedOrder.targetServerId && (
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-400">Server ID</span>
                        <span className="font-mono text-white">{selectedOrder.targetServerId}</span>
                      </div>
                    )}
                    {selectedOrder.regionName && (
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-400">Region</span>
                        <span className="text-zinc-200">{selectedOrder.regionName}</span>
                      </div>
                    )}
                    {Object.entries(selectedOrder.playerDetails).map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between gap-2">
                        <span className="text-zinc-500 capitalize">{k.replace(/_/g, ' ')}</span>
                        <span className="font-mono text-zinc-200 break-all">{v}</span>
                      </div>
                    ))}
                    {selectedOrder.customerNote && (
                      <div className="pt-1 border-t border-white/[0.06] text-zinc-400">
                        Customer note: <span className="text-zinc-200">{selectedOrder.customerNote}</span>
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-white/[0.08] bg-[#09090E] p-4 space-y-2">
                    <div className="text-zinc-400 font-medium">Delivery &amp; Handler</div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-400">Order Status</span>
                      <span className="font-semibold text-white">
                        {selectedOrder.displayOrderStatus}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-400">Delivery Status</span>
                      <span className="font-semibold text-blue-300">
                        {selectedOrder.displayDeliveryStatus}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-400">Processed By</span>
                      <span className="text-zinc-200">
                        {selectedOrder.processedByName || 'Unassigned'}
                      </span>
                    </div>
                    {selectedOrder.completedByName && (
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-400">Completed By</span>
                        <span className="text-emerald-300">{selectedOrder.completedByName}</span>
                      </div>
                    )}
                    {selectedOrder.fulfilledAt && (
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-400">Completed At</span>
                        <span className="text-zinc-300">
                          {new Date(selectedOrder.fulfilledAt).toLocaleString('en-IN')}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Unpaid Safety Reminder */}
                <div className="rounded-lg border border-blue-500/25 bg-blue-500/10 p-3 flex items-start gap-2.5 text-xs text-blue-200">
                  <ShieldAlert className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>
                    Real payment gateways are disabled in this phase. Payment status stays{' '}
                    <strong className="text-white">Payment Pending (Unpaid)</strong> — orders cannot
                    be marked Paid or Payment Verified without verified payment confirmation.
                  </span>
                </div>

                {/* Manual Delivery Workflow */}
                <form
                  onSubmit={(e) => void handleSaveFormSubmit(e)}
                  className="rounded-xl border border-white/[0.08] bg-[#0D0D14] p-5 space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <UserCheck className="h-4 w-4 text-violet-400" aria-hidden="true" />
                      <h4 className="text-sm font-semibold text-white">Manual Delivery Controls</h4>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={savingOrder}
                        onClick={() => handleQuickManualAction('processing')}
                        className="px-3 py-1.5 rounded-lg border border-blue-500/35 bg-blue-500/10 text-xs font-medium text-blue-200 hover:bg-blue-500/20 disabled:opacity-50"
                      >
                        Start Processing
                      </button>
                      <button
                        type="button"
                        disabled={savingOrder}
                        onClick={() => handleQuickManualAction('awaiting_delivery')}
                        className="px-3 py-1.5 rounded-lg border border-indigo-500/35 bg-indigo-500/10 text-xs font-medium text-indigo-200 hover:bg-indigo-500/20 disabled:opacity-50"
                      >
                        Mark Awaiting Delivery
                      </button>
                      <button
                        type="button"
                        disabled={savingOrder}
                        onClick={() => handleQuickManualAction('completed')}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                      >
                        Complete Delivery
                      </button>
                      <button
                        type="button"
                        disabled={savingOrder}
                        onClick={() => handleQuickManualAction('failed')}
                        className="px-3 py-1.5 rounded-lg border border-red-500/30 bg-red-500/10 text-xs font-medium text-red-200 hover:bg-red-500/20 disabled:opacity-50"
                      >
                        Mark Failed
                      </button>
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label htmlFor="ord-status" className="block text-xs font-medium text-zinc-300">
                        Order Status
                      </label>
                      <select
                        id="ord-status"
                        value={editStatus}
                        onChange={(e) => setEditStatus(e.target.value)}
                        className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-2 text-sm text-white focus:border-blue-500"
                      >
                        <option value="pending">Pending</option>
                        <option value="payment_pending">Payment Pending</option>
                        <option value="processing">Processing</option>
                        <option value="awaiting_delivery">Awaiting Delivery</option>
                        <option value="completed">Completed (Requires Confirmation)</option>
                        <option value="failed">Failed</option>
                        <option value="cancelled">Cancelled</option>
                        <option value="refund_pending">Refund Pending</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label
                        htmlFor="ord-delivery-method"
                        className="block text-xs font-medium text-zinc-300"
                      >
                        Delivery Method
                      </label>
                      <select
                        id="ord-delivery-method"
                        value={editDeliveryMethod}
                        onChange={(e) =>
                          setEditDeliveryMethod(
                            e.target.value as 'manual' | 'automatic' | 'both'
                          )
                        }
                        className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-2 text-sm text-white focus:border-blue-500"
                      >
                        <option value="manual">Manual</option>
                        <option value="automatic">Automatic (Supplier)</option>
                        <option value="both">Both (Hybrid)</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label
                        htmlFor="ord-delivery-notes"
                        className="block text-xs font-medium text-zinc-300"
                      >
                        Internal Delivery Notes (Reference / Txn Proof)
                      </label>
                      <textarea
                        id="ord-delivery-notes"
                        rows={2}
                        value={editDeliveryNotes}
                        onChange={(e) => setEditDeliveryNotes(e.target.value)}
                        placeholder="Record manual top-up receipt, operator notes..."
                        className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-2 text-xs text-white focus:border-blue-500"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="ord-admin-note" className="block text-xs font-medium text-zinc-300">
                        Internal Admin Note
                      </label>
                      <textarea
                        id="ord-admin-note"
                        rows={2}
                        value={editAdminNote}
                        onChange={(e) => setEditAdminNote(e.target.value)}
                        placeholder="Internal team note (hidden from customer)..."
                        className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-2 text-xs text-white focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="ord-customer-msg" className="block text-xs font-medium text-zinc-300">
                      Customer-Visible Delivery Message (Displayed in My Orders)
                    </label>
                    <input
                      id="ord-customer-msg"
                      type="text"
                      maxLength={400}
                      value={editCustomerMsg}
                      onChange={(e) => setEditCustomerMsg(e.target.value)}
                      placeholder="e.g. Credited 1,000 VP to Player ID via direct top-up desk."
                      className="w-full rounded-lg bg-[#09090E] border border-white/[0.14] px-3.5 py-2 text-sm text-white focus:border-blue-500"
                    />
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={savingOrder}
                      className="px-4 py-2 rounded-lg bg-violet-600 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
                    >
                      {savingOrder ? 'Saving Update...' : 'Save Order Update'}
                    </button>
                  </div>
                </form>

                {/* Automatic Supplier Delivery (MOCK MODE / Architecture) */}
                <div className="rounded-xl border border-amber-500/25 bg-[#0D0D14] p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Bot className="h-4 w-4 text-amber-400" aria-hidden="true" />
                        <h4 className="text-sm font-semibold text-white">
                          Automatic Supplier Dispatch
                        </h4>
                        <span className="rounded border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-mono font-semibold text-amber-200">
                          TEST ONLY (MOCK MODE)
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400">
                        Suppliers running in Mock Mode simulate dispatch for workflow validation and
                        never perform a real game top-up or auto-complete an order.
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        value={selectedSupplierId}
                        onChange={(e) => setSelectedSupplierId(e.target.value)}
                        aria-label="Select supplier for dispatch"
                        className="rounded-lg bg-[#09090E] border border-white/[0.14] px-3 py-2 text-xs text-white"
                      >
                        <option value="">Auto-select active supplier</option>
                        {suppliers
                          .filter((s) => s.isActive)
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name} ({s.mode === 'mock' ? 'MOCK MODE' : 'LIVE'})
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        disabled={dispatchingSupplier}
                        onClick={() => void handleDispatchToSupplier()}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-amber-500/40 bg-amber-500/15 text-xs font-semibold text-amber-100 hover:bg-amber-500/25 disabled:opacity-50 whitespace-nowrap"
                      >
                        <Send className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{dispatchingSupplier ? 'Dispatching...' : 'Dispatch to Supplier'}</span>
                      </button>
                    </div>
                  </div>

                  {selectedOrder.supplierOrders && selectedOrder.supplierOrders.length > 0 ? (
                    <div className="space-y-2.5">
                      {selectedOrder.supplierOrders.map((so) => (
                        <div
                          key={so.id}
                          className="rounded-lg border border-white/[0.08] bg-[#09090E] p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                        >
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-white">{so.supplierName}</span>
                              {so.isMock && (
                                <span className="rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-mono text-amber-200">
                                  {so.environmentLabel}
                                </span>
                              )}
                              <span className="font-mono text-zinc-400">
                                Ref: {so.externalReference || 'None'}
                              </span>
                            </div>
                            <div className="text-zinc-400">
                              Status: <strong className="text-white uppercase">{so.status}</strong> ·
                              Attempts:{' '}
                              <span className="font-mono">
                                {so.attemptCount}/{so.maxAttempts}
                              </span>
                              {so.errorMessage && (
                                <span className="text-red-300 ml-2">· {so.errorMessage}</span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              disabled={supplierActionId === so.id}
                              onClick={() => void handleCheckSupplierStatus(so.id)}
                              className="px-2.5 py-1.5 rounded-lg border border-white/[0.12] text-zinc-200 hover:bg-white/[0.06] disabled:opacity-50"
                            >
                              Check Status
                            </button>
                            {so.status !== 'completed' && so.attemptCount < so.maxAttempts && (
                              <button
                                type="button"
                                disabled={supplierActionId === so.id}
                                onClick={() => void handleRetrySupplier(so.id)}
                                className="px-2.5 py-1.5 rounded-lg border border-blue-500/35 bg-blue-500/10 text-blue-200 hover:bg-blue-500/20 disabled:opacity-50"
                              >
                                Retry
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-zinc-500">
                      No supplier dispatch attempts recorded for this order yet.
                    </div>
                  )}
                </div>

                {/* Delivery Audit Trail */}
                <div className="rounded-xl border border-white/[0.08] bg-[#0D0D14] p-5 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Clock className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                    <span>Delivery &amp; Status History</span>
                  </div>
                  {selectedOrder.deliveryLogs && selectedOrder.deliveryLogs.length > 0 ? (
                    <ul className="space-y-2 text-xs">
                      {selectedOrder.deliveryLogs.map((log) => (
                        <li
                          key={log.id}
                          className="rounded-lg border border-white/[0.06] bg-[#09090E] p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                        >
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-white">{log.actorLabel}</span>
                              <span className="font-mono text-[10px] text-zinc-500 uppercase">
                                {log.eventType}
                              </span>
                              {log.isMock && (
                                <span className="inline-flex items-center gap-1 rounded border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-200">
                                  <AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" />
                                  MOCK
                                </span>
                              )}
                            </div>
                            <p className="text-zinc-300">{log.message}</p>
                          </div>
                          <span className="font-mono text-[11px] text-zinc-500 whitespace-nowrap">
                            {new Date(log.createdAt).toLocaleString('en-IN')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-xs text-zinc-500">No delivery log entries recorded yet.</div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmCompleteOpen}
        title={`Confirm Delivery Completed for ${selectedOrder?.orderNumber || 'Order'}?`}
        message={`Please confirm that ${selectedOrder?.packageName || 'the package'} (Qty ${selectedOrder?.quantity || 1}) has actually been credited to Player ID "${selectedOrder?.targetPlayerUid || ''}". Completed orders cannot be undone automatically.`}
        confirmLabel="Confirm & Complete Delivery"
        loading={savingOrder}
        onConfirm={() => void handleConfirmCompleteOrder()}
        onCancel={() => setConfirmCompleteOpen(false)}
      />
    </AdminLayout>
  );
}
