import { z } from 'zod';
import { sanitizeExternalHref, sanitizeMediaSrc } from './displayUrl';
import { validateSupplierApiBaseUrl } from './safeUrl';

export const uuidSchema = z.string().trim().uuid('Invalid identifier format.');

export const safeMediaUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine(
    (val) => val === '' || sanitizeMediaSrc(val) !== null,
    'Image URL must be a valid HTTP(S) URL or approved local /media/ or /src/assets/ path.'
  );

export const safeExternalLinkSchema = z
  .string()
  .trim()
  .max(240)
  .refine(
    (val) => val === '' || sanitizeExternalHref(val) !== null,
    'Link URL must start with https:// or http://.'
  );

export const safeSupplierBaseUrlSchema = z
  .string()
  .trim()
  .max(300)
  .refine((val) => val === '' || validateSupplierApiBaseUrl(val).valid, {
    message: 'Supplier API Base URL must be a valid public HTTPS URL.',
  });

export const storeGamesQuerySchema = z.object({
  search: z.string().trim().max(100).optional().default(''),
  category: z.string().trim().max(60).optional().default(''),
  featured: z.enum(['true', 'false']).optional(),
});

export const paymentStatusQuerySchema = z.object({
  orderId: z.string().trim().uuid('orderId must be a valid UUID.'),
});

export const adminFilterQuerySchema = z.object({
  search: z.string().trim().max(120).optional().default(''),
  category: z.string().trim().max(60).optional().default(''),
  status: z.string().trim().max(40).optional().default('all'),
  gameId: z.string().trim().max(60).optional().default(''),
  currencyId: z.string().trim().max(60).optional().default(''),
});

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address.')
  .max(254);

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters.')
  .max(128, 'Password must not exceed 128 characters.');

export const registerCustomerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    fullName: z.string().trim().min(2, 'Full name is required.').max(100),
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1, 'Password is required.').max(128),
  })
  .strict();

export const adminBootstrapSchema = z
  .object({
    email: emailSchema,
    fullName: z.string().trim().min(2, 'Owner name is required.').max(100),
    password: passwordSchema,
  })
  .strict();

export const passwordResetRequestSchema = z
  .object({
    email: emailSchema,
  })
  .strict();

export const passwordResetConfirmSchema = z
  .object({
    token: z.string().trim().min(16, 'Invalid reset token.').max(256),
    newPassword: passwordSchema,
  })
  .strict();

export const checklistUpdateSchema = z
  .object({
    key: z.string().trim().min(1).max(80),
    status: z.enum(['not_started', 'pending', 'completed', 'requires_attention']),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const paymentModeUpdateSchema = z
  .object({
    mode: z.enum(['test', 'live']),
  })
  .strict();

export const createPaymentOrderSchema = z
  .object({
    packageId: z.string().uuid('Invalid package identifier.'),
    regionId: z.string().uuid('Invalid region identifier.').optional(),
    targetPlayerUid: z.string().trim().min(2, 'Player ID is required.').max(80),
    targetServerId: z.string().trim().max(60).optional(),
    quantity: z.number().int().min(1).max(10).optional().default(1),
  })
  .strict();

export const verifyPaymentSchema = z
  .object({
    orderId: z.string().uuid('Invalid order identifier.'),
    razorpayOrderId: z.string().trim().min(5).max(100),
    razorpayPaymentId: z.string().trim().min(5).max(100),
    razorpaySignature: z.string().trim().min(16).max(256),
  })
  .strict();

export const refundRequestSchema = z
  .object({
    paymentId: z.string().uuid('Invalid payment identifier.'),
    amountPaise: z.number().int().positive().optional(),
    reason: z.string().trim().min(4, 'Refund reason is required.').max(300),
  })
  .strict();

export const contactInquirySchema = z
  .object({
    name: z.string().trim().min(2, 'Name is required.').max(100),
    email: emailSchema,
    subject: z.string().trim().min(3, 'Subject is required.').max(160),
    message: z.string().trim().min(10, 'Please include at least 10 characters.').max(2000),
  })
  .strict();

export const placePendingOrderSchema = z
  .object({
    packageId: z.string().uuid('Invalid package identifier.'),
    regionId: z.string().uuid('Invalid region identifier.').optional(),
    quantity: z
      .number()
      .int()
      .min(1, 'Minimum quantity is 1.')
      .max(10, 'Maximum quantity per order is 10.')
      .optional()
      .default(1),
    playerDetails: z.record(z.string(), z.string().max(80)),
    customerNote: z.string().trim().max(300).optional(),
    idempotencyKey: z.string().trim().min(8).max(120).optional(),
    preferredDeliveryMethod: z.enum(['manual', 'automatic']).optional(),
  })
  .strict();

export const updateCustomerProfileSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Full name must be at least 2 characters.').max(100),
    phone: z.string().trim().max(24).optional().nullable(),
  })
  .strict();

