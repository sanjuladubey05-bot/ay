import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeNormalizedPackagePricing,
  computeProfitMargin,
  detectImageExtensionFromMagicBytes,
  isValidAdminOrderStatusTransition,
  MAX_MEDIA_UPLOAD_BYTES,
  slugifyCatalogText,
} from './pricing';

test('computeNormalizedPackagePricing computes discounts cleanly and blocks invalid values', () => {
  const discounted = computeNormalizedPackagePricing({
    priceInr: 400,
    originalPriceInr: 500,
  });
  assert.equal(discounted.valid, true);
  assert.equal(discounted.priceInr, 400);
  assert.equal(discounted.originalPriceInr, 500);
  assert.equal(discounted.discountPercent, 20);

  const fromPercent = computeNormalizedPackagePricing({
    originalPriceInr: 1000,
    discountPercent: 15,
  });
  assert.equal(fromPercent.valid, true);
  assert.equal(fromPercent.priceInr, 850);
  assert.equal(fromPercent.discountPercent, 15);

  const invalidHighPrice = computeNormalizedPackagePricing({
    priceInr: 600,
    originalPriceInr: 500,
  });
  assert.equal(invalidHighPrice.valid, false);
  assert.match(invalidHighPrice.error || '', /cannot exceed/i);

  const invalidExcessDiscount = computeNormalizedPackagePricing({
    priceInr: 10,
    originalPriceInr: 1000,
  });
  assert.equal(invalidExcessDiscount.valid, false);
});

test('detectImageExtensionFromMagicBytes verifies real PNG/JPEG/WebP signatures and blocks unsafe files', () => {
  const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  assert.deepEqual(detectImageExtensionFromMagicBytes(pngHeader, 'image/png'), {
    valid: true,
    ext: 'png',
    mime: 'image/png',
  });

  const jpgHeader = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
  assert.deepEqual(detectImageExtensionFromMagicBytes(jpgHeader, 'image/jpeg'), {
    valid: true,
    ext: 'jpg',
    mime: 'image/jpeg',
  });

  const svgSpoof = new TextEncoder().encode('<svg onload="alert(1)"></svg>');
  const rejectedMime = detectImageExtensionFromMagicBytes(svgSpoof, 'image/svg+xml');
  assert.equal(rejectedMime.valid, false);

  const rejectedSpoofed = detectImageExtensionFromMagicBytes(svgSpoof, 'image/png');
  assert.equal(rejectedSpoofed.valid, false);

  const oversized = new Uint8Array(MAX_MEDIA_UPLOAD_BYTES + 1);
  oversized.set(pngHeader);
  assert.equal(detectImageExtensionFromMagicBytes(oversized, 'image/png').valid, false);
});

test('isValidAdminOrderStatusTransition prevents paid/refunded status in Phase 3', () => {
  assert.equal(isValidAdminOrderStatusTransition('pending'), true);
  assert.equal(isValidAdminOrderStatusTransition('fulfilling'), true);
  assert.equal(isValidAdminOrderStatusTransition('completed'), true);
  assert.equal(isValidAdminOrderStatusTransition('cancelled'), true);
  assert.equal(isValidAdminOrderStatusTransition('failed'), true);
  assert.equal(isValidAdminOrderStatusTransition('paid'), false);
  assert.equal(isValidAdminOrderStatusTransition('refunded'), false);
});

test('slugifyCatalogText formats game titles cleanly', () => {
  assert.equal(slugifyCatalogText('Example Mobile Game 2!'), 'example-mobile-game-2');
});

test('computeProfitMargin calculates net profit INR and margin percent accurately', () => {
  assert.deepEqual(computeProfitMargin({ sellingPriceInr: 1000, supplierCostInr: 750 }), {
    netProfitInr: 250,
    marginPercent: 25,
  });
  assert.deepEqual(computeProfitMargin({ sellingPriceInr: 199, supplierCostInr: 0 }), {
    netProfitInr: 199,
    marginPercent: 100,
  });
  assert.deepEqual(computeProfitMargin({ sellingPriceInr: 100, supplierCostInr: -50 }), {
    netProfitInr: 100,
    marginPercent: 100,
  });
  assert.deepEqual(computeProfitMargin({ sellingPriceInr: 0, supplierCostInr: 20 }), {
    netProfitInr: -20,
    marginPercent: 0,
  });
});
