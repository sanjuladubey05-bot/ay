import { Router } from 'express';
import {
  asyncHandler,
  createRateLimiter,
  requireAdmin,
  requirePermission,
  type AuthenticatedRequest,
} from '../authentication/middleware';
import { getEnvReadinessSummary } from '../configuration/env';
import { writeAuditLog } from '../database/audit';
import { getAppliedMigrations } from '../database/migrate';
import { getDb } from '../database/pool';
import type {
  AdminCurrencyItem,
  AdminCustomerItem,
  AdminGameItem,
  AdminMediaItem,
  AdminOrderItem,
  AdminOverviewResponse,
  AdminPackageItem,
  AdminProfileResponse,
  AdminRegionItem,
  AdminSettingsResponse,
  AdminSupplierItem,
  OrderDeliveryLogItem,
  StorefrontIdentitySettings,
  SupplierOrderItem,
  SupplierPackageMappingItem,
} from '../types/api';
import {
  CORE_DATABASE_TABLES,
  type AuditLogRecord,
  type PaymentMode,
  type PlayerFieldDefinition,
} from '../types/database';
import { buildSalesAnalytics } from '../utilities/analytics';
import {
  buildChecklistState,
  evaluateLiveModeEligibility,
  RAZORPAY_CHECKLIST_DEFINITIONS,
  type StoredChecklistMap,
} from '../utilities/checklist';
import {
  deleteUploadedImageFile,
  findMediaReferences,
  saveUploadedImageFile,
} from '../utilities/mediaStorage';
import {
  buildMockSupplierDispatchResult,
  evaluateSupplierRetryEligibility,
  isPermittedPhase4AdminOrderStatus,
  mapPhase4DeliveryStatusLabel,
  mapPhase4OrderStatusLabel,
  mapPhase4PaymentStatusLabel,
  validateOrderCompletionGuard,
} from '../utilities/orderDelivery';
import { isSensitiveFieldForbidden, validateRegexPattern } from '../utilities/playerFields';
import { computeNormalizedPackagePricing, computeProfitMargin } from '../utilities/pricing';
import { assertPublicSupplierEndpoint } from '../utilities/safeUrl';
import {
  adminCreateCurrencySchema,
  adminCreateGameSchema,
  adminCreatePackageSchema,
  adminCreateRegionSchema,
  adminCreateSupplierSchema,
  adminDispatchSupplierSchema,
  adminFilterQuerySchema,
  adminMediaUploadSchema,
  adminUpdateCurrencySchema,
  adminUpdateGameSchema,
  adminUpdateOrderSchema,
  adminUpdatePackageSchema,
  adminUpdatePriceSchema,
  adminUpdateRegionSchema,
  adminUpdateSupplierSchema,
  adminUpdateWebsiteSettingsSchema,
  adminUpsertSupplierMappingSchema,
  checklistUpdateSchema,
  paymentModeUpdateSchema,
  updateCustomerProfileSchema,
  uuidSchema,
} from '../utilities/validation';

export const adminRouter = Router();

// Every admin route strictly requires authenticated admin privileges
adminRouter.use(requireAdmin);

const adminUploadRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 25,
  keyPrefix: 'admin_media_upload',
});

const adminDispatchRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 30,
  keyPrefix: 'admin_supplier_dispatch',
});

for (const paramName of ['id', 'gameId', 'regionId'] as const) {
  adminRouter.param(paramName, (_req, res, next, value) => {
    if (!uuidSchema.safeParse(value).success) {
      res.status(400).json({
        error: 'Invalid resource identifier.',
        code: 'VALIDATION_ERROR',
      });
      return;
    }
    next();
  });
}

const DEFAULT_STOREFRONT_IDENTITY: StorefrontIdentitySettings = {
  storeName: 'LPS STORE',
  storeLogoUrl: null,
  heroHeading: 'LEVEL UP YOUR GAME',
  heroSubtitle: 'Your Gaming Top-Up Destination',
  supportEmail: 'support@lpsstore.example',
  whatsappContact: '+91 00000 00000',
  footerDescription:
    'A digital gaming top-up marketplace built with server-verified package pricing, Player ID validation, and transparent order tracking.',
  supportHours: 'Monday – Sunday · 10:00 – 22:00 IST',
  supportNote: 'Reach out for pending order status checks, Player ID updates, or catalog support.',
  announcementEnabled: false,
  announcementText: '',
  socialLinks: {
    discord: '',
    instagram: '',
    youtube: '',
    x: '',
  },
};

function mergeStorefrontIdentity(raw: unknown): StorefrontIdentitySettings {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const socialRaw =
    obj.socialLinks && typeof obj.socialLinks === 'object'
      ? (obj.socialLinks as Record<string, unknown>)
      : {};

  return {
    storeName:
      typeof obj.storeName === 'string' && obj.storeName.trim()
        ? obj.storeName
        : DEFAULT_STOREFRONT_IDENTITY.storeName,
    storeLogoUrl: typeof obj.storeLogoUrl === 'string' ? obj.storeLogoUrl : null,
    heroHeading:
      typeof obj.heroHeading === 'string' && obj.heroHeading.trim()
        ? obj.heroHeading
        : DEFAULT_STOREFRONT_IDENTITY.heroHeading,
    heroSubtitle:
      typeof obj.heroSubtitle === 'string' && obj.heroSubtitle.trim()
        ? obj.heroSubtitle
        : DEFAULT_STOREFRONT_IDENTITY.heroSubtitle,
    supportEmail:
      typeof obj.supportEmail === 'string' && obj.supportEmail.trim()
        ? obj.supportEmail
        : DEFAULT_STOREFRONT_IDENTITY.supportEmail,
    whatsappContact:
      typeof obj.whatsappContact === 'string'
        ? obj.whatsappContact
        : DEFAULT_STOREFRONT_IDENTITY.whatsappContact,
    footerDescription:
      typeof obj.footerDescription === 'string'
        ? obj.footerDescription
        : DEFAULT_STOREFRONT_IDENTITY.footerDescription,
    supportHours:
      typeof obj.supportHours === 'string'
        ? obj.supportHours
        : DEFAULT_STOREFRONT_IDENTITY.supportHours,
    supportNote:
      typeof obj.supportNote === 'string'
        ? obj.supportNote
        : DEFAULT_STOREFRONT_IDENTITY.supportNote,
    announcementEnabled: Boolean(obj.announcementEnabled),
    announcementText:
      typeof obj.announcementText === 'string' ? obj.announcementText : '',
    socialLinks: {
      discord: typeof socialRaw.discord === 'string' ? socialRaw.discord : '',
      instagram: typeof socialRaw.instagram === 'string' ? socialRaw.instagram : '',
      youtube: typeof socialRaw.youtube === 'string' ? socialRaw.youtube : '',
      x: typeof socialRaw.x === 'string' ? socialRaw.x : '',
    },
  };
}

async function getStoredPaymentSettings() {
  const db = getDb();
  const rows = await db.query<{ setting_key: string; setting_value: unknown }>(
    `SELECT setting_key, setting_value
     FROM public.website_settings
     WHERE setting_key IN ('payment_mode', 'razorpay_readiness_checklist')`
  );

  let paymentMode: PaymentMode = 'test';
  let checklistMap: StoredChecklistMap = {};

  for (const row of rows.rows) {
    if (
      row.setting_key === 'payment_mode' &&
      row.setting_value &&
      typeof row.setting_value === 'object'
    ) {
      const val = row.setting_value as { mode?: string };
      paymentMode = val.mode === 'live' ? 'live' : 'test';
    }
    if (
      row.setting_key === 'razorpay_readiness_checklist' &&
      row.setting_value &&
      typeof row.setting_value === 'object'
    ) {
      checklistMap = row.setting_value as StoredChecklistMap;
    }
  }

  return { paymentMode, checklistMap };
}

async function resolveMediaPublicUrl(mediaId: string | null | undefined): Promise<string | null> {
  if (!mediaId) return null;
  const db = getDb();
  const res = await db.query<{ public_url: string | null }>(
    'SELECT public_url FROM public.uploaded_media WHERE id = $1 LIMIT 1',
    [mediaId]
  );
  return res.rows[0]?.public_url ?? null;
}

/* -------------------------------------------------------------------------- */
/*  1. DASHBOARD OVERVIEW                                                     */
/* -------------------------------------------------------------------------- */

adminRouter.get(
  '/overview',
  requirePermission('admin.overview.read'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const migrations = await getAppliedMigrations(db);
    const canReadAuditLogs =
      req.authUser!.permissions.includes('*') ||
      req.authUser!.permissions.includes('admin.audit.read');

    const [
      tableRows,
      rlsRes,
      auditCountRes,
      auditLogsRes,
      gameStatsRes,
      pkgStatsRes,
      orderStatsRes,
      analyticsOrdersRes,
      analyticsRefundsRes,
      customerStatsRes,
      recentOrdersRes,
      recentGamesRes,
    ] = await Promise.all([
      db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
      ),
      db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relkind = 'r'
           AND c.relrowsecurity = TRUE
           AND c.relname = ANY($1::text[])`,
        [CORE_DATABASE_TABLES]
      ),
      db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM public.audit_logs'),
      canReadAuditLogs
        ? db.query<AuditLogRecord>(
            `SELECT id, actor_profile_id, actor_role, action, resource_type, resource_id, ip_address, details, created_at
             FROM public.audit_logs
             ORDER BY created_at DESC
             LIMIT 12`
          )
        : Promise.resolve({ rows: [] as AuditLogRecord[] }),
      db.query<{ total: string; active: string }>(
        `SELECT
           COUNT(*)::text AS total,
           COUNT(*) FILTER (WHERE is_active = TRUE)::text AS active
         FROM public.games`
      ),
      db.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM public.packages`),
      db.query<{ total: string; pending: string; completed: string }>(
        `SELECT
           COUNT(*)::text AS total,
           COUNT(*) FILTER (WHERE status IN ('pending', 'payment_pending', 'awaiting_payment', 'processing', 'awaiting_delivery'))::text AS pending,
           COUNT(*) FILTER (WHERE status = 'completed')::text AS completed
         FROM public.orders`
      ),
      db.query<{
        id: string;
        total_inr: string;
        supplier_cost_inr: string;
        status: string;
        payment_status: string;
        created_at: string;
      }>(
        `SELECT id, total_inr::text, supplier_cost_inr::text, status, payment_status, created_at
         FROM public.orders
         ORDER BY created_at DESC`
      ),
      db.query<{
        order_id: string;
        amount_paise: string;
        created_at: string;
      }>(
        `SELECT order_id, amount_paise::text, created_at
         FROM public.refunds
         WHERE status = 'processed'`
      ),
      db.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM public.customers`),
      db.query<{
        id: string;
        order_number: string;
        customer_name: string | null;
        customer_email: string | null;
        game_title: string | null;
        package_name: string | null;
        total_inr: string;
        status: string;
        created_at: string;
      }>(
        `SELECT
           o.id, o.order_number, p.full_name AS customer_name, p.email AS customer_email,
           g.title AS game_title, pkg.name AS package_name, o.total_inr::text, o.status, o.created_at
         FROM public.orders o
         LEFT JOIN public.customers c ON c.id = o.customer_id
         LEFT JOIN public.profiles p ON p.id = c.profile_id
         LEFT JOIN public.order_items oi ON oi.order_id = o.id
         LEFT JOIN public.games g ON g.id = oi.game_id
         LEFT JOIN public.packages pkg ON pkg.id = oi.package_id
         ORDER BY o.created_at DESC
         LIMIT 8`
      ),
      db.query<{
        id: string;
        slug: string;
        title: string;
        category: string;
        is_active: boolean;
        is_featured: boolean;
        cover_image_url: string | null;
        media_url: string | null;
        created_at: string;
      }>(
        `SELECT g.id, g.slug, g.title, g.category, g.is_active, g.is_featured, g.cover_image_url, m.public_url AS media_url, g.created_at
         FROM public.games g
         LEFT JOIN public.uploaded_media m ON m.id = g.cover_media_id
         ORDER BY g.created_at DESC
         LIMIT 6`
      ),
    ]);

    const salesAnalytics = buildSalesAnalytics(
      analyticsOrdersRes.rows.map((r) => ({
        id: r.id,
        totalInr: Number(r.total_inr || '0'),
        supplierCostInr: Number(r.supplier_cost_inr || '0'),
        status: r.status,
        paymentStatus: r.payment_status,
        createdAt: r.created_at,
      })),
      analyticsRefundsRes.rows.map((r) => ({
        orderId: r.order_id,
        amountInr: Number(r.amount_paise || '0') / 100,
        createdAt: r.created_at,
      }))
    );

    const presentSet = new Set(tableRows.rows.map((r) => r.table_name));
    const coreTablesPresent = CORE_DATABASE_TABLES.filter((t) => presentSet.has(t)).length;

    const { paymentMode, checklistMap } = await getStoredPaymentSettings();
    const envReadiness = getEnvReadinessSummary();
    const checklist = buildChecklistState(checklistMap, envReadiness);

    const credentialsReady =
      paymentMode === 'test'
        ? envReadiness.razorpayKeyType === 'test' && envReadiness.razorpayKeySecretConfigured
        : envReadiness.razorpayKeyType === 'live' &&
          envReadiness.razorpayKeySecretConfigured &&
          envReadiness.razorpayWebhookSecretConfigured;

    const payload: AdminOverviewResponse = {
      stats: {
        totalGames: Number(gameStatsRes.rows[0]?.total || '0'),
        activeGames: Number(gameStatsRes.rows[0]?.active || '0'),
        totalPackages: Number(pkgStatsRes.rows[0]?.total || '0'),
        totalOrders: Number(orderStatsRes.rows[0]?.total || '0'),
        pendingOrders: Number(orderStatsRes.rows[0]?.pending || '0'),
        completedOrders: Number(orderStatsRes.rows[0]?.completed || '0'),
        totalCustomers: Number(customerStatsRes.rows[0]?.total || '0'),
      },
      salesAnalytics,
      recentOrders: recentOrdersRes.rows.map((r) => ({
        id: r.id,
        orderNumber: r.order_number,
        customerName: r.customer_name || 'Customer',
        customerEmail: r.customer_email || '',
        gameTitle: r.game_title || 'Top-Up Order',
        packageName: r.package_name || 'Package',
        totalInr: Number(r.total_inr),
        status: r.status,
        displayOrderStatus: mapPhase4OrderStatusLabel(r.status),
        createdAt: r.created_at,
      })),
      recentGames: recentGamesRes.rows.map((g) => ({
        id: g.id,
        slug: g.slug,
        title: g.title,
        category: g.category,
        isActive: g.is_active,
        isFeatured: g.is_featured,
        coverImageUrl: g.cover_image_url || g.media_url || null,
        createdAt: g.created_at,
      })),
      database: {
        engine: db.engine,
        connected: true,
        migrationsApplied: migrations,
        coreTablesPresent,
        coreTablesExpected: CORE_DATABASE_TABLES.length,
        rlsEnabledTables: Number(rlsRes.rows[0]?.count || '0'),
      },
      paymentGateway: {
        provider: 'razorpay',
        mode: paymentMode,
        credentialsReady,
        checklistCompletedCount: checklist.filter((c) => c.status === 'completed').length,
        checklistTotalCount: checklist.length,
      },
      security: {
        publicAdminRegistrationDisabled: true,
        serviceRoleExposedToClient: false,
        rateLimitingActive: true,
        failedCheckoutLimitPerMinute: 5,
        auditLogCount: Number(auditCountRes.rows[0]?.count || '0'),
      },
      recentAuditLogs: auditLogsRes.rows,
    };

    res.json(payload);
  })
);

/* -------------------------------------------------------------------------- */
/*  2. GAMES MANAGEMENT                                                       */
/* -------------------------------------------------------------------------- */

adminRouter.get(
  '/catalog/games',
  requirePermission('orders.read'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsedQuery = adminFilterQuerySchema.safeParse({
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      category: typeof req.query.category === 'string' ? req.query.category : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
    });
    if (!parsedQuery.success) {
      res.status(400).json({ error: 'Invalid filter query parameters.', code: 'VALIDATION_ERROR' });
      return;
    }
    const search = parsedQuery.data.search.toLowerCase();
    const category = parsedQuery.data.category;
    const status = parsedQuery.data.status || 'all';

    const db = getDb();
    const rows = await db.query<{
      id: string;
      slug: string;
      title: string;
      publisher: string;
      category: string;
      description: string;
      cover_image_url: string | null;
      cover_media_id: string | null;
      media_url: string | null;
      delivery_mode: 'manual' | 'automatic' | 'hybrid';
      default_supplier_id: string | null;
      default_supplier_name: string | null;
      is_active: boolean;
      is_featured: boolean;
      sort_order: number;
      player_fields: PlayerFieldDefinition[] | null;
      package_count: string;
      order_count: string;
      created_at: string;
    }>(
      `SELECT
         g.id, g.slug, g.title, g.publisher, g.category, g.description,
         g.cover_image_url, g.cover_media_id, m.public_url AS media_url,
         g.delivery_mode, g.default_supplier_id, s.name AS default_supplier_name,
         g.is_active, g.is_featured, g.sort_order, g.player_fields,
         (SELECT COUNT(*)::text FROM public.packages p WHERE p.game_id = g.id) AS package_count,
         (SELECT COUNT(*)::text FROM public.order_items oi WHERE oi.game_id = g.id) AS order_count,
         g.created_at
       FROM public.games g
       LEFT JOIN public.uploaded_media m ON m.id = g.cover_media_id
       LEFT JOIN public.suppliers s ON s.id = g.default_supplier_id
       ORDER BY g.sort_order ASC, g.created_at DESC`
    );

    const categoriesSet = new Set<string>();
    const mapped: AdminGameItem[] = rows.rows.map((r) => {
      if (r.category) categoriesSet.add(r.category);
      return {
        id: r.id,
        slug: r.slug,
        title: r.title,
        publisher: r.publisher,
        category: r.category,
        description: r.description,
        coverImageUrl: r.cover_image_url || r.media_url || null,
        coverMediaId: r.cover_media_id,
        deliveryMode: r.delivery_mode,
        defaultSupplierId: r.default_supplier_id,
        defaultSupplierName: r.default_supplier_name,
        isActive: r.is_active,
        isFeatured: r.is_featured,
        sortOrder: r.sort_order,
        playerFields: Array.isArray(r.player_fields) ? r.player_fields : [],
        packageCount: Number(r.package_count || '0'),
        orderCount: Number(r.order_count || '0'),
        createdAt: r.created_at,
      };
    });

    const filtered = mapped.filter((g) => {
      if (status === 'active' && !g.isActive) return false;
      if (status === 'inactive' && g.isActive) return false;
      if (category && category !== 'all' && g.category.toLowerCase() !== category.toLowerCase()) {
        return false;
      }
      if (search) {
        const hay = `${g.title} ${g.slug} ${g.publisher} ${g.category}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    res.json({
      games: filtered,
      categories: Array.from(categoriesSet).sort(),
    });
  })
);

