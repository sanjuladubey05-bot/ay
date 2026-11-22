import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMockSupplierDispatchResult,
  evaluateSupplierRetryEligibility,
  isPermittedPhase4AdminOrderStatus,
  mapPhase4DeliveryStatusLabel,
  mapPhase4OrderStatusLabel,
  resolveOrderDeliveryMethod,
  validateOrderCompletionGuard,
} from './orderDelivery';

test('Phase 4 status labels map cleanly and keep payment statuses restricted', () => {
  assert.equal(mapPhase4OrderStatusLabel('payment_pending'), 'Payment Pending');
  assert.equal(mapPhase4OrderStatusLabel('awaiting_delivery'), 'Awaiting Delivery');
  assert.equal(mapPhase4OrderStatusLabel('refund_pending'), 'Refund Pending');
  assert.equal(mapPhase4DeliveryStatusLabel('awaiting_delivery'), 'Awaiting Delivery');
  assert.equal(mapPhase4DeliveryStatusLabel('delivered'), 'Delivered');

  // Unpaid orders cannot be marked paid or payment_verified by admin in Phase 4
  assert.equal(isPermittedPhase4AdminOrderStatus('paid'), false);
  assert.equal(isPermittedPhase4AdminOrderStatus('payment_verified'), false);
  assert.equal(isPermittedPhase4AdminOrderStatus('refunded'), false);

  // Permitted manual transitions
  assert.equal(isPermittedPhase4AdminOrderStatus('processing'), true);
  assert.equal(isPermittedPhase4AdminOrderStatus('awaiting_delivery'), true);
  assert.equal(isPermittedPhase4AdminOrderStatus('completed'), true);
  assert.equal(isPermittedPhase4AdminOrderStatus('failed'), true);
});

test('Order completion requires explicit admin confirmation', () => {
  const denied = validateOrderCompletionGuard({ targetStatus: 'completed', confirmCompleted: false });
  assert.equal(denied.allowed, false);

  const allowed = validateOrderCompletionGuard({ targetStatus: 'completed', confirmCompleted: true });
  assert.equal(allowed.allowed, true);
});

test('Delivery method resolves correctly for manual, automatic, and both', () => {
  assert.equal(
    resolveOrderDeliveryMethod({
      gameDeliveryMode: 'manual',
      packageDeliveryType: 'manual',
      preferredMethod: 'automatic',
    }),
    'manual'
  );

  assert.equal(
    resolveOrderDeliveryMethod({
      gameDeliveryMode: 'hybrid',
      packageDeliveryType: 'both',
      preferredMethod: 'automatic',
    }),
    'automatic'
  );

  assert.equal(
    resolveOrderDeliveryMethod({
      gameDeliveryMode: 'hybrid',
      packageDeliveryType: 'both',
    }),
    'both'
  );
});

test('Supplier retry rules respect completion state and max attempts', () => {
  assert.equal(
    evaluateSupplierRetryEligibility({ status: 'completed', attemptCount: 1, maxAttempts: 3 })
      .eligible,
    false
  );
  assert.equal(
    evaluateSupplierRetryEligibility({ status: 'failed', attemptCount: 3, maxAttempts: 3 })
      .eligible,
    false
  );
  assert.equal(
    evaluateSupplierRetryEligibility({ status: 'failed', attemptCount: 1, maxAttempts: 3 })
      .eligible,
    true
  );
});

test('Mock supplier dispatch clearly labels output as TEST ONLY', () => {
  const mockRes = buildMockSupplierDispatchResult({
    orderNumber: 'LPS-TEST-1',
    supplierCode: 'mock-direct-topup',
    externalProductCode: 'SKU-100',
    playerUid: 'Player#01',
    serverId: 'AP',
    quantity: 1,
  });

  assert.equal(mockRes.isMock, true);
  assert.equal(mockRes.environmentLabel, 'TEST ONLY (MOCK MODE)');
  assert.match(mockRes.notice, /TEST ONLY/i);
  assert.equal(mockRes.payload.mode, 'MOCK_TEST_ONLY');
});
