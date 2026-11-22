export interface PricingComputationInput {
  priceInr?: number;
  originalPriceInr?: number | null;
  discountPercent?: number;
}

export interface PricingComputationResult {
  valid: boolean;
  error?: string;
  priceInr: number;
  originalPriceInr: number | null;
  discountPercent: number;
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Normalizes INR selling price, optional original price, and discount percentage.
 * - If originalPriceInr > priceInr, discountPercent is calculated cleanly from the delta.
 * - If originalPriceInr and discountPercent (>0) are passed without priceInr, selling price is computed.
 * - Rejects negative prices, selling prices above original price, or discounts >= 100%.
 */
export function computeNormalizedPackagePricing(
  input: PricingComputationInput
): PricingComputationResult {
  const original =
    input.originalPriceInr !== undefined &&
    input.originalPriceInr !== null &&
    Number.isFinite(input.originalPriceInr)
      ? roundTwo(input.originalPriceInr)
      : null;

  if (original !== null && original <= 0) {
    return {
      valid: false,
      error: 'Original price must be greater than ₹0.',
      priceInr: 0,
      originalPriceInr: null,
      discountPercent: 0,
    };
  }

  let price =
    input.priceInr !== undefined && Number.isFinite(input.priceInr)
      ? roundTwo(input.priceInr)
      : undefined;

  const requestedDiscount =
    input.discountPercent !== undefined && Number.isFinite(input.discountPercent)
      ? roundTwo(input.discountPercent)
      : undefined;

  if (requestedDiscount !== undefined && (requestedDiscount < 0 || requestedDiscount > 95)) {
    return {
      valid: false,
      error: 'Discount percentage must be between 0% and 95%.',
      priceInr: 0,
      originalPriceInr: original,
      discountPercent: 0,
    };
  }

  if (price === undefined && original !== null && requestedDiscount !== undefined) {
    price = roundTwo(original * (1 - requestedDiscount / 100));
  }

  if (price === undefined || price <= 0) {
    return {
      valid: false,
      error: 'Selling price in INR must be greater than ₹0.',
      priceInr: 0,
      originalPriceInr: original,
      discountPercent: 0,
    };
  }

  if (original !== null) {
    if (price > original) {
      return {
        valid: false,
        error: 'Selling price cannot exceed the original price.',
        priceInr: price,
        originalPriceInr: original,
        discountPercent: 0,
      };
    }

    const computedDiscount =
      original > price ? roundTwo(((original - price) / original) * 100) : 0;
    if (computedDiscount > 95) {
      return {
        valid: false,
        error: 'Discount cannot exceed 95%.',
        priceInr: price,
        originalPriceInr: original,
        discountPercent: computedDiscount,
      };
    }

    return {
      valid: true,
      priceInr: price,
      originalPriceInr: original,
      discountPercent: computedDiscount,
    };
  }

  return {
    valid: true,
    priceInr: price,
    originalPriceInr: null,
    discountPercent: 0,
  };
}

export const ALLOWED_MEDIA_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type AllowedMediaMime = (typeof ALLOWED_MEDIA_MIME_TYPES)[number];

export const MAX_MEDIA_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

export function detectImageExtensionFromMagicBytes(
  buffer: Uint8Array,
  declaredMime: string
): { valid: boolean; ext?: 'jpg' | 'png' | 'webp'; mime?: AllowedMediaMime; error?: string } {
  if (!ALLOWED_MEDIA_MIME_TYPES.includes(declaredMime as AllowedMediaMime)) {
    return {
      valid: false,
      error: 'Only JPG, PNG, and WebP images are permitted.',
    };
  }

  if (buffer.byteLength === 0) {
    return { valid: false, error: 'Uploaded file is empty.' };
  }

  if (buffer.byteLength > MAX_MEDIA_UPLOAD_BYTES) {
    return { valid: false, error: 'Image file size must not exceed 5 MB.' };
  }

  // JPEG: FF D8 FF
  const isJpeg =
    buffer.byteLength >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const isPng =
    buffer.byteLength >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;

  // WebP: RIFF....WEBP
  const isWebp =
    buffer.byteLength >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50;

  if (declaredMime === 'image/jpeg' && isJpeg) {
    return { valid: true, ext: 'jpg', mime: 'image/jpeg' };
  }
  if (declaredMime === 'image/png' && isPng) {
    return { valid: true, ext: 'png', mime: 'image/png' };
  }
  if (declaredMime === 'image/webp' && isWebp) {
    return { valid: true, ext: 'webp', mime: 'image/webp' };
  }

  return {
    valid: false,
    error: 'File contents do not match the declared JPG, PNG, or WebP format.',
  };
}

export function slugifyCatalogText(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
}

export function isValidAdminOrderStatusTransition(targetStatus: string): boolean {
  // Phase 3 explicitly prohibits marking unpaid orders as 'paid' or 'refunded'
  return ['pending', 'fulfilling', 'completed', 'cancelled', 'failed'].includes(targetStatus);
}

export function computeProfitMargin(input: {
  sellingPriceInr: number;
  supplierCostInr: number;
}): { netProfitInr: number; marginPercent: number } {
  const selling = Number.isFinite(input.sellingPriceInr) ? input.sellingPriceInr : 0;
  const cost = Number.isFinite(input.supplierCostInr) ? Math.max(0, input.supplierCostInr) : 0;
  const netProfitInr = roundTwo(selling - cost);
  const marginPercent = selling > 0 ? roundTwo((netProfitInr / selling) * 100) : 0;
  return { netProfitInr, marginPercent };
}