adminRouter.post(
  '/catalog/games',
  requirePermission('orders.manage'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = adminCreateGameSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid game payload.',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const g = parsed.data;
    const forbiddenField = g.playerFields.find(
      (f) => isSensitiveFieldForbidden(f.key) || isSensitiveFieldForbidden(f.label)
    );
    if (forbiddenField) {
      res.status(400).json({
        error: `Field "${forbiddenField.label}" is prohibited. Never request passwords, PINs, or OTPs.`,
        code: 'FORBIDDEN_PLAYER_FIELD',
      });
      return;
    }

    for (const f of g.playerFields) {
      if (f.validationRegex) {
        const regexCheck = validateRegexPattern(f.validationRegex);
        if (!regexCheck.valid) {
          res.status(400).json({
            error: `Field "${f.label}": ${regexCheck.error}`,
            code: 'INVALID_VALIDATION_REGEX',
          });
          return;
        }
      }
    }

    const db = getDb();
    const existingSlug = await db.query<{ id: string }>(
      'SELECT id FROM public.games WHERE slug = $1 LIMIT 1',
      [g.slug]
    );
    if (existingSlug.rows[0]) {
      res.status(409).json({
        error: `A game with slug "${g.slug}" already exists.`,
        code: 'DUPLICATE_SLUG',
      });
      return;
    }

    const mediaUrl = g.coverMediaId ? await resolveMediaPublicUrl(g.coverMediaId) : null;
    const resolvedCoverUrl = g.coverImageUrl || mediaUrl || null;

    const inserted = await db.query<{ id: string; slug: string; title: string }>(
      `INSERT INTO public.games
         (slug, title, publisher, category, description, cover_image_url, cover_media_id, delivery_mode, default_supplier_id, is_active, is_featured, sort_order, player_fields)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
       RETURNING id, slug, title`,
      [
        g.slug,
        g.title,
        g.publisher,
        g.category,
        g.description,
        resolvedCoverUrl,
        g.coverMediaId ?? null,
        g.deliveryMode,
        g.defaultSupplierId ?? null,
        g.isActive,
        g.isFeatured,
        g.sortOrder,
        JSON.stringify(g.playerFields),
      ]
    );

    await writeAuditLog({
      actorProfileId: req.authUser!.profileId,
      actorRole: req.authUser!.roleCode,
      action: 'admin.catalog_game_created',
      resourceType: 'games',
      resourceId: inserted.rows[0].id,
      req,
      details: { slug: g.slug, title: g.title },
    });

    res.status(201).json({ game: inserted.rows[0] });
  })
);

adminRouter.patch(
  '/catalog/games/:id',
  requirePermission('orders.manage'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = adminUpdateGameSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid game update.',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const u = parsed.data;
    if (u.playerFields) {
      const forbiddenField = u.playerFields.find(
        (f) => isSensitiveFieldForbidden(f.key) || isSensitiveFieldForbidden(f.label)
      );
      if (forbiddenField) {
        res.status(400).json({
          error: `Field "${forbiddenField.label}" is prohibited. Never request passwords, PINs, or OTPs.`,
          code: 'FORBIDDEN_PLAYER_FIELD',
        });
        return;
      }
      for (const f of u.playerFields) {
        if (f.validationRegex) {
          const regexCheck = validateRegexPattern(f.validationRegex);
          if (!regexCheck.valid) {
            res.status(400).json({
              error: `Field "${f.label}": ${regexCheck.error}`,
              code: 'INVALID_VALIDATION_REGEX',
            });
            return;
          }
        }
      }
    }

    const db = getDb();
    const existing = await db.query<{
      id: string;
      slug: string;
      title: string;
      publisher: string;
      category: string;
      description: string;
      cover_image_url: string | null;
      cover_media_id: string | null;
      delivery_mode: 'manual' | 'automatic' | 'hybrid';
      default_supplier_id: string | null;
      is_active: boolean;
      is_featured: boolean;
      sort_order: number;
      player_fields: PlayerFieldDefinition[] | null;
    }>(
      `SELECT id, slug, title, publisher, category, description, cover_image_url, cover_media_id,
              delivery_mode, default_supplier_id, is_active, is_featured, sort_order, player_fields
       FROM public.games WHERE id = $1 LIMIT 1`,
      [req.params.id]
    );

    if (!existing.rows[0]) {
      res.status(404).json({ error: 'Game not found.', code: 'NOT_FOUND' });
      return;
    }

    const cur = existing.rows[0];
    if (u.slug && u.slug !== cur.slug) {
      const clash = await db.query<{ id: string }>(
        'SELECT id FROM public.games WHERE slug = $1 AND id <> $2 LIMIT 1',
        [u.slug, req.params.id]
      );
      if (clash.rows[0]) {
        res.status(409).json({ error: `Slug "${u.slug}" is already taken.`, code: 'DUPLICATE_SLUG' });
        return;
      }
    }

    const nextMediaId =
      u.coverMediaId !== undefined ? u.coverMediaId : cur.cover_media_id;
    let nextCoverUrl =
      u.coverImageUrl !== undefined ? u.coverImageUrl : cur.cover_image_url;
    if (u.coverMediaId && u.coverImageUrl === undefined) {
      nextCoverUrl = (await resolveMediaPublicUrl(u.coverMediaId)) || nextCoverUrl;
    }

    const updated = await db.query<{ id: string; slug: string; title: string; is_active: boolean }>(
      `UPDATE public.games
       SET slug = $1,
           title = $2,
           publisher = $3,
           category = $4,
           description = $5,
           cover_image_url = $6,
           cover_media_id = $7,
           delivery_mode = $8,
           default_supplier_id = $9,
           is_active = $10,
           is_featured = $11,
           sort_order = $12,
           player_fields = $13::jsonb
       WHERE id = $14
       RETURNING id, slug, title, is_active`,
      [
        u.slug ?? cur.slug,
        u.title ?? cur.title,
        u.publisher ?? cur.publisher,
        u.category ?? cur.category,
        u.description ?? cur.description,
        nextCoverUrl,
        nextMediaId,
        u.deliveryMode ?? cur.delivery_mode,
        u.defaultSupplierId !== undefined ? u.defaultSupplierId : cur.default_supplier_id,
        u.isActive !== undefined ? u.isActive : cur.is_active,
        u.isFeatured !== undefined ? u.isFeatured : cur.is_featured,
        u.sortOrder !== undefined ? u.sortOrder : cur.sort_order,
        JSON.stringify(u.playerFields ?? (Array.isArray(cur.player_fields) ? cur.player_fields : [])),
        req.params.id,
      ]
    );

    await writeAuditLog({
      actorProfileId: req.authUser!.profileId,
      actorRole: req.authUser!.roleCode,
      action: 'admin.catalog_game_updated',
      resourceType: 'games',
      resourceId: req.params.id,
      req,
      details: u,
    });

    res.json({ game: updated.rows[0] });
  })
);

adminRouter.delete(
  '/catalog/games/:id',
  requirePermission('orders.manage'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const existing = await db.query<{ id: string; title: string }>(
      'SELECT id, title FROM public.games WHERE id = $1 LIMIT 1',
      [req.params.id]
    );
    if (!existing.rows[0]) {
      res.status(404).json({ error: 'Game not found.', code: 'NOT_FOUND' });
      return;
    }

    const orderRefs = await db.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM public.order_items WHERE game_id = $1',
      [req.params.id]
    );
    const refCount = Number(orderRefs.rows[0]?.count || '0');
    if (refCount > 0) {
      res.status(409).json({
        error: `Cannot delete "${existing.rows[0].title}" because ${refCount} historical order item(s) reference it. Deactivate the game instead to preserve order records.`,
        code: 'GAME_HAS_ORDERS',
      });
      return;
    }

    await db.query('DELETE FROM public.games WHERE id = $1', [req.params.id]);

    await writeAuditLog({
      actorProfileId: req.authUser!.profileId,
      actorRole: req.authUser!.roleCode,
      action: 'admin.catalog_game_deleted',
      resourceType: 'games',
      resourceId: req.params.id,
      req,
      details: { title: existing.rows[0].title },
    });

    res.json({ ok: true });
  })
);

/* -------------------------------------------------------------------------- */
/*  2B. GAME SERVER / REGION MANAGEMENT                                       */
/* -------------------------------------------------------------------------- */

adminRouter.get(
  '/catalog/games/:gameId/regions',
  requirePermission('orders.read'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const rows = await db.query<{
      id: string;
      game_id: string;
      region_code: string;
      region_name: string;
      server_hint: string | null;
      is_active: boolean;
    }>(
      `SELECT id, game_id, region_code, region_name, server_hint, is_active
       FROM public.game_regions
       WHERE game_id = $1
       ORDER BY region_name ASC`,
      [req.params.gameId]
    );

    const regions: AdminRegionItem[] = rows.rows.map((r) => ({
      id: r.id,
      gameId: r.game_id,
      regionCode: r.region_code,
      regionName: r.region_name,
      serverHint: r.server_hint,
      isActive: r.is_active,
    }));

    res.json({ regions });
  })
);

adminRouter.post(
  '/catalog/games/:gameId/regions',
  requirePermission('orders.manage'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = adminCreateRegionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid region payload.',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const db = getDb();
    const gameRes = await db.query<{ id: string }>(
      'SELECT id FROM public.games WHERE id = $1 LIMIT 1',
      [req.params.gameId]
    );
    if (!gameRes.rows[0]) {
      res.status(404).json({ error: 'Game not found.', code: 'NOT_FOUND' });
      return;
    }

    const r = parsed.data;
    const clash = await db.query<{ id: string }>(
      'SELECT id FROM public.game_regions WHERE game_id = $1 AND region_code = $2 LIMIT 1',
      [req.params.gameId, r.regionCode]
    );
    if (clash.rows[0]) {
      res.status(409).json({
        error: `Region code "${r.regionCode}" already exists for this game.`,
        code: 'DUPLICATE_REGION',
      });
      return;
    }

    const inserted = await db.query<{
      id: string;
      game_id: string;
      region_code: string;
      region_name: string;
      server_hint: string | null;
      is_active: boolean;
    }>(
      `INSERT INTO public.game_regions (game_id, region_code, region_name, server_hint, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, game_id, region_code, region_name, server_hint, is_active`,
      [req.params.gameId, r.regionCode, r.regionName, r.serverHint ?? null, r.isActive]
    );

    const row = inserted.rows[0];
    await writeAuditLog({
      actorProfileId: req.authUser!.profileId,
      actorRole: req.authUser!.roleCode,
      action: 'admin.catalog_region_created',
      resourceType: 'game_regions',
      resourceId: row.id,
      req,
      details: { gameId: req.params.gameId, regionCode: row.region_code },
    });

    res.status(201).json({
      region: {
        id: row.id,
        gameId: row.game_id,
        regionCode: row.region_code,
        regionName: row.region_name,
        serverHint: row.server_hint,
        isActive: row.is_active,
      } satisfies AdminRegionItem,
    });
  })
);

adminRouter.patch(
  '/catalog/games/:gameId/regions/:regionId',
  requirePermission('orders.manage'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = adminUpdateRegionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid region update.',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const db = getDb();
    const existing = await db.query<{
      id: string;
      game_id: string;
      region_code: string;
      region_name: string;
      server_hint: string | null;
      is_active: boolean;
    }>(
      `SELECT id, game_id, region_code, region_name, server_hint, is_active
       FROM public.game_regions WHERE id = $1 AND game_id = $2 LIMIT 1`,
      [req.params.regionId, req.params.gameId]
    );
    const cur = existing.rows[0];
    if (!cur) {
      res.status(404).json({ error: 'Region not found.', code: 'NOT_FOUND' });
      return;
    }

    const u = parsed.data;
    if (u.regionCode && u.regionCode !== cur.region_code) {
      const clash = await db.query<{ id: string }>(
        'SELECT id FROM public.game_regions WHERE game_id = $1 AND region_code = $2 AND id <> $3 LIMIT 1',
        [req.params.gameId, u.regionCode, req.params.regionId]
      );
      if (clash.rows[0]) {
        res.status(409).json({
          error: `Region code "${u.regionCode}" already exists for this game.`,
          code: 'DUPLICATE_REGION',
        });
        return;
      }
    }

    const updated = await db.query<{
      id: string;
      game_id: string;
      region_code: string;
      region_name: string;
      server_hint: string | null;
      is_active: boolean;
    }>(
      `UPDATE public.game_regions
       SET region_code = $1,
           region_name = $2,
           server_hint = $3,
           is_active = $4
       WHERE id = $5 AND game_id = $6
       RETURNING id, game_id, region_code, region_name, server_hint, is_active`,
      [
        u.regionCode ?? cur.region_code,
        u.regionName ?? cur.region_name,
        u.serverHint !== undefined ? u.serverHint : cur.server_hint,
        u.isActive !== undefined ? u.isActive : cur.is_active,
        req.params.regionId,
        req.params.gameId,
      ]
    );

    const row = updated.rows[0];
    await writeAuditLog({
      actorProfileId: req.authUser!.profileId,
      actorRole: req.authUser!.roleCode,
      action: 'admin.catalog_region_updated',
      resourceType: 'game_regions',
      resourceId: row.id,
      req,
      details: u,
    });

    res.json({
      region: {
        id: row.id,
        gameId: row.game_id,
        regionCode: row.region_code,
        regionName: row.region_name,
        serverHint: row.server_hint,
        isActive: row.is_active,
      } satisfies AdminRegionItem,
    });
  })
);

