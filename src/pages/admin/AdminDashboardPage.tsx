import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Database,
  Gamepad2,
  Package,
  ShieldCheck,
  ShoppingBag,
  TrendingUp,
  Users,
} from 'lucide-react';
import { ROUTES } from '../../configuration/routes';
import { AdminLayout } from '../../layouts/AdminLayout';
import { apiClient } from '../../services/apiClient';
import type { AdminOverviewResponse } from '../../types/api';
import { formatInrPrice } from '../../utilities/orderDraft';

const STATUS_BADGE_MAP: Record<string, string> = {
  Pending: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  'Payment Pending': 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  'Payment Verified': 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30',
  Processing: 'text-blue-300 bg-blue-500/10 border-blue-500/30',
  'Awaiting Delivery': 'text-indigo-300 bg-indigo-500/10 border-indigo-500/30',
  Completed: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  Failed: 'text-red-300 bg-red-500/10 border-red-500/30',
  Cancelled: 'text-zinc-300 bg-zinc-500/10 border-zinc-500/30',
  'Refund Pending': 'text-orange-300 bg-orange-500/10 border-orange-500/30',
  Refunded: 'text-zinc-300 bg-zinc-500/10 border-zinc-500/30',
};

type AnalyticsTimeframe = 'day' | 'week' | 'month' | 'all';

const TIMEFRAME_OPTIONS: { value: AnalyticsTimeframe; label: string }[] = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
  { value: 'all', label: 'All Time' },
];