export const playerFieldDefSchema = z
  .object({
    key: z.string().trim().min(2).max(40).regex(/^[a-z0-9_]+$/),
    label: z.string().trim().min(2).max(60),
    type: z.enum(['text', 'select']),
    placeholder: z.string().trim().max(80).optional(),
    hint: z.string().trim().max(140).optional(),
    required: z.boolean(),
    options: z.array(z.string().trim().min(1).max(60)).optional(),
    validationRegex: z.string().trim().max(120).optional(),
    validationMessage: z.string().trim().max(140).optional(),
  })
  .strict();

export const adminCreateRegionSchema = z
  .object({
    regionCode: z
      .string()
      .trim()
      .toUpperCase()
      .min(1, 'Region code is required.')
      .max(32)
      .regex(/^[A-Z0-9_-]+$/, 'Region code may only use letters, numbers, hyphens, or underscores.'),
    regionName: z.string().trim().min(2, 'Region name is required.').max(100),
    serverHint: z.string().trim().max(120).optional().nullable(),
    isActive: z.boolean().optional().default(true),
  })
  .strict();

export const adminUpdateRegionSchema = adminCreateRegionSchema.partial().strict();

export const adminCreateGameSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(2, 'Slug must be at least 2 characters.')
      .max(80)
      .regex(/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, numbers, and hyphens.'),
    title: z.string().trim().min(2, 'Game name is required.').max(120),
    publisher: z.string().trim().max(120).optional().default(''),
    category: z.string().trim().min(2, 'Category is required.').max(60),
    description: z.string().trim().max(1000).optional().default(''),
    coverImageUrl: safeMediaUrlSchema.optional().nullable(),
    coverMediaId: z.string().uuid().optional().nullable(),
    deliveryMode: z.enum(['manual', 'automatic', 'hybrid']).optional().default('manual'),
    defaultSupplierId: z.string().uuid().optional().nullable(),
    isActive: z.boolean().optional().default(true),
    isFeatured: z.boolean().optional().default(false),
    sortOrder: z.number().int().min(0).max(9999).optional().default(0),
    playerFields: z.array(playerFieldDefSchema).optional().default([]),
  })
  .strict();

export const adminUpdateGameSchema = adminCreateGameSchema.partial().strict();

export const adminCreateCurrencySchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(2, 'Currency code must be at least 2 characters.')
      .max(24)
      .regex(/^[A-Z0-9_]+$/, 'Code must use uppercase letters, numbers, or underscores.'),
    name: z.string().trim().min(2, 'Currency name is required.').max(80),
    symbol: z.string().trim().min(1, 'Symbol or short unit is required.').max(16),
    description: z.string().trim().max(400).optional().default(''),
    imageUrl: safeMediaUrlSchema.optional().nullable(),
    mediaId: z.string().uuid().optional().nullable(),
    gameId: z.string().uuid().optional().nullable(),
    isActive: z.boolean().optional().default(true),
    sortOrder: z.number().int().min(0).max(9999).optional().default(0),
  })
  .strict();

export const adminUpdateCurrencySchema = adminCreateCurrencySchema.partial().strict();

export const adminCreatePackageSchema = z
  .object({
    gameId: z.string().uuid('Select a game.'),
    gameCurrencyId: z.string().uuid().optional().nullable(),
    regionId: z.string().uuid().optional().nullable(),
    sku: z.string().trim().min(2, 'SKU is required.').max(80),
    name: z.string().trim().min(2, 'Package name is required.').max(120),
    description: z.string().trim().max(400).optional().default(''),
    inGameAmount: z.number().positive('Quantity must be greater than 0.'),
    inGameUnit: z.string().trim().min(1, 'Currency unit is required.').max(40),
    priceInr: z.number().positive('Selling price in INR must be greater than 0.'),
    originalPriceInr: z.number().positive().optional().nullable(),
    discountPercent: z.number().min(0).max(95).optional().default(0),
    bonusBadge: z.string().trim().max(40).optional().default(''),
    imageUrl: safeMediaUrlSchema.optional().nullable(),
    mediaId: z.string().uuid().optional().nullable(),
    deliveryType: z.enum(['manual', 'automatic', 'both']).optional().default('manual'),
    supplierId: z.string().uuid().optional().nullable(),
    supplierProductCode: z.string().trim().max(80).optional().default(''),
    supplierCostInr: z.number().min(0).optional().default(0),
    isFeatured: z.boolean().optional().default(false),
    isActive: z.boolean().optional().default(true),
    sortOrder: z.number().int().min(0).max(9999).optional().default(0),
  })
  .strict();