adminRouter.delete(
  '/catalog/games/:gameId/regions/:regionId',
  requirePermission('orders.manage'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const existing = await db.query<{ id: string; region_name: string }>(
      'SELECT id, region_name FROM public.game_regions WHERE id = $1 AND game_id = $2 LIMIT 1',
      [req.params.regionId, req.params.gameId]
    );
    if (!existing.rows[0]) {
      res.status(404).json({ error: 'Region not found.', code: 'NOT_FOUND' });
      return;
    }

    await db.query('DELETE FROM public.game_regions WHERE id = $1 AND game_id = $2', [
      req.params.regionId,
      req.params.gameId,
    ]);

    await writeAuditLog({
      actorProfileId: req.authUser!.profileId,
      actorRole: req.authUser!.roleCode,
      action: 'admin.catalog_region_deleted',
      resourceType: 'game_regions',
      resourceId: req.params.regionId,
      req,
      details: { gameId: req.params.gameId, regionName: existing.rows[0].region_name },
    });

    res.json({ ok: true });
  })
);

/* -------------------------------------------------------------------------- */
/*  3. CURRENCY MANAGEMENT                                                    */
/* -------------------------------------------------------------------------- */

adminRouter.get(
  '/catalog/currencies',
  requirePermission('orders.read'),
  asyncHandler(async (_req: AuthenticatedRequest, res) => {
    const db = getDb();
    const rows = await db.query<{
      id: string;
      code: string;
      name: string;
      symbol: string;
      description: string;
      image_url: string | null;
      media_id: string | null;
      media_url: string | null;
      game_id: string | null;
      game_title: string | null;
      currency_kind: 'settlement' | 'in_game';
      is_active: boolean;
      sort_order: number;
      package_count: string;
      created_at: string;
    }>(
      `SELECT
         c.id, c.code, c.name, c.symbol, c.description,
         c.image_url, c.media_id, m.public_url AS media_url,
         c.game_id, g.title AS game_title, c.currency_kind,
         c.is_active, c.sort_order,
         (SELECT COUNT(*)::text FROM public.packages p WHERE p.game_currency_id = c.id) AS package_count,
         c.created_at
       FROM public.currencies c
       LEFT JOIN public.games g ON g.id = c.game_id
       LEFT JOIN public.uploaded_media m ON m.id = c.media_id
       WHERE c.currency_kind = 'in_game'
       ORDER BY c.sort_order ASC, c.name ASC`
    );

    const currencies: AdminCurrencyItem[] = rows.rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      symbol: r.symbol,
      description: r.description,
      imageUrl: r.image_url || r.media_url || null,
      mediaId: r.media_id,
      gameId: r.game_id,
      gameTitle: r.game_title,
      currencyKind: r.currency_kind,
      isActive: r.is_active,
      sortOrder: r.sort_order,
      packageCount: Number(r.package_count || '0'),
      createdAt: r.created_at,
    }));

    res.json({ currencies });
  })
);

adminRouter.post(
  '/catalog/currencies',
  requirePermission('orders.manage'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = adminCreateCurrencySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid currency payload.',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const c = parsed.data;
    const db = getDb();

    const clash = await db.query<{ id: string }>(
      'SELECT id FROM public.currencies WHERE code = $1 LIMIT 1',
      [c.code]
    );
    if (clash.rows[0]) {
      res.status(409).json({
        error: `Currency code "${c.code}" already exists.`,
        code: 'DUPLICATE_CODE',
      });
      return;
    }

    const mediaUrl = c.mediaId ? await resolveMediaPublicUrl(c.mediaId) : null;
    const resolvedImageUrl = c.imageUrl || mediaUrl || null;

    const inserted = await db.query<{ id: string; code: string; name: string }>(
      `INSERT INTO public.currencies
         (code, name, symbol, decimal_places, exchange_rate_to_inr, is_base, is_active, currency_kind, game_id, description, image_url, media_id, sort_order)
       VALUES ($1, $2, $3, 0, 1.000000, FALSE, $4, 'in_game', $5, $6, $7, $8, $9)
       RETURNING id, code, name`,
      [
        c.code,
        c.name,
        c.symbol,
        c.isActive,
        c.gameId ?? null,
        c.description,
        resolvedImageUrl,
        c.mediaId ?? null,
        c.sortOrder,
      ]
    );

    await writeAuditLog({
      actorProfileId: req.authUser!.profileId,
      actorRole: req.authUser!.roleCode,
      action: 'admin.catalog_currency_created',
      resourceType: 'currencies',
      resourceId: inserted.rows[0].id,
      req,
      details: { code: c.code, name: c.name, gameId: c.gameId ?? null },
    });

    res.status(201).json({ currency: inserted.rows[0] });
  })
);

adminRouter.patch(
  '/catalog/currencies/:id',
  requirePermission('orders.manage'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = adminUpdateCurrencySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid currency update.',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const db = getDb();
    const existing = await db.query<{
      id: string;
      code: string;
      name: string;
      symbol: string;
      description: string;
      image_url: string | null;
      media_id: string | null;
      game_id: string | null;
      currency_kind: string;
      is_active: boolean;
      sort_order: number;
    }>(
      `SELECT id, code, name, symbol, description, image_url, media_id, game_id, currency_kind, is_active, sort_order
       FROM public.currencies WHERE id = $1 LIMIT 1`,
      [req.params.id]
    );

    const cur = existing.rows[0];
    if (!cur || cur.currency_kind !== 'in_game') {
      res.status(404).json({ error: 'In-game currency not found.', code: 'NOT_FOUND' });
      return;
    }

    const u = parsed.data;
    if (u.code && u.code !== cur.code) {
      const clash = await db.query<{ id: string }>(
        'SELECT id FROM public.currencies WHERE code = $1 AND id <> $2 LIMIT 1',
        [u.code, req.params.id]
      );
      if (clash.rows[0]) {
        res.status(409).json({
          error: `Currency code "${u.code}" is already taken.`,
          code: 'DUPLICATE_CODE',
        });
        return;
      }
    }

    const nextMediaId = u.mediaId !== undefined ? u.mediaId : cur.media_id;
    let nextImageUrl = u.imageUrl !== undefined ? u.imageUrl : cur.image_url;
    if (u.mediaId && u.imageUrl === undefined) {
      nextImageUrl = (await resolveMediaPublicUrl(u.mediaId)) || nextImageUrl;
    }

    const updated = await db.query<{ id: string; code: string; name: string; is_active: boolean }>(
      `UPDATE public.currencies
       SET code = $1,
           name = $2,
           symbol = $3,
           description = $4,
           image_url = $5,
           media_id = $6,
           game_id = $7,
           is_active = $8,
           sort_order = $9
       WHERE id = $10
       RETURNING id, code, name, is_active`,
      [
        u.code ?? cur.code,
        u.name ?? cur.name,
        u.symbol ?? cur.symbol,
        u.description ?? cur.description,
        nextImageUrl,
        nextMediaId,
        u.gameId !== undefined ? u.gameId : cur.game_id,
        u.isActive !== undefined ? u.isActive : cur.is_active,
        u.sortOrder !== undefined ? u.sortOrder : cur.sort_order,
        req.params.id,
      ]
    );

    await writeAuditLog({
      actorProfileId: req.authUser!.profileId,
      actorRole: req.authUser!.roleCode,
      action: 'admin.catalog_currency_updated',
      resourceType: 'currencies',
      resourceId: req.params.id,
      req,
      details: u,
    });

    res.json({ currency: updated.rows[0] });
  })
);

adminRouter.delete(
  '/catalog/currencies/:id',
  requirePermission('orders.manage'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const existing = await db.query<{ id: string; name: string; currency_kind: string }>(
      'SELECT id, name, currency_kind FROM public.currencies WHERE id = $1 LIMIT 1',
      [req.params.id]
    );
    const cur = existing.rows[0];
    if (!cur || cur.currency_kind !== 'in_game') {
      res.status(404).json({ error: 'In-game currency not found.', code: 'NOT_FOUND' });
      return;
    }

    const pkgRefs = await db.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM public.packages WHERE game_currency_id = $1 OR currency_id = $1',
      [req.params.id]
    );
    const count = Number(pkgRefs.rows[0]?.count || '0');
    if (count > 0) {
      res.status(409).json({
        error: `Cannot delete "${cur.name}" because ${count} package(s) use it. Disable this currency or reassign those packages first.`,
        code: 'CURRENCY_IN_USE',
      });
      return;
    }

    await db.query('DELETE FROM public.currencies WHERE id = $1', [req.params.id]);

    await writeAuditLog({
      actorProfileId: req.authUser!.profileId,
      actorRole: req.authUser!.roleCode,
      action: 'admin.catalog_currency_deleted',
      resourceType: 'currencies',
      resourceId: req.params.id,
      req,
      details: { name: cur.name },
    });

    res.json({ ok: true });
  })
);

/* -------------------------------------------------------------------------- */
/*  4. PACKAGE & PRICE MANAGEMENT                                             */
/* -------------------------------------------------------------------------- */

