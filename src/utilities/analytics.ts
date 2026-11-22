import type { AdminSalesAnalytics, SalesChartPoint, SalesPeriodKpi } from '../types/api';

export interface AnalyticsOrderInput {
  id: string;
  totalInr: number;
  supplierCostInr: number;
  status: string;
  paymentStatus: string;
  createdAt: string | Date;
}

export interface AnalyticsRefundInput {
  orderId?: string;
  amountInr: number;
  createdAt: string | Date;
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function toMs(value: string | Date): number {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function summarizeBucket(
  orders: AnalyticsOrderInput[],
  refunds: AnalyticsRefundInput[]
): SalesPeriodKpi {
  let grossRevenueInr = 0;
  let supplierCostInr = 0;
  let refundsInr = 0;

  for (const ord of orders) {
    if (ord.status === 'cancelled' || ord.status === 'failed') continue;
    grossRevenueInr += Number.isFinite(ord.totalInr) ? ord.totalInr : 0;
    supplierCostInr += Number.isFinite(ord.supplierCostInr) ? ord.supplierCostInr : 0;
  }

  for (const ref of refunds) {
    refundsInr += Number.isFinite(ref.amountInr) ? ref.amountInr : 0;
  }

  grossRevenueInr = roundTwo(grossRevenueInr);
  supplierCostInr = roundTwo(supplierCostInr);
  refundsInr = roundTwo(refundsInr);

  const netProfitInr = roundTwo(grossRevenueInr - supplierCostInr - refundsInr);
  const netMarginPercent =
    grossRevenueInr > 0 ? roundTwo((netProfitInr / grossRevenueInr) * 100) : 0;

  return {
    grossRevenueInr,
    supplierCostInr,
    refundsInr,
    netProfitInr,
    netMarginPercent,
    orderCount: orders.filter((o) => o.status !== 'cancelled' && o.status !== 'failed').length,
  };
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatUtcDayLabel(ms: number): string {
  const d = new Date(ms);
  return `${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function buildSalesAnalytics(
  rawOrders: AnalyticsOrderInput[],
  rawRefunds: AnalyticsRefundInput[],
  now: Date = new Date()
): AdminSalesAnalytics {
  const nowMs = now.getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;

  // Include explicit processed refunds + any order in 'refunded' status without an explicit refund row
  const refundOrderIds = new Set(
    rawRefunds.map((r) => r.orderId).filter((id): id is string => Boolean(id))
  );
  const effectiveRefunds: AnalyticsRefundInput[] = [...rawRefunds];
  for (const ord of rawOrders) {
    if (ord.status === 'refunded' && !refundOrderIds.has(ord.id)) {
      effectiveRefunds.push({
        orderId: ord.id,
        amountInr: ord.totalInr,
        createdAt: ord.createdAt,
      });
    }
  }

  const filterWindow = <T extends { createdAt: string | Date }>(items: T[], windowMs: number | null) => {
    if (windowMs === null) return items;
    const cutoff = nowMs - windowMs;
    return items.filter((item) => toMs(item.createdAt) >= cutoff);
  };

  const periods = {
    day: summarizeBucket(filterWindow(rawOrders, DAY_MS), filterWindow(effectiveRefunds, DAY_MS)),
    week: summarizeBucket(
      filterWindow(rawOrders, 7 * DAY_MS),
      filterWindow(effectiveRefunds, 7 * DAY_MS)
    ),
    month: summarizeBucket(
      filterWindow(rawOrders, 30 * DAY_MS),
      filterWindow(effectiveRefunds, 30 * DAY_MS)
    ),
    all: summarizeBucket(rawOrders, effectiveRefunds),
  };

  // Daily series: last 14 UTC calendar days
  const todayStartUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daySeries: SalesChartPoint[] = [];
  for (let i = 13; i >= 0; i--) {
    const start = todayStartUtc - i * DAY_MS;
    const end = start + DAY_MS;
    const bucketOrders = rawOrders.filter((o) => {
      const t = toMs(o.createdAt);
      return t >= start && t < end;
    });
    const bucketRefunds = effectiveRefunds.filter((r) => {
      const t = toMs(r.createdAt);
      return t >= start && t < end;
    });
    const kpi = summarizeBucket(bucketOrders, bucketRefunds);
    daySeries.push({
      label: formatUtcDayLabel(start),
      ...kpi,
    });
  }

  // Weekly series: last 8 7-day rolling windows aligned to today end
  const weekSeries: SalesChartPoint[] = [];
  for (let i = 7; i >= 0; i--) {
    const end = todayStartUtc + DAY_MS - i * 7 * DAY_MS;
    const start = end - 7 * DAY_MS;
    const bucketOrders = rawOrders.filter((o) => {
      const t = toMs(o.createdAt);
      return t >= start && t < end;
    });
    const bucketRefunds = effectiveRefunds.filter((r) => {
      const t = toMs(r.createdAt);
      return t >= start && t < end;
    });
    const kpi = summarizeBucket(bucketOrders, bucketRefunds);
    weekSeries.push({
      label: formatUtcDayLabel(start),
      ...kpi,
    });
  }

  // Monthly series: last 6 calendar months
  const monthSeries: SalesChartPoint[] = [];
  for (let i = 5; i >= 0; i--) {
    const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1));
    const start = startDate.getTime();
    const end = endDate.getTime();
    const bucketOrders = rawOrders.filter((o) => {
      const t = toMs(o.createdAt);
      return t >= start && t < end;
    });
    const bucketRefunds = effectiveRefunds.filter((r) => {
      const t = toMs(r.createdAt);
      return t >= start && t < end;
    });
    const kpi = summarizeBucket(bucketOrders, bucketRefunds);
    monthSeries.push({
      label: `${SHORT_MONTHS[startDate.getUTCMonth()]} ${String(startDate.getUTCFullYear()).slice(-2)}`,
      ...kpi,
    });
  }

  return {
    periods,
    series: {
      day: daySeries,
      week: weekSeries,
      month: monthSeries,
    },
  };
}
