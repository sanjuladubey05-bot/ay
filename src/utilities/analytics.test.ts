import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSalesAnalytics } from './analytics';

test('buildSalesAnalytics aggregates Day/Week/Month/All KPIs, excludes failed/cancelled orders, and deducts refunds', () => {
  const now = new Date('2026-06-15T12:00:00.000Z');

  const analytics = buildSalesAnalytics(
    [
      // Today (inside day/week/month/all)
      {
        id: 'o1',
        totalInr: 1000,
        supplierCostInr: 700,
        status: 'completed',
        paymentStatus: 'captured',
        createdAt: '2026-06-15T10:00:00.000Z',
      },
      // Failed today (excluded from revenue/cost/count)
      {
        id: 'o2',
        totalInr: 500,
        supplierCostInr: 400,
        status: 'failed',
        paymentStatus: 'failed',
        createdAt: '2026-06-15T09:00:00.000Z',
      },
      // Cancelled 2 days ago (excluded)
      {
        id: 'o3',
        totalInr: 400,
        supplierCostInr: 300,
        status: 'cancelled',
        paymentStatus: 'pending',
        createdAt: '2026-06-13T08:00:00.000Z',
      },
      // 3 days ago (inside week/month/all)
      {
        id: 'o4',
        totalInr: 2000,
        supplierCostInr: 1500,
        status: 'paid',
        paymentStatus: 'captured',
        createdAt: '2026-06-12T12:00:00.000Z',
      },
      // 20 days ago (inside month/all)
      {
        id: 'o5',
        totalInr: 500,
        supplierCostInr: 350,
        status: 'refunded',
        paymentStatus: 'refunded',
        createdAt: '2026-05-26T12:00:00.000Z',
      },
      // 60 days ago (all-time only)
      {
        id: 'o6',
        totalInr: 1500,
        supplierCostInr: 1000,
        status: 'completed',
        paymentStatus: 'captured',
        createdAt: '2026-04-10T12:00:00.000Z',
      },
    ],
    [
      // Partial refund recorded explicitly for o4
      {
        orderId: 'o4',
        amountInr: 200,
        createdAt: '2026-06-13T10:00:00.000Z',
      },
    ],
    now
  );

  // Day: only o1
  assert.equal(analytics.periods.day.grossRevenueInr, 1000);
  assert.equal(analytics.periods.day.supplierCostInr, 700);
  assert.equal(analytics.periods.day.refundsInr, 0);
  assert.equal(analytics.periods.day.netProfitInr, 300);
  assert.equal(analytics.periods.day.netMarginPercent, 30);
  assert.equal(analytics.periods.day.orderCount, 1);

  // Week: o1 + o4, minus 200 refund
  assert.equal(analytics.periods.week.grossRevenueInr, 3000);
  assert.equal(analytics.periods.week.supplierCostInr, 2200);
  assert.equal(analytics.periods.week.refundsInr, 200);
  assert.equal(analytics.periods.week.netProfitInr, 600);
  assert.equal(analytics.periods.week.orderCount, 2);

  // Month: o1 + o4 + o5, minus 200 + 500 implicit refund from refunded o5
  assert.equal(analytics.periods.month.grossRevenueInr, 3500);
  assert.equal(analytics.periods.month.supplierCostInr, 2550);
  assert.equal(analytics.periods.month.refundsInr, 700);
  assert.equal(analytics.periods.month.netProfitInr, 250);
  assert.equal(analytics.periods.month.orderCount, 3);

  // All: o1 + o4 + o5 + o6
  assert.equal(analytics.periods.all.grossRevenueInr, 5000);
  assert.equal(analytics.periods.all.supplierCostInr, 3550);
  assert.equal(analytics.periods.all.refundsInr, 700);
  assert.equal(analytics.periods.all.netProfitInr, 750);
  assert.equal(analytics.periods.all.orderCount, 4);

  // Series bucket counts
  assert.equal(analytics.series.day.length, 14);
  assert.equal(analytics.series.week.length, 8);
  assert.equal(analytics.series.month.length, 6);
});