adminRouter.get(
  '/catalog/packages',
  requirePermission('orders.read'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsedQuery = adminFilterQuerySchema.safeParse({
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      gameId: typeof req.query.gameId === 'string' ? req.query.gameId : undefined,
      currencyId: typeof req.query.currencyId === 'string' ? req.query.currencyId : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
    });
    if (!parsedQuery.success) {
      res.status(400).json({ error: 'Invalid filter query parameters.', code: 'VALIDATION_ERROR' });
      return;
    }
    const gameId = parsedQuery.data.gameId;
    const currencyId = parsedQuery.data.currencyId;
    const status = parsedQuery.data.status || 'all';
    const search = parsedQuery.data.search.toLowerCase();

    const db = getDb();
    const rows = await db.query<{
      id: string;
      game_id: string;
      game_title: string;
      game_currency_id: string | null;
      game_currency_name: string | null;
      region_id: string | null;
      sku: string;
      name: string;
      description: string;
      in_game_amount: string;
      in_game_unit: string;
      price_inr: string;
      original_price_inr: string | null;
      discount_percent: string;
      bonus_badge: string | null;
      image_url: string | null;
      media_id: string | null;
      media_url: string | null;
      delivery_type: 'manual' | 'automatic' | 'both';
      supplier_id: string | null;
      supplier_name: string | null;
      supplier_product_code: string;
      supplier_cost_inr: string;
      is_featured: boolean;
      is_active: boolean;
      sort_order: number;
      order_count: string;
      created_at: string;
    }>(
      `SELECT
         p.id, p.game_id, g.title AS game_title,
         p.game_currency_id, gc.name AS game_currency_name,
         p.region_id, p.sku, p.name, p.description,
         p.in_game_amount::text, p.in_game_unit,
         p.price_inr::text, p.original_price_inr::text, p.discount_percent::text,
         p.bonus_badge, p.image_url, p.media_id, m.public_url AS media_url,
         p.delivery_type, p.supplier_id, s.name AS supplier_name,
         p.supplier_product_code, p.supplier_cost_inr::text,
         p.is_featured, p.is_active, p.sort_order,
         (SELECT COUNT(*)::text FROM public.order_items oi WHERE oi.package_id = p.id) AS order_count,
         p.created_at
       FROM public.packages p
       JOIN public.games g ON g.id = p.game_id
       LEFT JOIN public.currencies gc ON gc.id = p.game_currency_id
       LEFT JOIN public.uploaded_media m ON m.id = p.media_id
       LEFT JOIN public.suppliers s ON s.id = p.supplier_id
       ORDER BY g.title ASC, p.sort_order ASC, p.price_inr ASC`
    );

    const mapped: AdminPackageItem[] = rows.rows.map((r) => ({
      id: r.id,
      gameId: r.game_id,
      gameTitle: r.game_title,
      gameCurrencyId: r.game_currency_id,
      gameCurrencyName: r.game_currency_name,
      regionId: r.region_id,
      sku: r.sku,
      name: r.name,
      description: r.description || '',
      inGameAmount: Number(r.in_game_amount),
      inGameUnit: r.in_game_unit,
      priceInr: Number(r.price_inr),
      originalPriceInr: r.original_price_inr ? Number(r.original_price_inr) : null,
      discountPercent: Number(r.discount_percent || '0'),
      bonusBadge: r.bonus_badge || '',
      imageUrl: r.image_url || r.media_url || null,
      mediaId: r.media_id,
      deliveryType: r.delivery_type,
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      supplierProductCode: r.supplier_product_code || '',
      supplierCostInr: Number(r.supplier_cost_inr || '0'),
      isFeatured: Boolean(r.is_featured),
      isActive: r.is_active,
      sortOrder: r.sort_order,
      orderCount: Number(r.order_count || '0'),
      createdAt: r.created_at,
    }));

    const filtered = mapped.filter((p) => {
      if (gameId && gameId !== 'all' && p.gameId !== gameId) return false;
      if (currencyId && currencyId !== 'all' && p.gameCurrencyId !== currencyId) return false;
      if (status === 'active' && !p.isActive) return false;
      if (status === 'inactive' && p.isActive) return false;
      if (search) {
        const hay = `${p.name} ${p.sku} ${p.gameTitle} ${p.inGameUnit}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    res.json({ packages: filtered });
  })
);

adminRouter.post(
  '/catalog/packages',
  requirePermission('orders.manage'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = adminCreatePackageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid package payload.',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const p = parsed.data;
    const pricing = computeNormalizedPackagePricing({
      priceInr: p.priceInr,
      originalPriceInr: p.originalPriceInr ?? null,
      discountPercent: p.discountPercent,
    });
    if (!pricing.valid) {
      res.status(400).json({ error: pricing.error, code: 'INVALID_PRICING' });
      return;
    }

    const db = getDb();
    const inrRes = await db.query<{ id: string }>(
      `SELECT id FROM public.currencies WHERE code = 'INR' LIMIT 1`
    );
    const currencyId = inrRes.rows[0]?.id;
    if (!currencyId) {
      res.status(500).json({ error: 'Base currency INR missing.' });
      return;
    }

    const skuClash = await db.query<{ id: string }>(
      'SELECT id FROM public.packages WHERE sku = $1 LIMIT 1',
      [p.sku]
    );
    if (skuClash.rows[0]) {
      res.status(409).json({ error: `Package SKU "${p.sku}" already exists.`, code: 'DUPLICATE_SKU' });
      return;
    }

    const mediaUrl = p.mediaId ? await resolveMediaPublicUrl(p.mediaId) : null;
    const resolvedImageUrl = p.imageUrl || mediaUrl || null;

    const inserted = await db.query<{ id: string; sku: string; name: string; price_inr: string }>(
      `INSERT INTO public.packages
         (game_id, game_currency_id, region_id, currency_id, sku, name, description,
          in_game_amount, in_game_unit, price_inr, original_price_inr, discount_percent, bonus_badge,
          image_url, media_id, delivery_type, supplier_id, supplier_product_code, supplier_cost_inr,
          is_featured, is_active, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
       RETURNING id, sku, name, price_inr::text`,
      [
        p.gameId,
        p.gameCurrencyId ?? null,
        p.regionId ?? null,
        currencyId,
        p.sku,
        p.name,
        p.description,
        p.inGameAmount,
        p.inGameUnit,
        pricing.priceInr,
        pricing.originalPriceInr,
        pricing.discountPercent,
        p.bonusBadge ?? '',
        resolvedImageUrl,
        p.mediaId ?? null,
        p.deliveryType,
        p.supplierId ?? null,
        p.supplierProductCode ?? '',
        p.supplierCostInr ?? 0,
        p.isFeatured,
        p.isActive,
        p.sortOrder,
      ]
    );

    await writeAuditLog({
      actorProfileId: req.authUser!.profileId,
      actorRole: req.authUser!.roleCode,
      action: 'admin.catalog_package_created',
      resourceType: 'packages',
      resourceId: inserted.rows[0].id,
      req,
      details: { sku: p.sku, priceInr: pricing.priceInr, originalPriceInr: pricing.originalPriceInr },
    });

    res.status(201).json({ package: inserted.rows[0] });
  })
);

adminRouter.patch(
  '/catalog/packages/:id',
  requirePermission('orders.manage'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = adminUpdatePackageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid package update.',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const db = getDb();
    const existing = await db.query<{
      id: string;
      game_id: string;
      game_currency_id: string | null;
      sku: string;
      name: string;
      description: string;
      in_game_amount: string;
      in_game_unit: string;
      price_inr: string;
      original_price_inr: string | null;
      discount_percent: string;
      bonus_badge: string | null;
      is_active: boolean;
      is_featured: boolean;
      sort_order: number;
      image_url: string | null;
      media_id: string | null;
      delivery_type: 'manual' | 'automatic' | 'both';
      supplier_id: string | null;
      supplier_product_code: string;
      supplier_cost_inr: string;
    }>(
      `SELECT id, game_id, game_currency_id, sku, name, description, in_game_amount::text,
              in_game_unit, price_inr::text, original_price_inr::text, discount_percent::text,
              bonus_badge, is_active, is_featured, sort_order, image_url, media_id, delivery_type,
              supplier_id, supplier_product_code, supplier_cost_inr::text
       FROM public.packages WHERE id = $1 LIMIT 1`,
      [req.params.id]
    );
    if (!existing.rows[0]) {
      res.status(404).json({ error: 'Package not found.', code: 'NOT_FOUND' });
      return;
    }

    const cur = existing.rows[0];
    const u = parsed.data;

    if (u.sku && u.sku !== cur.sku) {
      const clash = await db.query<{ id: string }>(
        'SELECT id FROM public.packages WHERE sku = $1 AND id <> $2 LIMIT 1',
        [u.sku, req.params.id]
      );
      if (clash.rows[0]) {
        res.status(409).json({ error: `SKU "${u.sku}" is already taken.`, code: 'DUPLICATE_SKU' });
        return;
      }
    }

    const pricing = computeNormalizedPackagePricing({
      priceInr: u.priceInr ?? Number(cur.price_inr),
      originalPriceInr:
        u.originalPriceInr !== undefined
          ? u.originalPriceInr
          : cur.original_price_inr
            ? Number(cur.original_price_inr)
            : null,
      discountPercent: u.discountPercent,
    });

    if (!pricing.valid) {
      res.status(400).json({ error: pricing.error, code: 'INVALID_PRICING' });
      return;
    }

    const nextMediaId = u.mediaId !== undefined ? u.mediaId : cur.media_id;
    let nextImageUrl = u.imageUrl !== undefined ? u.imageUrl : cur.image_url;
    if (u.mediaId && u.imageUrl === undefined) {
      nextImageUrl = (await resolveMediaPublicUrl(u.mediaId)) || nextImageUrl;
    }

    const updated = await db.query<{ id: string; name: string; price_inr: string; is_active: boolean }>(
      `UPDATE public.packages
       SET game_id = $1,
           game_currency_id = $2,
           sku = $3,
           name = $4,
           description = $5,
           in_game_amount = $6,
           in_game_unit = $7,
           price_inr = $8,
           original_price_inr = $9,
           discount_percent = $10,
           bonus_badge = $11,
           is_active = $12,
           is_featured = $13,
           sort_order = $14,
           image_url = $15,
           media_id = $16,
           delivery_type = $17,
           supplier_id = $18,
           supplier_product_code = $19,
           supplier_cost_inr = $20
       WHERE id = $21
       RETURNING id, name, price_inr::text, is_active`,
      [
        u.gameId ?? cur.game_id,
        u.gameCurrencyId !== undefined ? u.gameCurrencyId : cur.game_currency_id,
        u.sku ?? cur.sku,
        u.name ?? cur.name,
        u.description ?? cur.description,
        u.inGameAmount ?? Number(cur.in_game_amount),
        u.inGameUnit ?? cur.in_game_unit,
        pricing.priceInr,
        pricing.originalPriceInr,
        pricing.discountPercent,
        u.bonusBadge !== undefined ? u.bonusBadge : cur.bonus_badge || '',
        u.isActive !== undefined ? u.isActive : cur.is_active,
        u.isFeatured !== undefined ? u.isFeatured : cur.is_featured,
        u.sortOrder !== undefined ? u.sortOrder : cur.sort_order,
        nextImageUrl,
        nextMediaId,
        u.deliveryType ?? cur.delivery_type,
        u.supplierId !== undefined ? u.supplierId : cur.supplier_id,
        u.supplierProductCode ?? cur.supplier_product_code,
        u.supplierCostInr !== undefined ? u.supplierCostInr : Number(cur.supplier_cost_inr || '0'),
        req.params.id,
      ]
    );

    await writeAuditLog({
      actorProfileId: req.authUser!.profileId,
      actorRole: req.authUser!.roleCode,
      action: 'admin.catalog_package_updated',
      resourceType: 'packages',
      resourceId: req.params.id,
      req,
      details: { ...u, normalizedPriceInr: pricing.priceInr, discountPercent: pricing.discountPercent },
    });

    res.json({ package: updated.rows[0] });
  })
);

adminRouter.patch(
  '/catalog/packages/:id/price',
  requirePermission('orders.manage'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = adminUpdatePriceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid price update.',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const db = getDb();
    const existing = await db.query<{
      id: string;
      name: string;
      price_inr: string;
      original_price_inr: string | null;
      supplier_cost_inr: string;
      bonus_badge: string | null;
    }>(
      'SELECT id, name, price_inr::text, original_price_inr::text, supplier_cost_inr::text, bonus_badge FROM public.packages WHERE id = $1 LIMIT 1',
      [req.params.id]
    );
    const cur = existing.rows[0];
    if (!cur) {
      res.status(404).json({ error: 'Package not found.', code: 'NOT_FOUND' });
      return;
    }

    const pricing = computeNormalizedPackagePricing({
      priceInr: parsed.data.priceInr ?? Number(cur.price_inr),
      originalPriceInr:
        parsed.data.originalPriceInr !== undefined
          ? parsed.data.originalPriceInr
          : cur.original_price_inr
            ? Number(cur.original_price_inr)
            : null,
      discountPercent: parsed.data.discountPercent,
    });
    if (!pricing.valid) {
      res.status(400).json({ error: pricing.error, code: 'INVALID_PRICING' });
      return;
    }

    const nextCost =
      parsed.data.supplierCostInr !== undefined
        ? parsed.data.supplierCostInr
        : Number(cur.supplier_cost_inr || '0');
    const nextBadge =
      parsed.data.bonusBadge !== undefined ? parsed.data.bonusBadge : cur.bonus_badge || '';

    const updated = await db.query<{
      id: string;
      price_inr: string;
      original_price_inr: string | null;
      discount_percent: string;
      supplier_cost_inr: string;
      bonus_badge: string | null;
    }>(
      `UPDATE public.packages
       SET price_inr = $1,
           original_price_inr = $2,
           discount_percent = $3,
           supplier_cost_inr = $4,
           bonus_badge = $5
       WHERE id = $6
       RETURNING id, price_inr::text, original_price_inr::text, discount_percent::text, supplier_cost_inr::text, bonus_badge`,
      [pricing.priceInr, pricing.originalPriceInr, pricing.discountPercent, nextCost, nextBadge, req.params.id]
    );

    const updatedCost = Number(updated.rows[0].supplier_cost_inr || '0');
    const updatedPrice = Number(updated.rows[0].price_inr);
    const margin = computeProfitMargin({ sellingPriceInr: updatedPrice, supplierCostInr: updatedCost });

    await writeAuditLog({
      actorProfileId: req.authUser!.profileId,
      actorRole: req.authUser!.roleCode,
      action: 'admin.catalog_price_updated',
      resourceType: 'packages',
      resourceId: req.params.id,
      req,
      details: {
        name: cur.name,
        priceInr: pricing.priceInr,
        originalPriceInr: pricing.originalPriceInr,
        discountPercent: pricing.discountPercent,
        supplierCostInr: updatedCost,
        bonusBadge: nextBadge,
      },
    });

    res.json({
      id: updated.rows[0].id,
      priceInr: updatedPrice,
      originalPriceInr: updated.rows[0].original_price_inr
        ? Number(updated.rows[0].original_price_inr)
        : null,
      discountPercent: Number(updated.rows[0].discount_percent),
      supplierCostInr: updatedCost,
      bonusBadge: updated.rows[0].bonus_badge || '',
      netProfitInr: margin.netProfitInr,
      marginPercent: margin.marginPercent,
    });
  })
);

adminRouter.post(
  '/catalog/packages/:id/duplicate',
  requirePermission('orders.manage'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const existing = await db.query<{
      game_id: string;
      game_currency_id: string | null;
      region_id: string | null;
      currency_id: string;
      sku: string;
      name: string;
      description: string;
      in_game_amount: string;
      in_game_unit: string;
      price_inr: string;
      original_price_inr: string | null;
      discount_percent: string;
      bonus_badge: string | null;
      supplier_cost_inr: string;
      image_url: string | null;
      media_id: string | null;
      delivery_type: 'manual' | 'automatic';
      is_featured: boolean;
      sort_order: number;
    }>('SELECT * FROM public.packages WHERE id = $1 LIMIT 1', [req.params.id]);

    const src = existing.rows[0];
    if (!src) {
      res.status(404).json({ error: 'Package not found.', code: 'NOT_FOUND' });
      return;
    }

    const newSku = `${src.sku}-COPY-${Date.now().toString(36).toUpperCase().slice(-4)}`;
    const inserted = await db.query<{ id: string; sku: string; name: string }>(
      `INSERT INTO public.packages
         (game_id, game_currency_id, region_id, currency_id, sku, name, description,
          in_game_amount, in_game_unit, price_inr, original_price_inr, discount_percent, bonus_badge, supplier_cost_inr,
          image_url, media_id, delivery_type, is_featured, is_active, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, FALSE, $19)
       RETURNING id, sku, name`,
      [
        src.game_id,
        src.game_currency_id,
        src.region_id,
        src.currency_id,
        newSku,
        `${src.name} (Copy)`,
        src.description,
        Number(src.in_game_amount),
        src.in_game_unit,
        Number(src.price_inr),
        src.original_price_inr ? Number(src.original_price_inr) : null,
        Number(src.discount_percent || '0'),
        src.bonus_badge || '',
        Number(src.supplier_cost_inr || '0'),
        src.image_url,
        src.media_id,
        src.delivery_type,
        src.is_featured,
        src.sort_order + 1,
      ]
    );

    await writeAuditLog({
      actorProfileId: req.authUser!.profileId,
      actorRole: req.authUser!.roleCode,
      action: 'admin.catalog_package_duplicated',
      resourceType: 'packages',
      resourceId: inserted.rows[0].id,
      req,
      details: { sourcePackageId: req.params.id, newSku },
    });

    res.status(201).json({ package: inserted.rows[0] });
  })
);

adminRouter.delete(
  '/catalog/packages/:id',
  requirePermission('orders.manage'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const existing = await db.query<{ id: string; name: string }>(
      'SELECT id, name FROM public.packages WHERE id = $1 LIMIT 1',
      [req.params.id]
    );
    if (!existing.rows[0]) {
      res.status(404).json({ error: 'Package not found.', code: 'NOT_FOUND' });
      return;
    }

    const orderRefs = await db.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM public.order_items WHERE package_id = $1',
      [req.params.id]
    );
    const count = Number(orderRefs.rows[0]?.count || '0');
    if (count > 0) {
      res.status(409).json({
        error: `Cannot delete "${existing.rows[0].name}" because ${count} customer order item(s) reference it. Disable the package instead.`,
        code: 'PACKAGE_HAS_ORDERS',
      });
      return;
    }

    await db.query('DELETE FROM public.packages WHERE id = $1', [req.params.id]);

    await writeAuditLog({
      actorProfileId: req.authUser!.profileId,
      actorRole: req.authUser!.roleCode,
      action: 'admin.catalog_package_deleted',
      resourceType: 'packages',
      resourceId: req.params.id,
      req,
      details: { name: existing.rows[0].name },
    });

    res.json({ ok: true });
  })
);

/* -------------------------------------------------------------------------- */
/*  5. MEDIA LIBRARY                                                          */
/* -------------------------------------------------------------------------- */

adminRouter.get(
  '/media',
  requirePermission('orders.read'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsedQuery = adminFilterQuerySchema.safeParse({
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
    });
    if (!parsedQuery.success) {
      res.status(400).json({ error: 'Invalid filter query parameters.', code: 'VALIDATION_ERROR' });
      return;
    }
    const search = parsedQuery.data.search.toLowerCase();
    const db = getDb();
    const rows = await db.query<{
      id: string;
      storage_bucket: string;
      storage_path: string;
      public_url: string | null;
      mime_type: string;
      byte_size: string;
      alt_text: string | null;
      created_at: string;
      game_refs: string;
      currency_refs: string;
      package_refs: string;
    }>(
      `SELECT
         m.id, m.storage_bucket, m.storage_path, m.public_url, m.mime_type, m.byte_size::text,
         m.alt_text, m.created_at,
         (SELECT COUNT(*)::text FROM public.games g WHERE g.cover_media_id = m.id OR g.cover_image_url = m.public_url) AS game_refs,
         (SELECT COUNT(*)::text FROM public.currencies c WHERE c.media_id = m.id OR c.image_url = m.public_url) AS currency_refs,
         (SELECT COUNT(*)::text FROM public.packages p WHERE p.media_id = m.id OR p.image_url = m.public_url) AS package_refs
       FROM public.uploaded_media m
       ORDER BY m.created_at DESC`
    );

    const media: AdminMediaItem[] = rows.rows
      .map((r) => ({
        id: r.id,
        storageBucket: r.storage_bucket,
        storagePath: r.storage_path,
        publicUrl: r.public_url || `/media/${r.storage_path}`,
        mimeType: r.mime_type,
        byteSize: Number(r.byte_size || '0'),
        altText: r.alt_text || '',
        createdAt: r.created_at,
        referenceCount:
          Number(r.game_refs || '0') +
          Number(r.currency_refs || '0') +
          Number(r.package_refs || '0'),
      }))
      .filter((item) => {
        if (!search) return true;
        return `${item.altText} ${item.storagePath} ${item.mimeType}`.toLowerCase().includes(search);
      });

    res.json({ media });
  })
);

adminRouter.post(
  '/media/upload',
  requirePermission('orders.manage'),
  adminUploadRateLimiter,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = adminMediaUploadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid image upload payload.',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const saved = await saveUploadedImageFile({
      base64Data: parsed.data.dataBase64,
      mimeType: parsed.data.mimeType,
      originalFileName: parsed.data.fileName,
    });
    if (!saved.ok) {
      res.status(400).json({ error: saved.error, code: 'INVALID_MEDIA_FILE' });
      return;
    }

    const db = getDb();
    const inserted = await db.query<{
      id: string;
      storage_bucket: string;
      storage_path: string;
      public_url: string;
      mime_type: string;
      byte_size: string;
      alt_text: string | null;
      created_at: string;
    }>(
      `INSERT INTO public.uploaded_media
         (storage_bucket, storage_path, public_url, mime_type, byte_size, alt_text, uploaded_by_profile_id, is_public)
       VALUES ('lps-media', $1, $2, $3, $4, $5, $6, TRUE)
       RETURNING id, storage_bucket, storage_path, public_url, mime_type, byte_size::text, alt_text, created_at`,
      [
        saved.storagePath,
        saved.publicUrl,
        saved.mimeType,
        saved.byteSize,
        parsed.data.altText || parsed.data.fileName,
        req.authUser!.profileId,
      ]
    );

    const row = inserted.rows[0];
    await writeAuditLog({
      actorProfileId: req.authUser!.profileId,
      actorRole: req.authUser!.roleCode,
      action: 'admin.media_uploaded',
      resourceType: 'uploaded_media',
      resourceId: row.id,
      req,
      details: { mimeType: row.mime_type, byteSize: Number(row.byte_size), publicUrl: row.public_url },
    });

    const media: AdminMediaItem = {
      id: row.id,
      storageBucket: row.storage_bucket,
      storagePath: row.storage_path,
      publicUrl: row.public_url,
      mimeType: row.mime_type,
      byteSize: Number(row.byte_size),
      altText: row.alt_text || '',
      createdAt: row.created_at,
      referenceCount: 0,
    };

    res.status(201).json({ media });
  })
);

adminRouter.delete(
  '/media/:id',
  requirePermission('orders.manage'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const existing = await db.query<{
      id: string;
      storage_path: string;
      public_url: string | null;
    }>('SELECT id, storage_path, public_url FROM public.uploaded_media WHERE id = $1 LIMIT 1', [
      req.params.id,
    ]);
    const row = existing.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Media item not found.', code: 'NOT_FOUND' });
      return;
    }

    const refs = await findMediaReferences(db, row.id, row.public_url);
    if (refs.length > 0) {
      res.status(409).json({
        error: `Cannot delete this image because it is currently used by ${refs.join(', ')}. Replace or remove the reference first.`,
        code: 'MEDIA_IN_USE',
      });
      return;
    }

    await db.query('DELETE FROM public.uploaded_media WHERE id = $1', [row.id]);
    await deleteUploadedImageFile(row.storage_path);

    await writeAuditLog({
      actorProfileId: req.authUser!.profileId,
      actorRole: req.authUser!.roleCode,
      action: 'admin.media_deleted',
      resourceType: 'uploaded_media',
      resourceId: row.id,
      req,
      details: { storagePath: row.storage_path },
    });

    res.json({ ok: true });
  })
);

/* -------------------------------------------------------------------------- */
/*  6. ORDER PROCESSING & DELIVERY MANAGEMENT (PHASE 3 + PHASE 4)             */
/* -------------------------------------------------------------------------- */

interface AdminOrderRow {
  id: string;
  order_number: string;
  order_item_id: string | null;
  customer_id: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_code: string | null;
  game_id: string | null;
  game_title: string | null;
  package_id: string | null;
  package_name: string | null;
  in_game_amount: string | null;
  in_game_unit: string | null;
  quantity: number | null;
  total_inr: string;
  supplier_cost_inr: string;
  net_profit_inr: string;
  currency_code: string;
  status: string;
  payment_status: string;
  gateway_order_id: string | null;
  gateway_payment_id: string | null;
  supplier_tx_id: string | null;
  delivery_method: 'manual' | 'automatic' | 'both' | null;
  fulfillment_status: string | null;
  region_name: string | null;
  target_player_uid: string | null;
  target_server_id: string | null;
  player_details: Record<string, string> | null;
  customer_note: string | null;
  admin_note: string | null;
  delivery_notes: string | null;
  customer_delivery_message: string | null;
  processed_by_name: string | null;
  processing_started_at: string | null;
  completed_by_name: string | null;
  fulfilled_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapAdminOrderRow(r: AdminOrderRow): AdminOrderItem {
  return {
    id: r.id,
    orderNumber: r.order_number,
    orderItemId: r.order_item_id,
    customerId: r.customer_id,
    customerName: r.customer_name || 'Customer',
    customerEmail: r.customer_email || '',
    customerCode: r.customer_code || '',
    gameId: r.game_id,
    gameTitle: r.game_title || 'Top-Up Order',
    packageId: r.package_id,
    packageName: r.package_name || 'Package',
    inGameAmount: Number(r.in_game_amount || '0'),
    inGameUnit: r.in_game_unit || '',
    quantity: Number(r.quantity || 1),
    totalInr: Number(r.total_inr),
    supplierCostInr: Number(r.supplier_cost_inr || '0'),
    netProfitInr: Number(r.net_profit_inr || '0'),
    currencyCode: r.currency_code,
    status: r.status,
    displayOrderStatus: mapPhase4OrderStatusLabel(r.status),
    paymentStatus: r.payment_status,
    displayPaymentStatus: mapPhase4PaymentStatusLabel(r.payment_status),
    gatewayOrderId: r.gateway_order_id,
    gatewayPaymentId: r.gateway_payment_id,
    supplierTxId: r.supplier_tx_id,
    deliveryMethod: r.delivery_method || 'manual',
    fulfillmentStatus: r.fulfillment_status || 'pending',
    displayDeliveryStatus: mapPhase4DeliveryStatusLabel(r.fulfillment_status || 'pending'),
    regionName: r.region_name,
    targetPlayerUid: r.target_player_uid || '',
    targetServerId: r.target_server_id,
    playerDetails: r.player_details || {},
    customerNote: r.customer_note,
    adminNote: r.admin_note || '',
    deliveryNotes: r.delivery_notes || '',
    customerDeliveryMessage: r.customer_delivery_message || '',
    processedByName: r.processed_by_name,
    processingStartedAt: r.processing_started_at,
    completedByName: r.completed_by_name,
    fulfilledAt: r.fulfilled_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const ADMIN_ORDER_BASE_SELECT = `
  SELECT
    o.id, o.order_number, oi.id AS order_item_id, o.customer_id,
    p.full_name AS customer_name, p.email AS customer_email, c.customer_code,
    oi.game_id, g.title AS game_title,
    oi.package_id, pkg.name AS package_name,
    pkg.in_game_amount::text, pkg.in_game_unit, oi.quantity,
    o.total_inr::text, o.supplier_cost_inr::text, o.net_profit_inr::text,
    o.currency_code, o.status, o.payment_status,
    (
      SELECT pay.razorpay_order_id
      FROM public.payments pay
      WHERE pay.order_id = o.id
      ORDER BY pay.created_at DESC
      LIMIT 1
    ) AS gateway_order_id,
    (
      SELECT pay.razorpay_payment_id
      FROM public.payments pay
      WHERE pay.order_id = o.id
      ORDER BY pay.created_at DESC
      LIMIT 1
    ) AS gateway_payment_id,
    (
      SELECT so.external_reference
      FROM public.supplier_orders so
      JOIN public.order_items soi ON soi.id = so.order_item_id
      WHERE soi.order_id = o.id
      ORDER BY so.created_at DESC
      LIMIT 1
    ) AS supplier_tx_id,
    o.delivery_method, oi.fulfillment_status, gr.region_name,
    oi.target_player_uid, oi.target_server_id, oi.player_details,
    o.customer_note, o.admin_note, o.delivery_notes, o.customer_delivery_message,
    proc_prof.full_name AS processed_by_name, o.processing_started_at,
    comp_prof.full_name AS completed_by_name, o.fulfilled_at,
    o.created_at, o.updated_at
  FROM public.orders o
  LEFT JOIN public.customers c ON c.id = o.customer_id
  LEFT JOIN public.profiles p ON p.id = c.profile_id
  LEFT JOIN public.order_items oi ON oi.order_id = o.id
  LEFT JOIN public.games g ON g.id = oi.game_id
  LEFT JOIN public.packages pkg ON pkg.id = oi.package_id
  LEFT JOIN public.game_regions gr ON gr.id = oi.region_id
  LEFT JOIN public.admin_users proc_admin ON proc_admin.id = o.processed_by_admin_id
  LEFT JOIN public.profiles proc_prof ON proc_prof.id = proc_admin.profile_id
  LEFT JOIN public.admin_users comp_admin ON comp_admin.id = o.completed_by_admin_id
  LEFT JOIN public.profiles comp_prof ON comp_prof.id = comp_admin.profile_id
`;

adminRouter.get(
  '/orders',
  requirePermission('orders.read'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsedQuery = adminFilterQuerySchema.safeParse({
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      gameId: typeof req.query.gameId === 'string' ? req.query.gameId : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
    });
    if (!parsedQuery.success) {
      res.status(400).json({ error: 'Invalid filter query parameters.', code: 'VALIDATION_ERROR' });
      return;
    }
    const search = parsedQuery.data.search.toLowerCase();
    const gameId = parsedQuery.data.gameId;
    const status = parsedQuery.data.status || 'all';

    const db = getDb();
    const rows = await db.query<AdminOrderRow>(
      `${ADMIN_ORDER_BASE_SELECT}
       ORDER BY o.created_at DESC
       LIMIT 200`
    );

    const orders: AdminOrderItem[] = rows.rows
      .map(mapAdminOrderRow)
      .filter((o) => {
        if (gameId && gameId !== 'all' && o.gameId !== gameId) return false;
        if (status && status !== 'all' && o.status !== status) return false;
        if (search) {
          const playerBlob = Object.values(o.playerDetails).join(' ');
          const hay =
            `${o.orderNumber} ${o.targetPlayerUid} ${playerBlob} ${o.customerEmail} ${o.customerName} ${o.gameTitle} ${o.gatewayOrderId || ''} ${o.gatewayPaymentId || ''} ${o.supplierTxId || ''}`.toLowerCase();
          if (!hay.includes(search)) return false;
        }
        return true;
      });

    res.json({ orders });
  })
);

adminRouter.get(
  '/orders/:id',
  requirePermission('orders.read'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const rowRes = await db.query<AdminOrderRow>(
      `${ADMIN_ORDER_BASE_SELECT}
       WHERE o.id = $1
       LIMIT 1`,
      [req.params.id]
    );
    const row = rowRes.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Order not found.', code: 'NOT_FOUND' });
      return;
    }

    const [supRes, logRes] = await Promise.all([
      db.query<{
        id: string;
        order_id: string;
        order_item_id: string;
        supplier_id: string;
        supplier_name: string;
        supplier_code: string;
        external_reference: string | null;
        cost_inr: string;
        status: 'pending' | 'submitted' | 'completed' | 'failed' | 'cancelled';
        is_mock: boolean;
        environment_label: string;
        attempt_count: number;
        max_attempts: number;
        error_message: string;
        request_payload: Record<string, unknown>;
        response_payload: Record<string, unknown>;
        last_checked_at: string | null;
        created_at: string;
        updated_at: string;
      }>(
        `SELECT
           so.id, COALESCE(so.order_id, oi.order_id) AS order_id, so.order_item_id, so.supplier_id,
           s.name AS supplier_name, s.code AS supplier_code,
           so.external_reference, so.cost_inr::text, so.status, so.is_mock,
           so.environment_label, so.attempt_count, so.max_attempts,
           so.error_message, so.request_payload, so.response_payload,
           so.last_checked_at, so.created_at, so.updated_at
         FROM public.supplier_orders so
         JOIN public.order_items oi ON oi.id = so.order_item_id
         JOIN public.suppliers s ON s.id = so.supplier_id
         WHERE oi.order_id = $1
         ORDER BY so.created_at DESC`,
        [req.params.id]
      ),
      db.query<{
        id: string;
        order_id: string;
        actor_label: string;
        event_type: string;
        previous_status: string | null;
        next_status: string | null;
        delivery_method: string | null;
        is_mock: boolean;
        message: string;
        created_at: string;
      }>(
        `SELECT id, order_id, actor_label, event_type, previous_status, next_status, delivery_method, is_mock, message, created_at
         FROM public.order_delivery_logs
         WHERE order_id = $1
         ORDER BY created_at DESC`,
        [req.params.id]
      ),
    ]);

    const order = mapAdminOrderRow(row);
    order.supplierOrders = supRes.rows.map(
      (s): SupplierOrderItem => ({
        id: s.id,
        orderId: s.order_id,
        orderItemId: s.order_item_id,
        supplierId: s.supplier_id,
        supplierName: s.supplier_name,
        supplierCode: s.supplier_code,
        externalReference: s.external_reference,
        costInr: Number(s.cost_inr || '0'),
        status: s.status,
        isMock: s.is_mock,
        environmentLabel: s.environment_label,
        attemptCount: s.attempt_count,
        maxAttempts: s.max_attempts,
        errorMessage: s.error_message || '',
        requestPayload: s.request_payload || {},
        responsePayload: s.response_payload || {},
        lastCheckedAt: s.last_checked_at,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
      })
    );
    order.deliveryLogs = logRes.rows.map(
      (l): OrderDeliveryLogItem => ({
        id: l.id,
        orderId: l.order_id,
        actorLabel: l.actor_label,
        eventType: l.event_type,
        previousStatus: l.previous_status,
        nextStatus: l.next_status,
        deliveryMethod: l.delivery_method,
        isMock: l.is_mock,
        message: l.message,
        createdAt: l.created_at,
      })
    );

    res.json({ order });
  })
);

adminRouter.patch(
  '/orders/:id',
  requirePermission('orders.manage'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = adminUpdateOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid order update.',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const u = parsed.data;
    if (u.status && !isPermittedPhase4AdminOrderStatus(u.status)) {
      res.status(400).json({
        error:
          'Orders cannot be marked Paid, Payment Verified, or Refunded without verified payment gateway confirmation.',
        code: 'INVALID_STATUS_TRANSITION',
      });
      return;
    }

    const db = getDb();
    const existing = await db.query<{
      id: string;
      order_number: string;
      status: string;
      payment_status: string;
      delivery_method: 'manual' | 'automatic' | 'both';
      admin_note: string | null;
      delivery_notes: string | null;
      customer_delivery_message: string | null;
      processed_by_admin_id: string | null;
    }>(
      `SELECT id, order_number, status, payment_status, delivery_method, admin_note, delivery_notes, customer_delivery_message, processed_by_admin_id
       FROM public.orders WHERE id = $1 LIMIT 1`,
      [req.params.id]
    );
    const cur = existing.rows[0];
    if (!cur) {
      res.status(404).json({ error: 'Order not found.', code: 'NOT_FOUND' });
      return;
    }

    const nextStatus = u.status ?? cur.status;

    if (nextStatus !== cur.status && nextStatus === 'completed') {
      const guard = validateOrderCompletionGuard({
        targetStatus: nextStatus,
        confirmCompleted: u.confirmCompleted,
      });
      if (!guard.allowed) {
        res.status(400).json({ error: guard.error, code: 'CONFIRMATION_REQUIRED' });
        return;
      }
    }

    const adminRow = await db.query<{ id: string }>(
      'SELECT id FROM public.admin_users WHERE profile_id = $1 LIMIT 1',
      [req.authUser!.profileId]
    );
    const adminUserId = adminRow.rows[0]?.id ?? null;

    const nextDeliveryMethod = u.deliveryMethod ?? cur.delivery_method;
    const nextAdminNote = u.adminNote !== undefined ? u.adminNote : cur.admin_note || '';
    const nextDeliveryNotes =
      u.deliveryNotes !== undefined ? u.deliveryNotes : cur.delivery_notes || '';
    const nextCustomerMsg =
      u.customerDeliveryMessage !== undefined
        ? u.customerDeliveryMessage
        : cur.customer_delivery_message || '';

    const nextFulfillment =
      u.fulfillmentStatus ??
      (nextStatus === 'completed'
        ? 'delivered'
        : nextStatus === 'awaiting_delivery'
          ? 'awaiting_delivery'
          : nextStatus === 'processing' || nextStatus === 'fulfilling'
            ? 'processing'
            : nextStatus === 'failed' || nextStatus === 'cancelled'
              ? 'failed'
              : undefined);

    const isEnteringProcessing = ['processing', 'fulfilling', 'awaiting_delivery', 'completed'].includes(
      nextStatus
    );
    const isEnteringCompleted = nextStatus === 'completed' && cur.status !== 'completed';

    await db.withTransaction(async (tx) => {
      // Strictly never mark payment_status as captured/paid in Phase 4
      await tx.query(
        `UPDATE public.orders
         SET status = $1,
             delivery_method = $2,
             admin_note = $3,
             delivery_notes = $4,
             customer_delivery_message = $5,
             processed_by_admin_id = CASE WHEN $6 THEN COALESCE(processed_by_admin_id, $7) ELSE processed_by_admin_id END,
             processing_started_at = CASE WHEN $6 THEN COALESCE(processing_started_at, NOW()) ELSE processing_started_at END,
             completed_by_admin_id = CASE WHEN $8 THEN $7 ELSE completed_by_admin_id END,
             fulfilled_at = CASE WHEN $8 THEN COALESCE(fulfilled_at, NOW()) ELSE fulfilled_at END
         WHERE id = $9`,
        [
          nextStatus,
          nextDeliveryMethod,
          nextAdminNote,
          nextDeliveryNotes,
          nextCustomerMsg,
          isEnteringProcessing,
          adminUserId,
          isEnteringCompleted,
          req.params.id,
        ]
      );

      if (nextFulfillment) {
        await tx.query(
          `UPDATE public.order_items
           SET fulfillment_status = $1
           WHERE order_id = $2`,
          [nextFulfillment, req.params.id]
        );
      }

      const logMsg =
        nextStatus !== cur.status
          ? `Admin updated status from ${mapPhase4OrderStatusLabel(cur.status)} to ${mapPhase4OrderStatusLabel(nextStatus)}.${
              nextDeliveryNotes ? ` Note: ${nextDeliveryNotes}` : ''
            }`
          : `Admin updated order delivery notes/message.`;

      await tx.query(
        `INSERT INTO public.order_delivery_logs
           (order_id, actor_profile_id, actor_label, event_type, previous_status, next_status, delivery_method, is_mock, message)
         VALUES ($1, $2, $3, 'manual_update', $4, $5, $6, FALSE, $7)`,
        [
          req.params.id,
          req.authUser!.profileId,
          req.authUser!.fullName || req.authUser!.email,
          cur.status,
          nextStatus,
          nextDeliveryMethod,
          logMsg,
        ]
      );
    });

    await writeAuditLog({
      actorProfileId: req.authUser!.profileId,
      actorRole: req.authUser!.roleCode,
      action: 'admin.order_updated',
      resourceType: 'orders',
      resourceId: req.params.id,
      req,
      details: {
        orderNumber: cur.order_number,
        previousStatus: cur.status,
        nextStatus,
        deliveryMethod: nextDeliveryMethod,
        fulfillmentStatus: nextFulfillment,
      },
    });

    res.json({
      ok: true,
      status: nextStatus,
      displayOrderStatus: mapPhase4OrderStatusLabel(nextStatus),
      adminNote: nextAdminNote,
      deliveryNotes: nextDeliveryNotes,
      customerDeliveryMessage: nextCustomerMsg,
    });
  })
);

/* -------------------------------------------------------------------------- */
/*  6B. SUPPLIER & AUTOMATIC DELIVERY ARCHITECTURE (PHASE 4)                  */
/* -------------------------------------------------------------------------- */

adminRouter.get(
  '/suppliers',
  requirePermission('orders.read'),
  asyncHandler(async (_req: AuthenticatedRequest, res) => {
    const db = getDb();
    const rows = await db.query<{
      id: string;
      name: string;
      code: string;
      integration_type: 'manual' | 'api' | 'webhook';
      mode: 'mock' | 'live';
      api_base_url: string | null;
      api_key_env_name: string;
      is_active: boolean;
      timeout_ms: number;
      max_retries: number;
      balance_inr: string;
      supported_games_note: string;
      notes: string | null;
      mapping_count: string;
      supplier_order_count: string;
      created_at: string;
    }>(
      `SELECT
         s.id, s.name, s.code, s.integration_type, s.mode, s.api_base_url,
         s.api_key_env_name, s.is_active, s.timeout_ms, s.max_retries,
         s.balance_inr::text, s.supported_games_note, s.notes, s.created_at,
         (SELECT COUNT(*)::text FROM public.supplier_package_mappings m WHERE m.supplier_id = s.id) AS mapping_count,
         (SELECT COUNT(*)::text FROM public.supplier_orders so WHERE so.supplier_id = s.id) AS supplier_order_count
       FROM public.suppliers s
       ORDER BY s.created_at ASC`
    );

    const suppliers: AdminSupplierItem[] = rows.rows.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      integrationType: r.integration_type,
      mode: r.mode,
      apiBaseUrl: r.api_base_url,
      apiKeyEnvName: r.api_key_env_name || '',
      apiKeyConfigured: Boolean(
        r.api_key_env_name && process.env[r.api_key_env_name]?.trim()
      ),
      isActive: r.is_active,
      timeoutMs: Number(r.timeout_ms || 8000),
      maxRetries: Number(r.max_retries || 2),
      balanceInr: Number(r.balance_inr || '0'),
      supportedGamesNote: r.supported_games_note || '',
      notes: r.notes || '',
      mappingCount: Number(r.mapping_count || '0'),
      supplierOrderCount: Number(r.supplier_order_count || '0'),
      createdAt: r.created_at,
    }));

    res.json({ suppliers });
  })
);

adminRouter.post(
  '/suppliers',
  requirePermission('orders.manage'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = adminCreateSupplierSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid supplier configuration.',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const s = parsed.data;
    if (s.mode === 'live' && (!s.apiBaseUrl || !s.apiBaseUrl.startsWith('https://'))) {
      res.status(400).json({
        error: 'Live supplier mode requires a verified HTTPS API Base URL.',
        code: 'HTTPS_REQUIRED',
      });
      return;
    }

    const db = getDb();
    const clash = await db.query<{ id: string }>(
      'SELECT id FROM public.suppliers WHERE code = $1 LIMIT 1',
      [s.code]
    );
    if (clash.rows[0]) {
      res.status(409).json({ error: `Supplier code "${s.code}" already exists.`, code: 'DUPLICATE_CODE' });
      return;
    }

    const inserted = await db.query<{ id: string; name: string; code: string }>(
      `INSERT INTO public.suppliers
         (name, code, integration_type, mode, api_base_url, api_key_env_name, is_active, timeout_ms, max_retries, supported_games_note, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, name, code`,
      [
        s.name,
        s.code,
        s.integrationType,
        s.mode,
        s.apiBaseUrl || null,
        s.apiKeyEnvName,
        s.isActive,
        s.timeoutMs,
        s.maxRetries,
        s.supportedGamesNote,
        s.notes,
      ]
    );

    await writeAuditLog({
      actorProfileId: req.authUser!.profileId,
      actorRole: req.authUser!.roleCode,
      action: 'admin.supplier_created',
      resourceType: 'suppliers',
      resourceId: inserted.rows[0].id,
      req,
      details: { code: s.code, mode: s.mode },
    });

    res.status(201).json({ supplier: inserted.rows[0] });
  })
);

adminRouter.patch(
  '/suppliers/:id',
  requirePermission('orders.manage'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = adminUpdateSupplierSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid supplier update.',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const db = getDb();
    const existing = await db.query<{
      id: string;
      name: string;
      code: string;
      integration_type: 'manual' | 'api' | 'webhook';
      mode: 'mock' | 'live';
      api_base_url: string | null;
      api_key_env_name: string;
      is_active: boolean;
      timeout_ms: number;
      max_retries: number;
      supported_games_note: string;
      notes: string | null;
    }>(
      `SELECT id, name, code, integration_type, mode, api_base_url, api_key_env_name, is_active, timeout_ms, max_retries, supported_games_note, notes
       FROM public.suppliers WHERE id = $1 LIMIT 1`,
      [req.params.id]
    );
    const cur = existing.rows[0];
    if (!cur) {
      res.status(404).json({ error: 'Supplier not found.', code: 'NOT_FOUND' });
      return;
    }

    const u = parsed.data;
    const nextMode = u.mode ?? cur.mode;
    const nextUrl = u.apiBaseUrl !== undefined ? u.apiBaseUrl : cur.api_base_url;
    if (nextMode === 'live' && (!nextUrl || !nextUrl.startsWith('https://'))) {
      res.status(400).json({
        error: 'Live supplier mode requires an authorized HTTPS API Base URL.',
        code: 'HTTPS_REQUIRED',
      });
      return;
    }

    await db.query(
      `UPDATE public.suppliers
       SET name = $1,
           code = $2,
           integration_type = $3,
           mode = $4,
           api_base_url = $5,
           api_key_env_name = $6,
           is_active = $7,
           timeout_ms = $8,
           max_retries = $9,
           supported_games_note = $10,
           notes = $11
       WHERE id = $12`,
      [
        u.name ?? cur.name,
        u.code ?? cur.code,
        u.integrationType ?? cur.integration_type,
        nextMode,
        nextUrl || null,
        u.apiKeyEnvName ?? cur.api_key_env_name,
        u.isActive !== undefined ? u.isActive : cur.is_active,
        u.timeoutMs ?? cur.timeout_ms,
        u.maxRetries ?? cur.max_retries,
        u.supportedGamesNote ?? cur.supported_games_note,
        u.notes !== undefined ? u.notes : cur.notes || '',
        req.params.id,
      ]
    );

    await writeAuditLog({
      actorProfileId: req.authUser!.profileId,
      actorRole: req.authUser!.roleCode,
      action: 'admin.supplier_updated',
      resourceType: 'suppliers',
      resourceId: req.params.id,
      req,
      details: { mode: nextMode, isActive: u.isActive ?? cur.is_active },
    });

    res.json({ ok: true });
  })
);

adminRouter.delete(
  '/suppliers/:id',
  requirePermission('orders.manage'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const orderCountRes = await db.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM public.supplier_orders WHERE supplier_id = $1',
      [req.params.id]
    );
    if (Number(orderCountRes.rows[0]?.count || '0') > 0) {
      res.status(409).json({
        error: 'Cannot delete a supplier with recorded dispatch history. Disable the supplier instead.',
        code: 'SUPPLIER_HAS_ORDERS',
      });
      return;
    }

    await db.query('DELETE FROM public.suppliers WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  })
);

adminRouter.get(
  '/supplier-mappings',
  requirePermission('orders.read'),
  asyncHandler(async (_req: AuthenticatedRequest, res) => {
    const db = getDb();
    const rows = await db.query<{
      id: string;
      supplier_id: string;
      supplier_name: string;
      supplier_code: string;
      supplier_mode: 'mock' | 'live';
      package_id: string;
      package_name: string;
      package_sku: string;
      game_id: string;
      game_title: string;
      external_product_code: string;
      external_product_name: string;
      supplier_cost_inr: string;
      is_active: boolean;
      created_at: string;
    }>(
      `SELECT
         m.id, m.supplier_id, s.name AS supplier_name, s.code AS supplier_code, s.mode AS supplier_mode,
         m.package_id, p.name AS package_name, p.sku AS package_sku,
         p.game_id, g.title AS game_title,
         m.external_product_code, m.external_product_name, m.supplier_cost_inr::text, m.is_active, m.created_at
       FROM public.supplier_package_mappings m
       JOIN public.suppliers s ON s.id = m.supplier_id
       JOIN public.packages p ON p.id = m.package_id
       JOIN public.games g ON g.id = p.game_id
       ORDER BY g.title ASC, p.name ASC`
    );

    const mappings: SupplierPackageMappingItem[] = rows.rows.map((r) => ({
      id: r.id,
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      supplierCode: r.supplier_code,
      supplierMode: r.supplier_mode,
      packageId: r.package_id,
      packageName: r.package_name,
      packageSku: r.package_sku,
      gameId: r.game_id,
      gameTitle: r.game_title,
      externalProductCode: r.external_product_code,
      externalProductName: r.external_product_name || '',
      supplierCostInr: Number(r.supplier_cost_inr || '0'),
      isActive: r.is_active,
      createdAt: r.created_at,
    }));

    res.json({ mappings });
  })
);

adminRouter.post(
  '/supplier-mappings',
  requirePermission('orders.manage'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = adminUpsertSupplierMappingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid mapping.',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const m = parsed.data;
    const db = getDb();
    const upserted = await db.query<{ id: string }>(
      `INSERT INTO public.supplier_package_mappings
         (supplier_id, package_id, external_product_code, external_product_name, supplier_cost_inr, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (supplier_id, package_id) DO UPDATE
       SET external_product_code = EXCLUDED.external_product_code,
           external_product_name = EXCLUDED.external_product_name,
           supplier_cost_inr = EXCLUDED.supplier_cost_inr,
           is_active = EXCLUDED.is_active
       RETURNING id`,
      [
        m.supplierId,
        m.packageId,
        m.externalProductCode,
        m.externalProductName,
        m.supplierCostInr,
        m.isActive,
      ]
    );

    await writeAuditLog({
      actorProfileId: req.authUser!.profileId,
      actorRole: req.authUser!.roleCode,
      action: 'admin.supplier_mapping_saved',
      resourceType: 'supplier_package_mappings',
      resourceId: upserted.rows[0].id,
      req,
      details: { supplierId: m.supplierId, packageId: m.packageId, externalProductCode: m.externalProductCode },
    });

    res.status(201).json({ id: upserted.rows[0].id });
  })
);

adminRouter.delete(
  '/supplier-mappings/:id',
  requirePermission('orders.manage'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const db = getDb();
    await db.query('DELETE FROM public.supplier_package_mappings WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  })
);

adminRouter.get(
  '/supplier-orders',
  requirePermission('orders.read'),
  asyncHandler(async (_req: AuthenticatedRequest, res) => {
    const db = getDb();
    const rows = await db.query<{
      id: string;
      order_id: string;
      order_item_id: string;
      supplier_id: string;
      supplier_name: string;
      supplier_code: string;
      external_reference: string | null;
      cost_inr: string;
      status: 'pending' | 'submitted' | 'completed' | 'failed' | 'cancelled';
      is_mock: boolean;
      environment_label: string;
      attempt_count: number;
      max_attempts: number;
      error_message: string;
      request_payload: Record<string, unknown>;
      response_payload: Record<string, unknown>;
      last_checked_at: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT
         so.id, COALESCE(so.order_id, oi.order_id) AS order_id, so.order_item_id, so.supplier_id,
         s.name AS supplier_name, s.code AS supplier_code,
         so.external_reference, so.cost_inr::text, so.status, so.is_mock,
         so.environment_label, so.attempt_count, so.max_attempts,
         so.error_message, so.request_payload, so.response_payload,
         so.last_checked_at, so.created_at, so.updated_at
       FROM public.supplier_orders so
       JOIN public.order_items oi ON oi.id = so.order_item_id
       JOIN public.suppliers s ON s.id = so.supplier_id
       ORDER BY so.created_at DESC
       LIMIT 100`
    );

    const supplierOrders: SupplierOrderItem[] = rows.rows.map((s) => ({
      id: s.id,
      orderId: s.order_id,
      orderItemId: s.order_item_id,
      supplierId: s.supplier_id,
      supplierName: s.supplier_name,
      supplierCode: s.supplier_code,
      externalReference: s.external_reference,
      costInr: Number(s.cost_inr || '0'),
      status: s.status,
      isMock: s.is_mock,
      environmentLabel: s.environment_label,
      attemptCount: s.attempt_count,
      maxAttempts: s.max_attempts,
      errorMessage: s.error_message || '',
      requestPayload: s.request_payload || {},
      responsePayload: s.response_payload || {},
      lastCheckedAt: s.last_checked_at,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    }));

    res.json({ supplierOrders });
  })
);

async function executeSupplierRequest(params: {
  supplier: {
    id: string;
    name: string;
    code: string;
    mode: 'mock' | 'live';
    api_base_url: string | null;
    api_key_env_name: string;
    timeout_ms: number;
  };
  orderNumber: string;
  externalProductCode: string;
  playerUid: string;
  serverId: string | null;
  quantity: number;
}): Promise<{
  ok: boolean;
  isMock: boolean;
  environmentLabel: string;
  externalReference: string | null;
  status: 'submitted' | 'failed';
  errorMessage: string;
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
}> {
  const { supplier } = params;
  const reqPayload: Record<string, unknown> = {
    orderNumber: params.orderNumber,
    externalProductCode: params.externalProductCode,
    playerUid: params.playerUid,
    serverId: params.serverId,
    quantity: params.quantity,
  };

  if (supplier.mode === 'mock' || !supplier.api_base_url) {
    const mockRes = buildMockSupplierDispatchResult({
      orderNumber: params.orderNumber,
      supplierCode: supplier.code,
      externalProductCode: params.externalProductCode,
      playerUid: params.playerUid,
      serverId: params.serverId,
      quantity: params.quantity,
    });
    return {
      ok: true,
      isMock: true,
      environmentLabel: mockRes.environmentLabel,
      externalReference: mockRes.externalReference,
      status: 'submitted',
      errorMessage: '',
      requestPayload: reqPayload,
      responsePayload: mockRes.payload,
    };
  }

  const endpointCheck = await assertPublicSupplierEndpoint(supplier.api_base_url);
  if (!endpointCheck.ok) {
    return {
      ok: false,
      isMock: false,
      environmentLabel: 'LIVE SUPPLIER API',
      externalReference: null,
      status: 'failed',
      errorMessage: endpointCheck.error,
      requestPayload: reqPayload,
      responsePayload: { error: 'RESTRICTED_SUPPLIER_ENDPOINT' },
    };
  }

  // Live HTTPS API mode with AbortController timeout and server-side env credential
  const apiKey = supplier.api_key_env_name
    ? process.env[supplier.api_key_env_name]?.trim() || ''
    : '';
  if (!apiKey) {
    return {
      ok: false,
      isMock: false,
      environmentLabel: 'LIVE SUPPLIER API',
      externalReference: null,
      status: 'failed',
      errorMessage: 'Missing server credential for selected live supplier.',
      requestPayload: reqPayload,
      responsePayload: { error: 'CREDENTIALS_MISSING' },
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), supplier.timeout_ms || 8000);
  try {
    const resp = await fetch(`${endpointCheck.url}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(reqPayload),
      redirect: 'error',
      signal: controller.signal,
    });
    const body = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (!resp.ok) {
      return {
        ok: false,
        isMock: false,
        environmentLabel: 'LIVE SUPPLIER API',
        externalReference: null,
        status: 'failed',
        errorMessage: `Supplier API returned HTTP ${resp.status}.`,
        requestPayload: reqPayload,
        responsePayload: { status: resp.status },
      };
    }
    return {
      ok: true,
      isMock: false,
      environmentLabel: 'LIVE SUPPLIER API',
      externalReference: typeof body.reference === 'string' ? body.reference : null,
      status: 'submitted',
      errorMessage: '',
      requestPayload: reqPayload,
      responsePayload: body,
    };
  } catch (err) {
    console.error('Live supplier API request error:', {
      supplierCode: supplier.code,
      error: err instanceof Error ? err.message : String(err),
    });
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const message = isAbort
      ? `Supplier API timed out after ${supplier.timeout_ms}ms.`
      : 'Supplier API connection failed.';
    return {
      ok: false,
      isMock: false,
      environmentLabel: 'LIVE SUPPLIER API',
      externalReference: null,
      status: 'failed',
      errorMessage: message,
      requestPayload: reqPayload,
      responsePayload: { error: isAbort ? 'SUPPLIER_TIMEOUT' : 'SUPPLIER_NETWORK_ERROR' },
    };
  } finally {
    clearTimeout(timer);
  }
}

adminRouter.post(
  '/orders/:id/dispatch-supplier',
  requirePermission('orders.manage'),
  adminDispatchRateLimiter,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = adminDispatchSupplierSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid supplier dispatch payload.', code: 'VALIDATION_ERROR' });
      return;
    }

    const db = getDb();
    const orderRowRes = await db.query<{
      order_id: string;
      order_number: string;
      order_status: string;
      delivery_method: 'manual' | 'automatic' | 'both';
      order_item_id: string;
      package_id: string;
      package_sku: string;
      package_supplier_id: string | null;
      package_supplier_code: string;
      package_supplier_cost: string;
      game_default_supplier_id: string | null;
      quantity: number;
      target_player_uid: string;
      target_server_id: string | null;
    }>(
      `SELECT
         o.id AS order_id, o.order_number, o.status AS order_status, o.delivery_method,
         oi.id AS order_item_id, oi.package_id, pkg.sku AS package_sku,
         pkg.supplier_id AS package_supplier_id, pkg.supplier_product_code AS package_supplier_code,
         pkg.supplier_cost_inr::text AS package_supplier_cost,
         g.default_supplier_id AS game_default_supplier_id,
         oi.quantity, oi.target_player_uid, oi.target_server_id
       FROM public.orders o
       JOIN public.order_items oi ON oi.order_id = o.id
       JOIN public.packages pkg ON pkg.id = oi.package_id
       JOIN public.games g ON g.id = oi.game_id
       WHERE o.id = $1
       LIMIT 1`,
      [req.params.id]
    );
    const ord = orderRowRes.rows[0];
    if (!ord) {
      res.status(404).json({ error: 'Order not found.', code: 'NOT_FOUND' });
      return;
    }

    // Duplicate supplier order protection
    const existingActive = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM public.supplier_orders
       WHERE order_item_id = $1 AND status IN ('pending', 'submitted', 'completed')
       LIMIT 1`,
      [ord.order_item_id]
    );
    if (existingActive.rows[0]) {
      res.status(409).json({
        error: `A supplier order already exists (${existingActive.rows[0].status}) for this order item. Duplicate supplier dispatch blocked.`,
        code: 'DUPLICATE_SUPPLIER_ORDER',
      });
      return;
    }

    // Resolve supplier
    let targetSupplierId =
      parsed.data.supplierId || ord.package_supplier_id || ord.game_default_supplier_id;
    if (!targetSupplierId) {
      const fallbackSup = await db.query<{ id: string }>(
        `SELECT id FROM public.suppliers WHERE is_active = TRUE ORDER BY CASE WHEN integration_type = 'api' THEN 0 ELSE 1 END, created_at ASC LIMIT 1`
      );
      targetSupplierId = fallbackSup.rows[0]?.id ?? null;
    }

    if (!targetSupplierId) {
      res.status(400).json({ error: 'No active supplier configured.', code: 'NO_SUPPLIER' });
      return;
    }

    const supRes = await db.query<{
      id: string;
      name: string;
      code: string;
      mode: 'mock' | 'live';
      api_base_url: string | null;
      api_key_env_name: string;
      is_active: boolean;
      timeout_ms: number;
      max_retries: number;
    }>(
      `SELECT id, name, code, mode, api_base_url, api_key_env_name, is_active, timeout_ms, max_retries
       FROM public.suppliers WHERE id = $1 LIMIT 1`,
      [targetSupplierId]
    );
    const supplier = supRes.rows[0];
    if (!supplier || !supplier.is_active) {
      res.status(400).json({ error: 'Selected supplier is disabled or missing.', code: 'SUPPLIER_INACTIVE' });
      return;
    }

    const mappingRes = await db.query<{
      external_product_code: string;
      supplier_cost_inr: string;
    }>(
      `SELECT external_product_code, supplier_cost_inr::text
       FROM public.supplier_package_mappings
       WHERE supplier_id = $1 AND package_id = $2 AND is_active = TRUE
       LIMIT 1`,
      [supplier.id, ord.package_id]
    );

    const externalProductCode =
      mappingRes.rows[0]?.external_product_code ||
      ord.package_supplier_code ||
      ord.package_sku;
    const costInr = mappingRes.rows[0]
      ? Number(mappingRes.rows[0].supplier_cost_inr || '0')
      : Number(ord.package_supplier_cost || '0');

    const dispatchResult = await executeSupplierRequest({
      supplier,
      orderNumber: ord.order_number,
      externalProductCode,
      playerUid: ord.target_player_uid,
      serverId: ord.target_server_id,
      quantity: ord.quantity,
    });

    const idempotencyKey = `sup-${ord.order_item_id}-${Date.now()}`;
    const maxAttempts = (supplier.max_retries || 0) + 1;

    const createdSupOrder = await db.withTransaction(async (tx) => {
      const ins = await tx.query<{ id: string }>(
        `INSERT INTO public.supplier_orders
           (order_id, order_item_id, supplier_id, idempotency_key, external_reference, cost_inr, status,
            is_mock, environment_label, attempt_count, max_attempts, request_payload, response_payload, error_message, last_checked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10, $11::jsonb, $12::jsonb, $13, NOW())
         RETURNING id`,
        [
          ord.order_id,
          ord.order_item_id,
          supplier.id,
          idempotencyKey,
          dispatchResult.externalReference,
          costInr,
          dispatchResult.status,
          dispatchResult.isMock,
          dispatchResult.environmentLabel,
          maxAttempts,
          JSON.stringify(dispatchResult.requestPayload),
          JSON.stringify(dispatchResult.responsePayload),
          dispatchResult.errorMessage,
        ]
      );

      // Update order status to awaiting_delivery / processing cleanly (NEVER auto-completed in mock mode!)
      const nextOrderStatus = dispatchResult.ok ? 'awaiting_delivery' : 'processing';
      const nextFulfillment = dispatchResult.ok ? 'awaiting_delivery' : 'failed';

      await tx.query(
        `UPDATE public.orders
         SET status = CASE WHEN status IN ('pending', 'payment_pending', 'awaiting_payment', 'processing') THEN $1 ELSE status END,
             processing_started_at = COALESCE(processing_started_at, NOW())
         WHERE id = $2`,
        [nextOrderStatus, ord.order_id]
      );

      await tx.query(
        `UPDATE public.order_items SET fulfillment_status = $1 WHERE id = $2`,
        [nextFulfillment, ord.order_item_id]
      );

      await tx.query(
        `INSERT INTO public.order_delivery_logs
           (order_id, actor_profile_id, actor_label, event_type, previous_status, next_status, delivery_method, is_mock, message)
         VALUES ($1, $2, $3, 'supplier_dispatch', $4, $5, $6, $7, $8)`,
        [
          ord.order_id,
          req.authUser!.profileId,
          req.authUser!.fullName || req.authUser!.email,
          ord.order_status,
          nextOrderStatus,
          ord.delivery_method,
          dispatchResult.isMock,
          dispatchResult.isMock
            ? `TEST ONLY (MOCK MODE): Simulated dispatch to ${supplier.name} (${externalProductCode}). Reference: ${dispatchResult.externalReference}.`
            : dispatchResult.ok
              ? `Dispatched to ${supplier.name}. Reference: ${dispatchResult.externalReference}.`
              : `Supplier dispatch failed (${supplier.name}): ${dispatchResult.errorMessage}`,
        ]
      );

      return ins.rows[0].id;
    });

    await writeAuditLog({
      actorProfileId: req.authUser!.profileId,
      actorRole: req.authUser!.roleCode,
      action: 'admin.supplier_order_dispatched',
      resourceType: 'supplier_orders',
      resourceId: createdSupOrder,
      req,
      details: {
        orderId: ord.order_id,
        supplierCode: supplier.code,
        isMock: dispatchResult.isMock,
        status: dispatchResult.status,
      },
    });

    res.status(dispatchResult.ok ? 201 : 502).json({
      supplierOrderId: createdSupOrder,
      isMock: dispatchResult.isMock,
      environmentLabel: dispatchResult.environmentLabel,
      status: dispatchResult.status,
      error: dispatchResult.errorMessage || undefined,
    });
  })
);

adminRouter.post(
  '/supplier-orders/:id/check-status',
  requirePermission('orders.manage'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const rowRes = await db.query<{
      id: string;
      order_id: string | null;
      status: string;
      is_mock: boolean;
      environment_label: string;
      external_reference: string | null;
    }>(
      `SELECT id, order_id, status, is_mock, environment_label, external_reference
       FROM public.supplier_orders WHERE id = $1 LIMIT 1`,
      [req.params.id]
    );
    const cur = rowRes.rows[0];
    if (!cur) {
      res.status(404).json({ error: 'Supplier order not found.', code: 'NOT_FOUND' });
      return;
    }

    await db.query(
      `UPDATE public.supplier_orders
       SET last_checked_at = NOW(),
           response_payload = response_payload || $1::jsonb
       WHERE id = $2`,
      [
        JSON.stringify({
          lastCheckedAt: new Date().toISOString(),
          checkNotice: cur.is_mock
            ? 'TEST ONLY (MOCK MODE): Status check is simulated. Order requires manual admin completion or live API confirmation.'
            : 'Supplier status polled.',
        }),
        cur.id,
      ]
    );

    if (cur.order_id) {
      await db.query(
        `INSERT INTO public.order_delivery_logs
           (order_id, actor_profile_id, actor_label, event_type, is_mock, message)
         VALUES ($1, $2, $3, 'supplier_status_check', $4, $5)`,
        [
          cur.order_id,
          req.authUser!.profileId,
          req.authUser!.fullName || req.authUser!.email,
          cur.is_mock,
          cur.is_mock
            ? `TEST ONLY (MOCK MODE): Checked mock supplier ref ${cur.external_reference || cur.id}. Still awaiting real fulfillment.`
            : `Checked supplier status for ${cur.external_reference || cur.id}.`,
        ]
      );
    }

    res.json({
      ok: true,
      isMock: cur.is_mock,
      environmentLabel: cur.environment_label,
      status: cur.status,
      notice: cur.is_mock
        ? 'TEST ONLY (MOCK MODE): Simulated status remains pending real verification.'
        : 'Status checked.',
    });
  })
);

adminRouter.post(
  '/supplier-orders/:id/retry',
  requirePermission('orders.manage'),
  adminDispatchRateLimiter,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const rowRes = await db.query<{
      id: string;
      order_id: string | null;
      order_item_id: string;
      supplier_id: string;
      status: string;
      attempt_count: number;
      max_attempts: number;
      request_payload: Record<string, unknown>;
    }>(
      `SELECT id, order_id, order_item_id, supplier_id, status, attempt_count, max_attempts, request_payload
       FROM public.supplier_orders WHERE id = $1 LIMIT 1`,
      [req.params.id]
    );
    const cur = rowRes.rows[0];
    if (!cur) {
      res.status(404).json({ error: 'Supplier order not found.', code: 'NOT_FOUND' });
      return;
    }

    const eligibility = evaluateSupplierRetryEligibility({
      status: cur.status,
      attemptCount: cur.attempt_count,
      maxAttempts: cur.max_attempts,
    });
    if (!eligibility.eligible) {
      res.status(400).json({ error: eligibility.reason, code: 'RETRY_BLOCKED' });
      return;
    }

    const supRes = await db.query<{
      id: string;
      name: string;
      code: string;
      mode: 'mock' | 'live';
      api_base_url: string | null;
      api_key_env_name: string;
      timeout_ms: number;
    }>(
      'SELECT id, name, code, mode, api_base_url, api_key_env_name, timeout_ms FROM public.suppliers WHERE id = $1 LIMIT 1',
      [cur.supplier_id]
    );
    const supplier = supRes.rows[0];
    if (!supplier) {
      res.status(404).json({ error: 'Supplier missing.', code: 'NOT_FOUND' });
      return;
    }

    const rp = cur.request_payload || {};
    const dispatchResult = await executeSupplierRequest({
      supplier,
      orderNumber: String(rp.orderNumber || cur.order_id || cur.id),
      externalProductCode: String(rp.externalProductCode || 'SKU'),
      playerUid: String(rp.playerUid || ''),
      serverId: rp.serverId ? String(rp.serverId) : null,
      quantity: Number(rp.quantity || 1),
    });

    await db.query(
      `UPDATE public.supplier_orders
       SET attempt_count = attempt_count + 1,
           status = $1,
           is_mock = $2,
           environment_label = $3,
           external_reference = COALESCE($4, external_reference),
           response_payload = $5::jsonb,
           error_message = $6,
           last_checked_at = NOW()
       WHERE id = $7`,
      [
        dispatchResult.status,
        dispatchResult.isMock,
        dispatchResult.environmentLabel,
        dispatchResult.externalReference,
        JSON.stringify(dispatchResult.responsePayload),
        dispatchResult.errorMessage,
        cur.id,
      ]
    );

    if (cur.order_id) {
      await db.query(
        `INSERT INTO public.order_delivery_logs
           (order_id, actor_profile_id, actor_label, event_type, is_mock, message)
         VALUES ($1, $2, $3, 'supplier_retry', $4, $5)`,
        [
          cur.order_id,
          req.authUser!.profileId,
          req.authUser!.fullName || req.authUser!.email,
          dispatchResult.isMock,
          `Retry attempt #${cur.attempt_count + 1}: ${
            dispatchResult.ok
              ? `${dispatchResult.environmentLabel} submitted (${dispatchResult.externalReference})`
              : dispatchResult.errorMessage
          }`,
        ]
      );
    }

    res.json({
      ok: dispatchResult.ok,
      attemptCount: cur.attempt_count + 1,
      status: dispatchResult.status,
      isMock: dispatchResult.isMock,
      environmentLabel: dispatchResult.environmentLabel,
      error: dispatchResult.errorMessage || undefined,
    });
  })
);

