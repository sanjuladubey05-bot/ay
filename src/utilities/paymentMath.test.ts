import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  canTransitionPaymentStatus,
  convertInrToPaise,
  evaluatePaymentModeGuard,
  isFulfillmentAuthorized,
  verifyRazorpayOrderSignature,
  verifyRazorpayWebhookSignature,
} from './paymentMath';

test('convertInrToPaise converts INR accurately to integer paise', () => {
  assert.equal(convertInrToPaise(1), 100);
  assert.equal(convertInrToPaise(19.99), 1999);
  assert.equal(convertInrToPaise(499.5), 49950);
  assert.throws(() => convertInrToPaise(0));
  assert.throws(() => convertInrToPaise(-10));
});

test('verifyRazorpayOrderSignature validates HMAC-SHA256 signatures strictly', () => {
  const secret = 'test_secret_123';
  const orderId = 'order_test_001';
  const paymentId = 'pay_test_001';
  const validSig = crypto
    .createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  assert.equal(
    verifyRazorpayOrderSignature({ orderId, paymentId, signature: validSig, keySecret: secret }),
    true
  );
  assert.equal(
    verifyRazorpayOrderSignature({
      orderId,
      paymentId,
      signature: '0'.repeat(validSig.length),
      keySecret: secret,
    }),
    false
  );
  assert.equal(
    verifyRazorpayOrderSignature({ orderId, paymentId, signature: validSig, keySecret: 'wrong' }),
    false
  );
});

test('verifyRazorpayWebhookSignature validates raw body HMAC-SHA256', () => {
  const webhookSecret = 'whsec_test_999';
  const rawBody = JSON.stringify({ event: 'payment.captured', payload: { id: 'pay_1' } });
  const sig = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

  assert.equal(verifyRazorpayWebhookSignature({ rawBody, signature: sig, webhookSecret }), true);
  assert.equal(
    verifyRazorpayWebhookSignature({ rawBody: rawBody + ' ', signature: sig, webhookSecret }),
    false
  );
});

test('payment status transitions enforce distinction between authorized and captured', () => {
  assert.equal(isFulfillmentAuthorized('authorized'), false);
  assert.equal(isFulfillmentAuthorized('captured'), true);
  assert.equal(canTransitionPaymentStatus('pending', 'authorized'), true);
  assert.equal(canTransitionPaymentStatus('authorized', 'captured'), true);
  assert.equal(canTransitionPaymentStatus('captured', 'refunded'), true);
  assert.equal(canTransitionPaymentStatus('failed', 'captured'), false);
  assert.equal(canTransitionPaymentStatus('refunded', 'captured'), false);
});

test('evaluatePaymentModeGuard handles missing credentials and prevents Test/Live leakage', () => {
  const missing = evaluatePaymentModeGuard({
    mode: 'test',
    keyId: '',
    keySecret: '',
    webhookSecret: '',
    liveChecklistComplete: false,
  });
  assert.equal(missing.allowed, false);
  assert.equal(missing.code, 'MISSING_CREDENTIALS');

  const testWithLiveKey = evaluatePaymentModeGuard({
    mode: 'test',
    keyId: 'rzp_live_12345',
    keySecret: 'secret',
    webhookSecret: '',
    liveChecklistComplete: true,
  });
  assert.equal(testWithLiveKey.allowed, false);
  assert.equal(testWithLiveKey.code, 'TEST_MODE_LIVE_KEY_CONFLICT');

  const liveWithoutChecklist = evaluatePaymentModeGuard({
    mode: 'live',
    keyId: 'rzp_live_12345',
    keySecret: 'secret',
    webhookSecret: 'whsec',
    liveChecklistComplete: false,
  });
  assert.equal(liveWithoutChecklist.allowed, false);
  assert.equal(liveWithoutChecklist.code, 'LIVE_MODE_CHECKLIST_INCOMPLETE');

  const validTest = evaluatePaymentModeGuard({
    mode: 'test',
    keyId: 'rzp_test_12345',
    keySecret: 'secret',
    webhookSecret: '',
    liveChecklistComplete: false,
  });
  assert.equal(validTest.allowed, true);
});
