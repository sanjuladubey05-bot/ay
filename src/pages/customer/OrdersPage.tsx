import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CheckCircle2, Clock, MessageSquare, Receipt } from 'lucide-react';
import { ROUTES } from '../../configuration/routes';
import { useAuth } from '../../hooks/useAuth';
import { apiClient } from '../../services/apiClient';
import type { CustomerOrderItemView, PlaceOrderResponse } from '../../types/api';
import { formatInrPrice } from '../../utilities/orderDraft';

const STATUS_FILTERS: string[] = [
  'All',
  'Payment Pending',
  'Processing',
  'Awaiting Delivery',
  'Completed',
  'Failed',
  'Cancelled',
];

function getOrderStatusColor(status: string): string {
  switch (status) {
    case 'Completed':
      return 'text-emerald-400';
    case 'Payment Verified':
      return 'text-cyan-400';
    case 'Awaiting Delivery':
      return 'text-indigo-300';
    case 'Processing':
      return 'text-blue-400';
    case 'Failed':
      return 'text-red-400';
    case 'Cancelled':
    case 'Refunded':
      return 'text-zinc-400';
    case 'Refund Pending':
      return 'text-orange-300';
    case 'Pending':
    case 'Payment Pending':
    default:
      return 'text-amber-300';
  }
}

function getDeliveryStatusColor(status: string): string {
  switch (status) {
    case 'Delivered':
      return 'text-emerald-400';
    case 'Awaiting Delivery':
      return 'text-indigo-300';
    case 'Processing':
      return 'text-blue-400';
    case 'Failed':
      return 'text-red-400';
    case 'Pending':
    default:
      return 'text-zinc-300';
  }
}

export function OrdersPage() {
  const { user } = useAuth();
  const location = useLocation();
  const justPlacedOrder =
    (location.state as { justPlacedOrder?: PlaceOrderResponse } | null)?.justPlacedOrder || null;

  const [orders, setOrders] = useState<CustomerOrderItemView[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiClient
      .getCustomerOrders()
      .then((res) => {
        if (active) setOrders(res.orders);
      })
      .catch((err) => {
        if (active) {
          setErrorMsg(err instanceof Error ? err.message : 'Unable to load orders.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const filteredOrders =
    statusFilter === 'All'
      ? orders
      : orders.filter((o) => o.displayOrderStatus === statusFilter);

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-14 space-y-8">
      <div className="border-b border-white/[0.08] pb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-blue-400">Customer Order Tracking</div>
          <h1 className="mt-1 font-display text-3xl font-bold text-white">My Orders</h1>
        </div>
        {user && (
          <div className="text-xs text-zinc-400">
            Signed in as <span className="text-zinc-200 font-medium">{user.email}</span>
          </div>
        )}
      </div>

      {justPlacedOrder && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1 text-sm">
              <div className="font-semibold text-white">
                Order {justPlacedOrder.orderNumber} Placed (Payment Pending)
              </div>
              <p className="text-xs text-emerald-100/80">{justPlacedOrder.paymentNotice}</p>
            </div>
          </div>
          <div className="font-mono tabular-nums text-sm font-semibold text-white">
            {formatInrPrice(justPlacedOrder.totalInr)}
          </div>
        </div>
      )}

      {!loading && !errorMsg && orders.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Filter orders by status"
        >
          {STATUS_FILTERS.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                statusFilter === status
                  ? 'bg-violet-600 text-white'
                  : 'bg-[#111118] border border-white/[0.1] text-zinc-300 hover:text-white'
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-8 text-sm text-zinc-400">
          Loading your orders...
        </div>
      ) : errorMsg ? (
        <div
          role="alert"
          className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-sm text-red-200"
        >
          {errorMsg}
        </div>
      ) : orders.length === 0 ? (
        <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-10 text-center space-y-4">
          <div className="mx-auto h-11 w-11 rounded-lg bg-white/[0.05] text-zinc-300 flex items-center justify-center">
            <Receipt className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-white">No Orders Placed Yet</h2>
            <p className="text-sm text-zinc-400 max-w-md mx-auto">
              Browse active games, pick a package, and enter your Player ID to place your first
              top-up order.
            </p>
          </div>
          <div className="pt-2">
            <Link
              to={ROUTES.GAMES}
              className="inline-flex px-4 py-2 rounded-lg bg-violet-600 text-sm font-medium text-white hover:bg-violet-500 transition-colors"
            >
              Explore Games
            </Link>
          </div>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-8 text-center text-sm text-zinc-400">
          No orders in <span className="text-white font-medium">{statusFilter}</span> status.
        </div>
      ) : (
        <div className="space-y-4">
          {filteredOrders.map((order) => (
            <article
              key={order.id}
              className="bg-[#111118] border border-white/[0.08] rounded-xl p-5 sm:p-6 space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/[0.06] pb-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-sm font-semibold text-white">
                      {order.orderNumber}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {new Date(order.createdAt).toLocaleString('en-IN', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                  </div>
                  <div className="text-sm text-zinc-300">
                    <span className="font-semibold text-white">{order.gameTitle}</span>
                    <span> · {order.packageName}</span>
                    {order.quantity > 1 && (
                      <span className="font-mono text-zinc-400"> × {order.quantity}</span>
                    )}
                  </div>
                </div>

                <div className="text-left sm:text-right">
                  <div className="text-xs text-zinc-400">Order Amount</div>
                  <div className="font-mono tabular-nums text-lg font-bold text-white">
                    {formatInrPrice(order.totalInr)}
                  </div>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4 text-xs">
                <div>
                  <div className="text-zinc-500">Order Status</div>
                  <div className={`mt-1 font-semibold ${getOrderStatusColor(order.displayOrderStatus)}`}>
                    {order.displayOrderStatus}
                  </div>
                </div>

                <div>
                  <div className="text-zinc-500">Payment Status</div>
                  <div className="mt-1 font-semibold text-amber-300">
                    {order.displayPaymentStatus}
                  </div>
                </div>

                <div>
                  <div className="text-zinc-500">Delivery Method</div>
                  <div className="mt-1 font-medium text-zinc-200 capitalize">
                    {order.deliveryMethod}
                  </div>
                </div>

                <div>
                  <div className="text-zinc-500">Delivery Status</div>
                  <div
                    className={`mt-1 font-semibold ${getDeliveryStatusColor(order.displayDeliveryStatus)}`}
                  >
                    {order.displayDeliveryStatus}
                  </div>
                </div>

                <div>
                  <div className="text-zinc-500">Player Details</div>
                  <div className="mt-1 font-mono text-zinc-200 break-words">
                    {Object.entries(order.playerDetails)
                      .map(
                        ([k, v]) =>
                          `${k
                            .replace(/_/g, ' ')
                            .replace(/\b\w/g, (ch) => ch.toUpperCase())}: ${v}`
                      )
                      .join(' · ') || 'Submitted'}
                    {order.regionName ? ` (${order.regionName})` : ''}
                  </div>
                </div>
              </div>

              {order.customerDeliveryMessage && (
                <div className="pt-2 border-t border-white/[0.06] flex items-start gap-2 text-xs text-emerald-300">
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{order.customerDeliveryMessage}</span>
                </div>
              )}

              {order.paymentStatus !== 'captured' && order.displayOrderStatus !== 'Completed' && (
                <div className="pt-2 border-t border-white/[0.06] flex items-center gap-2 text-xs text-blue-300">
                  <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>Payment options will be available soon.</span>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