/* -------------------------------------------------------------------------- */
/*  7. CUSTOMERS DIRECTORY                                                    */
/* -------------------------------------------------------------------------- */

adminRouter.get(
  '/customers',
  requirePermission('orders.read'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsedQuery = adminFilterQuerySchema.safeParse({
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
    });
    if (!parsedQuery.success) {
      res.status(400).json({ error: 'Invalid filter query parameters.', code: 'VALIDATION_ERROR' });
      return;
    }
    const search = parsedQuery.data.search.toLowerCase();
    const db = getDb();
    const rows = await db.query<{
      id: string;
      profile_id: string;
      customer_code: string;
      full_name: string;
      email: string;
      phone: string | null;
      account_status: string;
      risk_flag: string;
      default_currency_code: string;
      total_orders: number;
      created_at: string;
    }>(
      `SELECT
         c.id, c.profile_id, c.customer_code, p.full_name, p.email, p.phone,
         p.account_status, c.risk_flag, c.default_currency_code, c.total_orders, c.created_at
       FROM public.customers c
       JOIN public.profiles p ON p.id = c.profile_id
       ORDER BY c.created_at DESC
       LIMIT 200`
    );

    const customers: AdminCustomerItem[] = rows.rows
      .map((r) => ({
        id: r.id,
        profileId: r.profile_id,
        customerCode: r.customer_code,
        fullName: r.full_name,
        email: r.email,
        phone: r.phone,
        accountStatus: r.account_status,
        riskFlag: r.risk_flag,
        defaultCurrencyCode: r.default_currency_code,
        totalOrders: Number(r.total_orders || 0),
        createdAt: r.created_at,
      }))
      .filter((c) => {
        if (!search) return true;
        return `${c.fullName} ${c.email} ${c.customerCode}`.toLowerCase().includes(search);
      });

    res.json({ customers });
  })
);

