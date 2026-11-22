export type Phase4OrderStatus =
  | 'pending'
  | 'payment_pending'
  | 'awaiting_payment'
  | 'payment_verified'
  | 'paid'
  | 'processing'
  | 'fulfilling'
  | 'awaiting_delivery'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'refund_pending'
  | 'refunded';

export type OrderDisplayStatusLabel =
  | 'Pending'
  | 'Payment Pending'
  | 'Payment Verified'
  | 'Processing'
  | 'Awaiting Delivery'
  | 'Completed'
  | 'Failed'
  | 'Cancelled'
  | 'Refund Pending'
  | 'Refunded';

export type DeliveryMethodOption = 'manual' | 'automatic' | 'both';

export const PHASE4_ADMIN_MUTABLE_STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'payment_pending',
  'processing',
  'fulfilling',
  'awaiting_delivery',
  'completed',
  'failed',
  'cancelled',
  'refund_pending',
]);

export function mapPhase4OrderStatusLabel(status: string): OrderDisplayStatusLabel {
  switch (status) {
    case 'payment_pending':
    case 'awaiting_payment':
      return 'Payment Pending';
    case 'payment_verified':
    case 'paid':
      return 'Payment Verified';
    case 'processing':
    case 'fulfilling':
      return 'Processing';
    case 'awaiting_delivery':
      return 'Awaiting Delivery';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    case 'refund_pending':
      return 'Refund Pending';
    case 'refunded':
      return 'Refunded';
    case 'pending':
    default:
      return 'Pending';
  }
}

export function mapPhase4PaymentStatusLabel(paymentStatus: string): string {
  switch (paymentStatus) {
    case 'captured':
      return 'Captured';
    case 'authorized':
      return 'Authorized';
    case 'processing':
      return 'Processing';
    case 'failed':
      return 'Failed';
    case 'refunded':
      return 'Refunded';
    case 'partially_refunded':
      return 'Partially Refunded';
    case 'pending':
    default:
      return 'Payment Pending (Unpaid)';
  }
}

export function mapPhase4DeliveryStatusLabel(
  fulfillmentStatus: string
): 'Pending' | 'Processing' | 'Awaiting Delivery' | 'Delivered' | 'Failed' {
  switch (fulfillmentStatus) {
    case 'delivered':
      return 'Delivered';
    case 'failed':
      return 'Failed';
    case 'awaiting_delivery':
      return 'Awaiting Delivery';
    case 'queued':
    case 'processing':
    case 'manual_review':
      return 'Processing';
    case 'pending':
    default:
      return 'Pending';
  }
}

/**
 * Prevents unpaid orders from ever being marked payment_verified, paid, or refunded
 * manually without verified payment gateway confirmation.
 */
export function isPermittedPhase4AdminOrderStatus(targetStatus: string): boolean {
  return PHASE4_ADMIN_MUTABLE_STATUSES.has(targetStatus);
}

/**
 * Enforces explicit manual confirmation before marking any order completed.
 */
export function validateOrderCompletionGuard(params: {
  targetStatus: string;
  confirmCompleted?: boolean;
}): { allowed: boolean; error?: string } {
  if (params.targetStatus === 'completed' && !params.confirmCompleted) {
    return {
      allowed: false,
      error:
        'Explicit confirmation is required before marking an order as Completed. Verify in-game delivery first.',
    };
  }
  return { allowed: true };
}

/**
 * Resolves the active delivery method from game-level & package-level configuration.
 */
export function resolveOrderDeliveryMethod(params: {
  gameDeliveryMode: 'manual' | 'automatic' | 'hybrid';
  packageDeliveryType: 'manual' | 'automatic' | 'both';
  preferredMethod?: 'manual' | 'automatic';
}): DeliveryMethodOption {
  const { gameDeliveryMode, packageDeliveryType, preferredMethod } = params;

  if (packageDeliveryType === 'manual' && gameDeliveryMode !== 'automatic') {
    return 'manual';
  }

  if (packageDeliveryType === 'automatic' && gameDeliveryMode !== 'manual') {
    return 'automatic';
  }

  if (packageDeliveryType === 'both' || gameDeliveryMode === 'hybrid') {
    if (preferredMethod === 'manual' || preferredMethod === 'automatic') {
      return preferredMethod;
    }
    return 'both';
  }

  return gameDeliveryMode === 'automatic' ? 'automatic' : 'manual';
}

export function evaluateSupplierRetryEligibility(params: {
  status: string;
  attemptCount: number;
  maxAttempts: number;
}): { eligible: boolean; reason?: string } {
  if (params.status === 'completed') {
    return {
      eligible: false,
      reason: 'Cannot retry a supplier order that is already marked completed.',
    };
  }
  if (params.status === 'cancelled') {
    return {
      eligible: false,
      reason: 'Cancelled supplier orders cannot be retried.',
    };
  }
  if (params.attemptCount >= params.maxAttempts) {
    return {
      eligible: false,
      reason: `Maximum retry limit reached (${params.attemptCount}/${params.maxAttempts} attempts).`,
    };
  }
  return { eligible: true };
}

export interface MockSupplierDispatchResponse {
  isMock: true;
  environmentLabel: 'TEST ONLY (MOCK MODE)';
  externalReference: string;
  simulatedStatus: 'submitted';
  notice: string;
  payload: Record<string, unknown>;
}

export function buildMockSupplierDispatchResult(params: {
  orderNumber: string;
  supplierCode: string;
  externalProductCode: string;
  playerUid: string;
  serverId: string | null;
  quantity: number;
}): MockSupplierDispatchResponse {
  const ref = `MOCK-TEST-${params.orderNumber}-${Date.now().toString(36).toUpperCase()}`;
  return {
    isMock: true,
    environmentLabel: 'TEST ONLY (MOCK MODE)',
    externalReference: ref,
    simulatedStatus: 'submitted',
    notice:
      'TEST ONLY (MOCK MODE): Simulated supplier dispatch recorded. No real external API request or real in-game top-up occurred.',
    payload: {
      mode: 'MOCK_TEST_ONLY',
      warning: 'NOT A REAL TOP-UP TRANSACTION',
      supplierCode: params.supplierCode,
      externalProductCode: params.externalProductCode,
      orderNumber: params.orderNumber,
      playerUid: params.playerUid,
      serverId: params.serverId,
      quantity: params.quantity,
      simulatedRef: ref,
      recordedAt: new Date().toISOString(),
    },
  };
}
