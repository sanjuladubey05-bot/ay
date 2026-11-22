import crypto from 'node:crypto';
import type { PaymentMode, PaymentStatus } from '../types/database';

/**
 * Converts a positive INR amount to integer paise cleanly, preventing floating-point drift.
 */
export function convertInrToPaise(amountInr: number): number {
  if (!Number.isFinite(amountInr) || amountInr <= 0) {
    throw new Error('Order amount in INR must be a positive finite number.');
  }
  const paise = Math.round((amountInr + Number.EPSILON) * 100);
  if (paise <= 0) {
    throw new Error('Converted amount in paise must be greater than zero.');
  }
  return paise;
}

/**
 * Verifies Razorpay Standard Checkout payment signature:
 * HMAC_SHA256(razorpay_order_id + "|" + razorpay_payment_id, key_secret)
 */
export function verifyRazorpayOrderSignature(params: {
  orderId: string;
  paymentId: string;
  signature: string;
  keySecret: string;
}): boolean {
  const { orderId, paymentId, signature, keySecret } = params;
  if (!orderId || !paymentId || !signature || !keySecret) {
    return false;
  }

  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const receivedBuf = Buffer.from(signature.trim(), 'utf8');
  if (expectedBuf.length !== receivedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

/**
 * Verifies Razorpay Webhook X-Razorpay-Signature against raw request body.
 */
export function verifyRazorpayWebhookSignature(params: {
  rawBody: string | Buffer;
  signature: string;
  webhookSecret: string;
}): boolean {
  const { rawBody, signature, webhookSecret } = params;
  if (!rawBody || !signature || !webhookSecret) {
    return false;
  }

  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const receivedBuf = Buffer.from(signature.trim(), 'utf8');
  if (expectedBuf.length !== receivedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

const ALLOWED_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  pending: ['processing', 'authorized', 'captured', 'failed'],
  processing: ['authorized', 'captured', 'failed'],
  // Authorized and captured are strictly distinct states; fulfillment requires captured.
  authorized: ['captured', 'failed', 'refunded'],
  captured: ['partially_refunded', 'refunded'],
  partially_refunded: ['partially_refunded', 'refunded'],
  failed: [],
  refunded: [],
};

export function canTransitionPaymentStatus(
  fromStatus: PaymentStatus,
  toStatus: PaymentStatus
): boolean {
  if (fromStatus === toStatus) {
    return true;
  }
  return ALLOWED_TRANSITIONS[fromStatus].includes(toStatus);
}

export function isFulfillmentAuthorized(status: PaymentStatus): boolean {
  return status === 'captured';
}

export interface PaymentModeGuardResult {
  allowed: boolean;
  reason?: string;
  code?:
    | 'MISSING_CREDENTIALS'
    | 'TEST_MODE_LIVE_KEY_CONFLICT'
    | 'LIVE_MODE_TEST_KEY_CONFLICT'
    | 'LIVE_MODE_WEBHOOK_MISSING'
    | 'LIVE_MODE_CHECKLIST_INCOMPLETE';
}

/**
 * Enforces strict separation between Test Mode and Live Mode.
 * Test Mode cannot accidentally initiate live transactions, and Live Mode
 * cannot activate until live credentials, webhook secret, and checklist are ready.
 */
export function evaluatePaymentModeGuard(params: {
  mode: PaymentMode;
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  liveChecklistComplete: boolean;
}): PaymentModeGuardResult {
  const { mode, keyId, keySecret, webhookSecret, liveChecklistComplete } = params;

  if (!keyId || !keySecret) {
    return {
      allowed: false,
      code: 'MISSING_CREDENTIALS',
      reason:
        'Razorpay API credentials (RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET) are not configured on the server.',
    };
  }

  if (mode === 'test') {
    if (keyId.startsWith('rzp_live_')) {
      return {
        allowed: false,
        code: 'TEST_MODE_LIVE_KEY_CONFLICT',
        reason:
          'Refusing transaction: server is in TEST MODE but a live Razorpay key (rzp_live_*) was supplied.',
      };
    }
    return { allowed: true };
  }

  // Live mode guardrails
  if (!keyId.startsWith('rzp_live_')) {
    return {
      allowed: false,
      code: 'LIVE_MODE_TEST_KEY_CONFLICT',
      reason:
        'Live mode requires a verified live Razorpay key (rzp_live_*).',
    };
  }

  if (!webhookSecret) {
    return {
      allowed: false,
      code: 'LIVE_MODE_WEBHOOK_MISSING',
      reason:
        'Live mode requires RAZORPAY_WEBHOOK_SECRET to be configured for server-side reconciliation.',
    };
  }

  if (!liveChecklistComplete) {
    return {
      allowed: false,
      code: 'LIVE_MODE_CHECKLIST_INCOMPLETE',
      reason:
        'Live mode cannot be enabled until all Razorpay Business Readiness checklist prerequisites are completed.',
    };
  }

  return { allowed: true };
}