/* -------------------------------------------------------------------------- */
/*  8. WEBSITE SETTINGS & PHASE 1 RAZORPAY GATEWAY READINESS                  */
/* -------------------------------------------------------------------------- */

adminRouter.get(
  '/website-settings',
  requirePermission('admin.settings.read'),
  asyncHandler(async (_req: AuthenticatedRequest, res) => {
    const db = getDb();
    const row = await db.query<{ setting_value: unknown }>(
      `SELECT setting_value FROM public.website_settings WHERE setting_key = 'storefront_identity' LIMIT 1`
    );
    res.json({
      settings: mergeStorefrontIdentity(row.rows[0]?.setting_value),
    });
  })
);

adminRouter.patch(
  '/website-settings',
  requirePermission('admin.settings.write'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = adminUpdateWebsiteSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid website settings payload.',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const db = getDb();
    const adminRow = await db.query<{ id: string }>(
      'SELECT id FROM public.admin_users WHERE profile_id = $1 LIMIT 1',
      [req.authUser!.profileId]
    );

    const nextValue = {
      ...parsed.data,
      razorpayPrimaryGateway: true,
    };

    await db.query(
      `INSERT INTO public.website_settings (setting_key, setting_value, is_public, updated_by_admin_id)
       VALUES ('storefront_identity', $1::jsonb, TRUE, $2)
       ON CONFLICT (setting_key) DO UPDATE
       SET setting_value = EXCLUDED.setting_value,
           is_public = TRUE,
           updated_by_admin_id = EXCLUDED.updated_by_admin_id`,
      [JSON.stringify(nextValue), adminRow.rows[0]?.id || null]
    );

    await writeAuditLog({
      actorProfileId: req.authUser!.profileId,
      actorRole: req.authUser!.roleCode,
      action: 'admin.website_settings_updated',
      resourceType: 'website_settings',
      resourceId: 'storefront_identity',
      req,
      details: {
        storeName: parsed.data.storeName,
        announcementEnabled: parsed.data.announcementEnabled,
      },
    });

    res.json({ settings: mergeStorefrontIdentity(nextValue) });
  })
);