export const adminUpdatePackageSchema = adminCreatePackageSchema
  .omit({ gameId: true })
  .extend({ gameId: z.string().uuid().optional() })
  .partial()
  .strict();

export const adminUpdatePriceSchema = z
  .object({
    priceInr: z.number().positive('Selling price must be greater than 0.').optional(),
    originalPriceInr: z.number().positive().optional().nullable(),
    discountPercent: z.number().min(0).max(95).optional(),
    supplierCostInr: z.number().min(0, 'Supplier cost cannot be negative.').optional(),
    bonusBadge: z.string().trim().max(40).optional(),
  })
  .strict();

export const adminMediaUploadSchema = z
  .object({
    fileName: z.string().trim().min(1).max(160),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    dataBase64: z.string().min(8),
    altText: z.string().trim().max(200).optional().default(''),
  })
  .strict();

export const adminUpdateOrderSchema = z
  .object({
    status: z
      .enum([
        'pending',
        'payment_pending',
        'processing',
        'fulfilling',
        'awaiting_delivery',
        'completed',
        'cancelled',
        'failed',
        'refund_pending',
      ])
      .optional(),
    fulfillmentStatus: z
      .enum(['pending', 'queued', 'processing', 'awaiting_delivery', 'manual_review', 'delivered', 'failed'])
      .optional(),
    deliveryMethod: z.enum(['manual', 'automatic', 'both']).optional(),
    adminNote: z.string().trim().max(1000).optional(),
    deliveryNotes: z.string().trim().max(1000).optional(),
    customerDeliveryMessage: z.string().trim().max(600).optional(),
    confirmCompleted: z.boolean().optional(),
  })
  .strict();

export const adminCreateSupplierSchema = z
  .object({
    name: z.string().trim().min(2, 'Supplier name is required.').max(120),
    code: z
      .string()
      .trim()
      .toLowerCase()
      .min(2, 'Supplier code is required.')
      .max(60)
      .regex(/^[a-z0-9_-]+$/, 'Code may only use lowercase letters, numbers, hyphens, or underscores.'),
    integrationType: z.enum(['manual', 'api', 'webhook']).default('api'),
    mode: z.enum(['mock', 'live']).default('mock'),
    apiBaseUrl: safeSupplierBaseUrlSchema.optional().nullable(),
    apiKeyEnvName: z
      .string()
      .trim()
      .max(80)
      .refine(
        (v) => v === '' || /^[A-Z][A-Z0-9_]{1,63}$/.test(v),
        'API key variable name must use uppercase letters, numbers, and underscores.'
      )
      .optional()
      .default(''),
    isActive: z.boolean().optional().default(true),
    timeoutMs: z.number().int().min(1000).max(60000).optional().default(8000),
    maxRetries: z.number().int().min(0).max(5).optional().default(2),
    supportedGamesNote: z.string().trim().max(300).optional().default(''),
    notes: z.string().trim().max(500).optional().default(''),
  })
  .strict();

export const adminUpdateSupplierSchema = adminCreateSupplierSchema.partial().strict();

export const adminUpsertSupplierMappingSchema = z
  .object({
    supplierId: z.string().uuid('Select a supplier.'),
    packageId: z.string().uuid('Select a package.'),
    externalProductCode: z.string().trim().min(1, 'Supplier product code is required.').max(100),
    externalProductName: z.string().trim().max(120).optional().default(''),
    supplierCostInr: z.number().min(0).optional().default(0),
    isActive: z.boolean().optional().default(true),
  })
  .strict();

export const adminDispatchSupplierSchema = z
  .object({
    supplierId: z.string().uuid().optional(),
  })
  .strict();

export const adminUpdateWebsiteSettingsSchema = z
  .object({
    storeName: z.string().trim().min(2, 'Store name is required.').max(80),
    storeLogoUrl: safeMediaUrlSchema.optional().nullable(),
    heroHeading: z.string().trim().min(2, 'Homepage heading is required.').max(140),
    heroSubtitle: z.string().trim().min(2, 'Homepage subtitle is required.').max(200),
    supportEmail: z.string().trim().min(3).max(160),
    whatsappContact: z.string().trim().max(60),
    footerDescription: z.string().trim().max(500),
    supportHours: z.string().trim().max(120),
    supportNote: z.string().trim().max(300),
    announcementEnabled: z.boolean(),
    announcementText: z.string().trim().max(240),
    socialLinks: z
      .object({
        discord: safeExternalLinkSchema,
        instagram: safeExternalLinkSchema,
        youtube: safeExternalLinkSchema,
        x: safeExternalLinkSchema,
      })
      .strict(),
  })
  .strict();

export const firebaseLoginSchema = z
  .object({
    idToken: z.string().trim().min(20, 'Invalid Firebase ID token.').max(10000),
  })
  .strict();