export function AdminDashboardPage() {
  const [data, setData] = useState<AdminOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<AnalyticsTimeframe>('month');
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  useEffect(() => {
    apiClient
      .getAdminOverview()
      .then(setData)
      .catch((err) =>
        setErrorMsg(err instanceof Error ? err.message : 'Unable to load dashboard.')
      )
      .finally(() => setLoading(false));
  }, []);

  const activePeriod = data?.salesAnalytics.periods[timeframe];
  const chartSeriesKey = timeframe === 'all' ? 'month' : timeframe;
  const chartPoints = data?.salesAnalytics.series[chartSeriesKey] ?? [];
  const activePoint =
    chartPoints.length > 0
      ? chartPoints[hoveredIdx !== null && hoveredIdx < chartPoints.length ? hoveredIdx : chartPoints.length - 1]
      : null;

  const maxChartVal = Math.max(
    1,
    ...chartPoints.map((pt) => Math.max(pt.grossRevenueInr, pt.supplierCostInr, Math.abs(pt.netProfitInr)))
  );

  return (
    <AdminLayout title="Dashboard">
      {loading ? (
        <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-8 text-sm text-zinc-400">
          Loading store telemetry and database statistics...
        </div>
      ) : errorMsg || !data ? (
        <div
          role="alert"
          className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-sm text-red-200"
        >
          {errorMsg || 'Dashboard data unavailable.'}
        </div>
      ) : (
        <div className="space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl font-bold text-white">Store Overview</h2>
              <p className="mt-1 text-sm text-zinc-400">
                Real-time analytics, profit margins, order queue, and PostgreSQL platform health.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <Link
                to={ROUTES.ADMIN_GAMES}
                className="px-4 py-2 rounded-lg bg-violet-600 text-xs font-semibold text-white hover:bg-violet-500 transition-colors whitespace-nowrap"
              >
                Manage Games
              </Link>
              <Link
                to={ROUTES.ADMIN_ORDERS}
                className="px-4 py-2 rounded-lg border border-white/[0.14] text-xs font-medium text-zinc-200 hover:bg-white/[0.05] transition-colors whitespace-nowrap"
              >
                View All Orders
              </Link>
            </div>
          </div>

          {/* Real-Time Pending Orders Alert Banner */}
          {data.stats.pendingOrders > 0 && (
            <div
              role="status"
              className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3 text-xs text-amber-100">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" aria-hidden="true" />
                <span>
                  <strong className="font-mono tabular-nums text-white">
                    {data.stats.pendingOrders}
                  </strong>{' '}
                  pending {data.stats.pendingOrders === 1 ? 'order requires' : 'orders require'}{' '}
                  payment confirmation or top-up fulfillment.
                </span>
              </div>
              <Link
                to={ROUTES.ADMIN_ORDERS}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/20 text-xs font-semibold text-amber-100 hover:bg-amber-500/30 whitespace-nowrap self-start sm:self-auto"
              >
                <span>Process Pending Orders</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
          )}

          {/* Owner Sales Analytics & Margin Efficiency */}
          {activePeriod && (
            <section aria-label="Owner Sales Analytics" className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-violet-400" aria-hidden="true" />
                  <h3 className="text-base font-semibold text-white">Owner Sales Analytics</h3>
                </div>
                <div
                  role="tablist"
                  aria-label="Analytics timeframe"
                  className="inline-flex rounded-lg border border-white/[0.1] bg-[#111118] p-1 self-start"
                >
                  {TIMEFRAME_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      role="tab"
                      aria-selected={timeframe === opt.value}
                      onClick={() => {
                        setTimeframe(opt.value);
                        setHoveredIdx(null);
                      }}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                        timeframe === opt.value
                          ? 'bg-violet-600 text-white'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-4 space-y-1.5">
                  <div className="text-xs text-zinc-400">Gross Revenue</div>
                  <div className="font-mono tabular-nums text-2xl font-bold text-white">
                    {formatInrPrice(activePeriod.grossRevenueInr)}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-zinc-500">
                    {activePeriod.orderCount} settled / paid orders
                  </div>
                </div>

                <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-4 space-y-1.5">
                  <div className="text-xs text-zinc-400">Supplier Cost</div>
                  <div className="font-mono tabular-nums text-2xl font-bold text-zinc-200">
                    {formatInrPrice(activePeriod.supplierCostInr)}
                  </div>
                  <div className="text-[11px] text-zinc-500">Wholesale cost snapshot</div>
                </div>

                <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-4 space-y-1.5">
                  <div className="text-xs text-zinc-400">Refunds</div>
                  <div className="font-mono tabular-nums text-2xl font-bold text-amber-300">
                    {formatInrPrice(activePeriod.refundsInr)}
                  </div>
                  <div className="text-[11px] text-zinc-500">Processed gateway refunds</div>
                </div>

                <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-4 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-xs text-zinc-400">
                    <span>Net Profit</span>
                    <TrendingUp
                      className={`h-3.5 w-3.5 ${
                        activePeriod.netProfitInr >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                      aria-hidden="true"
                    />
                  </div>
                  <div
                    className={`font-mono tabular-nums text-2xl font-bold ${
                      activePeriod.netProfitInr >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {formatInrPrice(activePeriod.netProfitInr)}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-zinc-400">
                    Net Margin: {activePeriod.netMarginPercent.toFixed(1)}%
                  </div>
                </div>
              </div>

              {/* Revenue vs Cost vs Net Profit Chart + Margin Summary */}
              <div className="grid lg:grid-cols-12 gap-4">
                <div className="lg:col-span-8 bg-[#111118] border border-white/[0.08] rounded-xl p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-semibold text-white">
                        Revenue vs Cost vs Net Profit Trend
                      </h4>
                      <p className="text-[11px] text-zinc-400">
                        {chartSeriesKey === 'day'
                          ? 'Last 14 days (UTC)'
                          : chartSeriesKey === 'week'
                            ? 'Last 8 weekly buckets'
                            : 'Last 6 monthly buckets'}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 text-[11px] text-zinc-300">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-sm bg-violet-500" />
                        Gross Revenue
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-sm bg-slate-500" />
                        Supplier Cost
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
                        Net Profit
                      </span>
                    </div>
                  </div>

                  {chartPoints.length === 0 ? (
                    <div className="py-12 text-center text-xs text-zinc-500">
                      No analytics buckets available yet.
                    </div>
                  ) : (
                    <>
                      <div className="w-full overflow-x-auto">
                        <svg
                          viewBox={`0 0 ${Math.max(560, chartPoints.length * 64)} 190`}
                          className="w-full h-44 min-w-[460px]"
                          role="img"
                          aria-label="Revenue versus supplier cost and net profit bar chart"
                        >
                          {[0.25, 0.5, 0.75, 1].map((frac) => {
                            const y = 150 - frac * 130;
                            return (
                              <line
                                key={frac}
                                x1={12}
                                x2={Math.max(548, chartPoints.length * 64 - 12)}
                                y1={y}
                                y2={y}
                                stroke="rgba(255,255,255,0.06)"
                                strokeDasharray="3 3"
                              />
                            );
                          })}
                          <line
                            x1={12}
                            x2={Math.max(548, chartPoints.length * 64 - 12)}
                            y1={150}
                            y2={150}
                            stroke="rgba(255,255,255,0.14)"
                          />
                          {chartPoints.map((pt, idx) => {
                            const totalWidth = Math.max(560, chartPoints.length * 64);
                            const colWidth = (totalWidth - 24) / chartPoints.length;
                            const centerX = 12 + idx * colWidth + colWidth / 2;
                            const barW = Math.min(12, Math.max(6, colWidth * 0.2));
                            const grossH = Math.max(2, (pt.grossRevenueInr / maxChartVal) * 126);
                            const costH = Math.max(2, (pt.supplierCostInr / maxChartVal) * 126);
                            const profitH = Math.max(
                              2,
                              (Math.max(0, pt.netProfitInr) / maxChartVal) * 126
                            );
                            const isActive = activePoint?.label === pt.label;
                            return (
                              <g
                                key={pt.label}
                                onMouseEnter={() => setHoveredIdx(idx)}
                                onFocus={() => setHoveredIdx(idx)}
                                tabIndex={0}
                                className="cursor-pointer outline-none"
                              >
                                <rect
                                  x={centerX - colWidth * 0.42}
                                  y={12}
                                  width={colWidth * 0.84}
                                  height={140}
                                  rx={4}
                                  fill={isActive ? 'rgba(255,255,255,0.04)' : 'transparent'}
                                />
                                <rect
                                  x={centerX - barW * 1.65}
                                  y={150 - grossH}
                                  width={barW}
                                  height={grossH}
                                  rx={2}
                                  fill="#7C3AED"
                                />
                                <rect
                                  x={centerX - barW * 0.5}
                                  y={150 - costH}
                                  width={barW}
                                  height={costH}
                                  rx={2}
                                  fill="#64748B"
                                />
                                <rect
                                  x={centerX + barW * 0.65}
                                  y={150 - profitH}
                                  width={barW}
                                  height={profitH}
                                  rx={2}
                                  fill="#10B981"
                                />
                                <text
                                  x={centerX}
                                  y={170}
                                  textAnchor="middle"
                                  fill={isActive ? '#FFFFFF' : '#94A3B8'}
                                  fontSize="10"
                                  fontFamily="monospace"
                                >
                                  {pt.label.length > 7 ? pt.label.slice(5) : pt.label}
                                </text>
                              </g>
                            );
                          })}
                        </svg>
                      </div>

                      {activePoint && (
                        <div className="pt-3 border-t border-white/[0.06] grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                          <div>
                            <span className="text-zinc-500">Bucket: </span>
                            <span className="font-mono text-white">{activePoint.label}</span>
                          </div>
                          <div>
                            <span className="text-zinc-500">Gross: </span>
                            <span className="font-mono tabular-nums text-violet-300">
                              {formatInrPrice(activePoint.grossRevenueInr)}
                            </span>
                          </div>
                          <div>
                            <span className="text-zinc-500">Cost: </span>
                            <span className="font-mono tabular-nums text-zinc-300">
                              {formatInrPrice(activePoint.supplierCostInr)}
                            </span>
                          </div>
                          <div>
                            <span className="text-zinc-500">Net: </span>
                            <span className="font-mono tabular-nums text-emerald-400">
                              {formatInrPrice(activePoint.netProfitInr)} (
                              {activePoint.netMarginPercent.toFixed(1)}%)
                            </span>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="lg:col-span-4 bg-[#111118] border border-white/[0.08] rounded-xl p-5 flex flex-col justify-between gap-4">
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-white">
                      Channel Margin &amp; Security
                    </h4>
                    <div className="rounded-lg border border-white/[0.06] bg-[#09090E] p-3.5 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-400">All-Time Gross</span>
                        <span className="font-mono tabular-nums text-white">
                          {formatInrPrice(data.salesAnalytics.periods.all.grossRevenueInr)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-400">All-Time Net Profit</span>
                        <span className="font-mono tabular-nums text-emerald-400 font-semibold">
                          {formatInrPrice(data.salesAnalytics.periods.all.netProfitInr)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-400">Overall Net Margin</span>
                        <span className="font-mono tabular-nums text-white">
                          {data.salesAnalytics.periods.all.netMarginPercent.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-blue-500/25 bg-blue-500/10 p-3.5 space-y-1 text-xs">
                    <div className="flex items-center gap-1.5 font-semibold text-blue-200">
                      <ShieldCheck className="h-3.5 w-3.5 text-blue-400 shrink-0" aria-hidden="true" />
                      <span>Checkout Rate Protection Active</span>
                    </div>
                    <p className="text-zinc-300 leading-relaxed">
                      Anti-card-testing limiter caps failed checkout attempts at{' '}
                      <span className="font-mono tabular-nums text-white font-semibold">
                        {data.security.failedCheckoutLimitPerMinute}/min per IP
                      </span>{' '}
                      (HTTP 429).
                    </p>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Real Database Statistics Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
            <StatCard label="Total Games" value={data.stats.totalGames} Icon={Gamepad2} />
            <StatCard
              label="Active Games"
              value={data.stats.activeGames}
              accent="text-emerald-400"
              Icon={CheckCircle2}
            />
            <StatCard label="Total Packages" value={data.stats.totalPackages} Icon={Package} />
            <StatCard label="Total Orders" value={data.stats.totalOrders} Icon={ShoppingBag} />
            <StatCard
              label="Pending Orders"
              value={data.stats.pendingOrders}
              accent="text-amber-300"
              Icon={ShoppingBag}
            />
            <StatCard
              label="Completed Orders"
              value={data.stats.completedOrders}
              accent="text-emerald-400"
              Icon={CheckCircle2}
            />
            <StatCard label="Total Customers" value={data.stats.totalCustomers} Icon={Users} />
          </div>

          {/* Recent Orders & Recently Added Games */}
          <div className="grid lg:grid-cols-12 gap-6">
            <section className="lg:col-span-7 bg-[#111118] border border-white/[0.08] rounded-xl overflow-hidden flex flex-col">
              <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between gap-4">
                <h3 className="text-sm font-semibold text-white">Recent Orders</h3>
                <Link
                  to={ROUTES.ADMIN_ORDERS}
                  className="inline-flex items-center gap-1 text-xs font-medium text-violet-400 hover:text-violet-300 whitespace-nowrap"
                >
                  <span>All Orders</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
              {data.recentOrders.length === 0 ? (
                <div className="p-8 text-sm text-zinc-400 text-center">
                  No customer orders have been placed yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-white/[0.08] text-zinc-400">
                      <tr>
                        <th className="py-3 px-4 font-medium">Order ID</th>
                        <th className="py-3 px-4 font-medium">Game / Package</th>
                        <th className="py-3 px-4 font-medium">Customer</th>
                        <th className="py-3 px-4 font-medium text-right">Amount</th>
                        <th className="py-3 px-4 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      {data.recentOrders.map((order) => (
                        <tr key={order.id} className="hover:bg-white/[0.02]">
                          <td className="py-3 px-4 font-mono text-white whitespace-nowrap">
                            {order.orderNumber}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-medium text-zinc-100">{order.gameTitle}</div>
                            <div className="text-zinc-400">{order.packageName}</div>
                          </td>
                          <td className="py-3 px-4 text-zinc-300">
                            <div className="truncate max-w-[140px]">{order.customerName}</div>
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-right text-white whitespace-nowrap">
                            {formatInrPrice(order.totalInr)}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span
                              className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                                STATUS_BADGE_MAP[order.displayOrderStatus] ||
                                'text-zinc-300 border-white/[0.12]'
                              }`}
                            >
                              {order.displayOrderStatus}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="lg:col-span-5 bg-[#111118] border border-white/[0.08] rounded-xl overflow-hidden flex flex-col">
              <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between gap-4">
                <h3 className="text-sm font-semibold text-white">Recently Added Games</h3>
                <Link
                  to={ROUTES.ADMIN_GAMES}
                  className="inline-flex items-center gap-1 text-xs font-medium text-violet-400 hover:text-violet-300 whitespace-nowrap"
                >
                  <span>Manage Catalog</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
              {data.recentGames.length === 0 ? (
                <div className="p-8 text-sm text-zinc-400 text-center">No games added yet.</div>
              ) : (
                <ul className="divide-y divide-white/[0.06]">
                  {data.recentGames.map((game) => (
                    <li
                      key={game.id}
                      className="px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-white/[0.02]"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-10 w-10 rounded-lg overflow-hidden bg-[#09090E] border border-white/[0.08] shrink-0 flex items-center justify-center">
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
                          <div className="text-sm font-medium text-white truncate">
                            {game.title}
                          </div>
                          <div className="text-xs text-zinc-400 truncate">
                            {game.category}
                            {game.isFeatured ? ' · Featured' : ''}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`text-xs font-medium whitespace-nowrap ${
                          game.isActive ? 'text-emerald-400' : 'text-zinc-500'
                        }`}
                      >
                        {game.isActive ? 'Active' : 'Disabled'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* Phase 1 Platform Foundation & Security Strip */}
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-5 space-y-2">
              <div className="text-xs text-zinc-400">PostgreSQL Engine</div>
              <div className="text-lg font-semibold text-white font-mono">
                {data.database.engine === 'postgres' ? 'Supabase PG' : 'Local PostgreSQL'}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Connected · {data.database.migrationsApplied.length} migrations</span>
              </div>
            </div>

            <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-5 space-y-2">
              <div className="text-xs text-zinc-400">Core Tables &amp; RLS</div>
              <div className="text-lg font-semibold text-white font-mono tabular-nums">
                {data.database.coreTablesPresent} / {data.database.coreTablesExpected}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                <Database className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="tabular-nums">
                  {data.database.rlsEnabledTables} tables RLS enforced
                </span>
              </div>
            </div>

            <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-5 space-y-2">
              <div className="text-xs text-zinc-400">Razorpay Readiness</div>
              <div className="text-lg font-semibold text-white uppercase">
                {data.paymentGateway.mode} Mode
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-zinc-400 tabular-nums">
                <span>
                  {data.paymentGateway.checklistCompletedCount} /{' '}
                  {data.paymentGateway.checklistTotalCount} checks
                </span>
                <Link to={ROUTES.ADMIN_SETTINGS} className="text-violet-400 hover:text-violet-300">
                  Configure
                </Link>
              </div>
            </div>

            <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-5 space-y-2">
              <div className="text-xs text-zinc-400">Admin Security</div>
              <div className="text-lg font-semibold text-white font-mono tabular-nums">
                {data.security.auditLogCount} Audit Events
              </div>
              <div className="flex items-center gap-1.5 text-xs text-blue-400">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">Signup locked · Server-only keys</span>
              </div>
            </div>
          </div>

          {/* Recent Audit Logs */}
          <div className="bg-[#111118] border border-white/[0.08] rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Recent Admin Audit Logs</h3>
              <span className="text-xs text-zinc-400 tabular-nums">
                Latest {data.recentAuditLogs.length} entries
              </span>
            </div>
            {data.recentAuditLogs.length === 0 ? (
              <div className="p-8 text-sm text-zinc-400 text-center">No audit events logged yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-white/[0.08] text-zinc-400">
                    <tr>
                      <th className="py-3 px-5 font-medium">Timestamp</th>
                      <th className="py-3 px-5 font-medium">Role</th>
                      <th className="py-3 px-5 font-medium">Action</th>
                      <th className="py-3 px-5 font-medium">Resource</th>
                      <th className="py-3 px-5 font-medium">IP Address</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {data.recentAuditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-white/[0.02]">
                        <td className="py-3 px-5 font-mono tabular-nums text-zinc-400 whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                        <td className="py-3 px-5 text-zinc-300">{log.actor_role}</td>
                        <td className="py-3 px-5 font-mono text-white">{log.action}</td>
                        <td className="py-3 px-5 text-zinc-400">
                          {log.resource_type}
                          {log.resource_id ? ` · ${log.resource_id}` : ''}
                        </td>
                        <td className="py-3 px-5 font-mono tabular-nums text-zinc-400">
                          {log.ip_address || 'local'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function StatCard({
  label,
  value,
  accent = 'text-white',
  Icon,
}: {
  label: string;
  value: number;
  accent?: string;
  Icon: typeof Gamepad2;
}) {
  return (
    <div className="bg-[#111118] border border-white/[0.08] rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs text-zinc-400">
        <span className="truncate">{label}</span>
        <Icon className="h-3.5 w-3.5 text-zinc-500 shrink-0" aria-hidden="true" />
      </div>
      <div className={`font-mono tabular-nums text-2xl font-bold ${accent}`}>
        {value.toLocaleString('en-IN')}
      </div>
    </div>
  );
}