adminRouter.get(
  '/settings',
  requirePermission('admin.settings.read'),
  asyncHandler(async (_req: AuthenticatedRequest, res) => {
    const { paymentMode, checklistMap } = await getStoredPaymentSettings();
    const envReadiness = getEnvReadinessSummary();
    const checklist = buildChecklistState(checklistMap, envReadiness);
    const liveEval = evaluateLiveModeEligibility(checklist, envReadiness);

    const payload: AdminSettingsResponse = {
      paymentMode,
      envReadiness,
      checklist,
      liveModeEligible: liveEval.eligible,
      liveModeBlockers: liveEval.blockers,
    };

    res.json(payload);
  })
);

adminRouter.patch(
  '/settings/checklist',
  requirePermission('admin.settings.write'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = checklistUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid checklist update.',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const { key, status, note } = parsed.data;
    const def = RAZORPAY_CHECKLIST_DEFINITIONS.find((d) => d.key === key);
    if (!def) {
      res.status(404).json({ error: 'Checklist step not found.', code: 'NOT_FOUND' });
      return;
    }

    const envReadiness = getEnvReadinessSummary();

    if (status === 'completed') {
      if (
        key === 'test_api_keys_configured' &&
        (envReadiness.razorpayKeyType !== 'test' || !envReadiness.razorpayKeySecretConfigured)
      ) {
        res.status(400).json({
          error:
            'Cannot mark Test API keys configured as Completed until RAZORPAY_KEY_ID (rzp_test_*) and RAZORPAY_KEY_SECRET are set in server secrets.',
          code: 'MISSING_TEST_KEYS',
        });
        return;
      }

      if (key === 'webhook_configured' && !envReadiness.razorpayWebhookSecretConfigured) {
        res.status(400).json({
          error:
            'Cannot mark Webhook configured as Completed until RAZORPAY_WEBHOOK_SECRET is set in server secrets.',
          code: 'MISSING_WEBHOOK_SECRET',
        });
        return;
      }

      if (
        key === 'live_api_credentials_configured' &&
        (envReadiness.razorpayKeyType !== 'live' || !envReadiness.razorpayKeySecretConfigured)
      ) {
        res.status(400).json({
          error:
            'Cannot mark Live API credentials configured as Completed until RAZORPAY_KEY_ID (rzp_live_*) and RAZORPAY_KEY_SECRET are set in server secrets.',
          code: 'MISSING_LIVE_KEYS',
        });
        return;
      }
    }

    const db = getDb();
    const { checklistMap } = await getStoredPaymentSettings();
    const adminRow = await db.query<{ id: string }>(
      'SELECT id FROM public.admin_users WHERE profile_id = $1 LIMIT 1',
      [req.authUser!.profileId]
    );

    const updatedMap: StoredChecklistMap = {
      ...checklistMap,
      [key]: {
        status,
        updatedAt: new Date().toISOString(),
        note: note ?? checklistMap[key]?.note ?? '',
      },
    };

    await db.query(
      `INSERT INTO public.website_settings (setting_key, setting_value, is_public, updated_by_admin_id)
       VALUES ('razorpay_readiness_checklist', $1::jsonb, FALSE, $2)
       ON CONFLICT (setting_key) DO UPDATE
       SET setting_value = EXCLUDED.setting_value,
           updated_by_admin_id = EXCLUDED.updated_by_admin_id`,
      [JSON.stringify(updatedMap), adminRow.rows[0]?.id || null]
    );

    await writeAuditLog({
      actorProfileId: req.authUser!.profileId,
      actorRole: req.authUser!.roleCode,
      action: 'admin.razorpay_checklist_updated',
      resourceType: 'website_settings',
      resourceId: key,
      req,
      details: { key, status },
    });

    const checklist = buildChecklistState(updatedMap, envReadiness);
    const liveEval = evaluateLiveModeEligibility(checklist, envReadiness);

    res.json({
      checklist,
      liveModeEligible: liveEval.eligible,
      liveModeBlockers: liveEval.blockers,
    });
  })
);

adminRouter.patch(
  '/settings/payment-mode',
  requirePermission('admin.settings.write'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = paymentModeUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid payment mode.',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    if (!req.authUser?.isOwner) {
      res.status(403).json({
        error: 'Only the designated Store Owner may change the active payment mode.',
        code: 'OWNER_ONLY',
      });
      return;
    }

    const targetMode = parsed.data.mode;
    const envReadiness = getEnvReadinessSummary();
    const { checklistMap } = await getStoredPaymentSettings();
    const checklist = buildChecklistState(checklistMap, envReadiness);
    const liveEval = evaluateLiveModeEligibility(checklist, envReadiness);

    if (targetMode === 'live' && !liveEval.eligible) {
      await writeAuditLog({
        actorProfileId: req.authUser.profileId,
        actorRole: req.authUser.roleCode,
        action: 'admin.live_mode_blocked',
        resourceType: 'website_settings',
        resourceId: 'payment_mode',
        req,
        details: { blockers: liveEval.blockers },
      });

      res.status(400).json({
        error: 'Live mode cannot be enabled until all readiness requirements are verified.',
        code: 'LIVE_MODE_BLOCKED',
        blockers: liveEval.blockers,
      });
      return;
    }

    const db = getDb();
    const adminRow = await db.query<{ id: string }>(
      'SELECT id FROM public.admin_users WHERE profile_id = $1 LIMIT 1',
      [req.authUser.profileId]
    );

    await db.query(
      `INSERT INTO public.website_settings (setting_key, setting_value, is_public, updated_by_admin_id)
       VALUES ('payment_mode', $1::jsonb, FALSE, $2)
       ON CONFLICT (setting_key) DO UPDATE
       SET setting_value = EXCLUDED.setting_value,
           updated_by_admin_id = EXCLUDED.updated_by_admin_id`,
      [JSON.stringify({ mode: targetMode }), adminRow.rows[0]?.id || null]
    );

    await writeAuditLog({
      actorProfileId: req.authUser.profileId,
      actorRole: req.authUser.roleCode,
      action: 'admin.payment_mode_updated',
      resourceType: 'website_settings',
      resourceId: 'payment_mode',
      req,
      details: { mode: targetMode },
    });

    res.json({ paymentMode: targetMode });
  })
);

/* -------------------------------------------------------------------------- */
/*  9. ADMIN PROFILE & AUDIT LOGS                                             */
/* -------------------------------------------------------------------------- */

adminRouter.get(
  '/profile',
  requirePermission('admin.overview.read'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const [row, logs] = await Promise.all([
      db.query<{
        profile_id: string;
        email: string;
        full_name: string;
        phone: string | null;
        role_code: string;
        role_name: string;
        is_owner: boolean;
        created_at: string;
        last_login_at: string | null;
      }>(
        `SELECT
           p.id AS profile_id, p.email, p.full_name, p.phone,
           r.code AS role_code, r.name AS role_name, au.is_owner,
           p.created_at, p.last_login_at
         FROM public.profiles p
         JOIN public.admin_users au ON au.profile_id = p.id
         JOIN public.roles r ON r.id = au.role_id
         WHERE p.id = $1
         LIMIT 1`,
        [req.authUser!.profileId]
      ),
      db.query<AuditLogRecord>(
        `SELECT id, actor_profile_id, actor_role, action, resource_type, resource_id, ip_address, details, created_at
         FROM public.audit_logs
         WHERE actor_profile_id = $1
         ORDER BY created_at DESC
         LIMIT 15`,
        [req.authUser!.profileId]
      ),
    ]);

    const item = row.rows[0];
    if (!item) {
      res.status(404).json({ error: 'Admin profile not found.', code: 'NOT_FOUND' });
      return;
    }

    const payload: AdminProfileResponse = {
      profile: {
        profileId: item.profile_id,
        email: item.email,
        fullName: item.full_name,
        phone: item.phone,
        roleCode: item.role_code,
        roleName: item.role_name,
        isOwner: item.is_owner,
        createdAt: item.created_at,
        lastLoginAt: item.last_login_at,
      },
      recentActions: logs.rows,
    };

    res.json(payload);
  })
);

adminRouter.patch(
  '/profile',
  requirePermission('admin.overview.read'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = updateCustomerProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid profile update.',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const db = getDb();
    await db.query('UPDATE public.profiles SET full_name = $1, phone = $2 WHERE id = $3', [
      parsed.data.fullName,
      parsed.data.phone ?? null,
      req.authUser!.profileId,
    ]);

    await writeAuditLog({
      actorProfileId: req.authUser!.profileId,
      actorRole: req.authUser!.roleCode,
      action: 'admin.profile_updated',
      resourceType: 'profiles',
      resourceId: req.authUser!.profileId,
      req,
      details: { fullName: parsed.data.fullName },
    });

    res.json({
      ok: true,
      fullName: parsed.data.fullName,
      phone: parsed.data.phone ?? null,
    });
  })
);

adminRouter.get(
  '/audit-logs',
  requirePermission('admin.audit.read'),
  asyncHandler(async (_req: AuthenticatedRequest, res) => {
    const db = getDb();
    const rows = await db.query<AuditLogRecord>(
      `SELECT id, actor_profile_id, actor_role, action, resource_type, resource_id, ip_address, details, created_at
       FROM public.audit_logs
       ORDER BY created_at DESC
       LIMIT 50`
    );
    res.json({ logs: rows.rows });
  })
);
