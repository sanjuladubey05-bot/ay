import crypto from 'node:crypto';
import { Router } from 'express';
import {
  asyncHandler,
  createFailedCheckoutRateLimiter,
  createRateLimiter,
  requireAuth,
  type AuthenticatedRequest,
} from '../authentication/middleware';
import { getDb } from '../database/pool';
import type {
  CustomerOrderItemView,
  CustomerProfileResponse,
  PlaceOrderResponse,
  StoreGameDetailResponse,
  StoreGamesListResponse,
} from '../types/api';
import type { PlayerFieldDefinition } from '../types/database';
import { convertInrToPaise } from '../utilities/paymentMath';
import {
  mapPhase4DeliveryStatusLabel,
  mapPhase4OrderStatusLabel,
  mapPhase4PaymentStatusLabel,
  resolveOrderDeliveryMethod,
} from '../utilities/orderDelivery';
import { sanitizeAndValidatePlayerFields } from '../utilities/playerFields';
import {
  contactInquirySchema,
  placePendingOrderSchema,
  storeGamesQuerySchema,
  updateCustomerProfileSchema,
} from '../utilities/validation';

export const storeRouter = Router();

const contactRateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  maxRequests: 10,
  keyPrefix: 'contact',
});

const orderRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 15,
  keyPrefix: 'place_order',
});

const failedCheckoutLimiter = createFailedCheckoutRateLimiter({
  windowMs: 60 * 1000,
  maxFailures: 5,
  keyPrefix: 'failed_checkout_place',
});

const profileRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 20,
  keyPrefix: 'profile_update',
});

storeRouter.get('/store/health', asyncHandler(async (_req, res) => {
  try {
    const db = getDb();
    await db.query('SELECT 1 AS ok');
    res.json({
      ok: true,
      service: 'lps-store',
      phase: 2,
      databaseConnected: true,
    });
  } catch {
    res.status(503).json({
      ok: false,
      service: 'lps-store',
      phase: 2,
      databaseConnected: false,
    });
  }
}));

storeRouter.get('/store/foundation', asyncHandler(async (_req, res) => {
  const db = getDb();
  const data = await db.withUserRlsContext(null, async (tx) => {
    const settingsRes = await tx.query<{ setting_key: string; setting_value: unknown }>(
      `SELECT setting_key, setting_value
       FROM public.website_settings
       WHERE is_public = TRUE`
    );
    const currenciesRes = await tx.query<{ code: string; name: string; symbol: string }>(
      `SELECT code, name, symbol
       FROM public.currencies
       WHERE is_active = TRUE AND currency_kind = 'settlement'
       ORDER BY is_base DESC, code ASC`
    );
    const gamesCountRes = await tx.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM public.games WHERE is_active = TRUE'
    );

    return {
      publicSettings: Object.fromEntries(
        settingsRes.rows.map((r) => [r.setting_key, r.setting_value])
      ),
      currencies: currenciesRes.rows,
      activeGamesCount: Number(gamesCountRes.rows[0]?.count || '0'),
    };
  });

  res.json(data);
}));

storeRouter.get('/store/games', asyncHandler(async (req, res) => {
  const parsedQuery = storeGamesQuerySchema.safeParse({
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    category: typeof req.query.category === 'string' ? req.query.category : undefined,
    featured: typeof req.query.featured === 'string' ? req.query.featured : undefined,
  });
  if (!parsedQuery.success) {
    res.status(400).json({ error: 'Invalid store filter query.', code: 'VALIDATION_ERROR' });
    return;
  }
  const search = parsedQuery.data.search.toLowerCase();
  const category = parsedQuery.data.category;
  const featuredOnly = parsedQuery.data.featured === 'true';

  const db = getDb();
  const data = await db.withUserRlsContext(null, async (tx) => {
    interface GameListRow {
      id: string;
      slug: string;
      title: string;
      publisher: string;
      category: string;
      description: string;
      cover_image_url: string | null;
      media_url: string | null;
      delivery_mode: 'manual' | 'automatic' | 'hybrid';
      is_featured: boolean;
      package_count: string;
      starting_price_inr: string | null;
    }

    const rows = await tx.query<GameListRow>(
      `SELECT
         g.id,
         g.slug,
         g.title,
         g.publisher,
         g.category,
         g.description,
         g.cover_image_url,
         m.public_url AS media_url,
         g.delivery_mode,
         g.is_featured,
         COUNT(p.id) FILTER (WHERE p.is_active = TRUE)::text AS package_count,
         MIN(p.price_inr) FILTER (WHERE p.is_active = TRUE)::text AS starting_price_inr
       FROM public.games g
       LEFT JOIN public.uploaded_media m ON m.id = g.cover_media_id
       LEFT JOIN public.packages p ON p.game_id = g.id
       WHERE g.is_active = TRUE
       GROUP BY g.id, m.public_url
       ORDER BY g.sort_order ASC, g.created_at DESC`
    );

    const categoriesSet = new Set<string>();
    const allGames = rows.rows.map((r) => {
      if (r.category) categoriesSet.add(r.category);
      return {
        id: r.id,
        slug: r.slug,
        title: r.title,
        publisher: r.publisher,
        category: r.category,
        description: r.description,
        coverImageUrl: r.cover_image_url || r.media_url || null,
        deliveryMode: r.delivery_mode,
        isFeatured: r.is_featured,
        packageCount: Number(r.package_count || '0'),
        startingPriceInr: r.starting_price_inr ? Number(r.starting_price_inr) : null,
      };
    });

    const filtered = allGames.filter((g) => {
      if (featuredOnly && !g.isFeatured) return false;
      if (category && category !== 'all' && g.category.toLowerCase() !== category.toLowerCase()) {
        return false;
      }
      if (search) {
        const hay = `${g.title} ${g.publisher} ${g.category} ${g.description}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    return {
      games: filtered,
      categories: Array.from(categoriesSet).sort(),
    } satisfies StoreGamesListResponse;
  });

  res.json(data);
}));

storeRouter.get('/store/games/:slug', asyncHandler(async (req, res) => {
  const slug = (req.params.slug || '').trim().toLowerCase();
  if (!slug) {
    res.status(400).json({ error: 'Game slug is required.', code: 'VALIDATION_ERROR' });
    return;
  }

  const db = getDb();
  const detail = await db.withUserRlsContext(null, async (tx) => {
    const gameRes = await tx.query<{
      id: string;
      slug: string;
      title: string;
      publisher: string;
      category: string;
      description: string;
      cover_image_url: string | null;
      media_url: string | null;
      delivery_mode: 'manual' | 'automatic' | 'hybrid';
      player_fields: PlayerFieldDefinition[] | null;
    }>(
      `SELECT
         g.id, g.slug, g.title, g.publisher, g.category, g.description,
         g.cover_image_url, m.public_url AS media_url, g.delivery_mode, g.player_fields
       FROM public.games g
       LEFT JOIN public.uploaded_media m ON m.id = g.cover_media_id
       WHERE g.slug = $1 AND g.is_active = TRUE
       LIMIT 1`,
      [slug]
    );

    const game = gameRes.rows[0];
    if (!game) return null;

    const regionsRes = await tx.query<{
      id: string;
      region_code: string;
      region_name: string;
      server_hint: string | null;
    }>(
      `SELECT id, region_code, region_name, server_hint
       FROM public.game_regions
       WHERE game_id = $1 AND is_active = TRUE
       ORDER BY region_name ASC`,
      [game.id]
    );

    const gameCurrenciesRes = await tx.query<{
      id: string;
      code: string;
      name: string;
      description: string;
      image_url: string | null;
      media_url: string | null;
    }>(
      `SELECT gc.id, gc.code, gc.name, gc.description, gc.image_url, m.public_url AS media_url
       FROM public.currencies gc
       LEFT JOIN public.uploaded_media m ON m.id = gc.media_id
       WHERE gc.currency_kind = 'in_game'
         AND gc.is_active = TRUE
         AND (gc.game_id = $1 OR gc.game_id IS NULL)
       ORDER BY CASE WHEN gc.game_id = $1 THEN 0 ELSE 1 END, gc.sort_order ASC, gc.name ASC`,
      [game.id]
    );

    const packagesRes = await tx.query<{
      id: string;
      sku: string;
      name: string;
      in_game_amount: string;
      in_game_unit: string;
      price_inr: string;
      original_price_inr: string | null;
      discount_percent: string;
      bonus_badge: string | null;
      description: string;
      is_featured: boolean;
      currency_code: string;
      currency_symbol: string;
      game_currency_id: string | null;
      game_currency_name: string | null;
      game_currency_image_url: string | null;
      game_currency_active: boolean | null;
      region_id: string | null;
      image_url: string | null;
      media_url: string | null;
      delivery_type: 'manual' | 'automatic' | 'both';
    }>(
      `SELECT
         p.id, p.sku, p.name, p.in_game_amount::text, p.in_game_unit,
         p.price_inr::text, p.original_price_inr::text, p.discount_percent::text,
         p.bonus_badge, p.description, p.is_featured,
         c.code AS currency_code, c.symbol AS currency_symbol,
         p.game_currency_id,
         gc.name AS game_currency_name,
         COALESCE(gc.image_url, gcm.public_url) AS game_currency_image_url,
         gc.is_active AS game_currency_active,
         p.region_id, p.image_url, pm.public_url AS media_url, p.delivery_type
       FROM public.packages p
       JOIN public.currencies c ON c.id = p.currency_id
       LEFT JOIN public.currencies gc ON gc.id = p.game_currency_id
       LEFT JOIN public.uploaded_media gcm ON gcm.id = gc.media_id
       LEFT JOIN public.uploaded_media pm ON pm.id = p.media_id
       WHERE p.game_id = $1
         AND p.is_active = TRUE
         AND (p.game_currency_id IS NULL OR gc.is_active = TRUE)
       ORDER BY p.is_featured DESC, p.sort_order ASC, p.price_inr ASC`,
      [game.id]
    );

    const currenciesRes = await tx.query<{ code: string; name: string; symbol: string }>(
      `SELECT code, name, symbol
       FROM public.currencies
       WHERE is_active = TRUE AND currency_kind = 'settlement'
       ORDER BY is_base DESC, code ASC`
    );

    return {
      game: {
        id: game.id,
        slug: game.slug,
        title: game.title,
        publisher: game.publisher,
        category: game.category,
        description: game.description,
        coverImageUrl: game.cover_image_url || game.media_url || null,
        deliveryMode: game.delivery_mode,
        playerFields: Array.isArray(game.player_fields) ? game.player_fields : [],
        regions: regionsRes.rows.map((r) => ({
          id: r.id,
          regionCode: r.region_code,
          regionName: r.region_name,
          serverHint: r.server_hint,
        })),
        gameCurrencies: gameCurrenciesRes.rows.map((gc) => ({
          id: gc.id,
          code: gc.code,
          name: gc.name,
          description: gc.description,
          imageUrl: gc.image_url || gc.media_url || null,
        })),
        packages: packagesRes.rows.map((p) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          inGameAmount: Number(p.in_game_amount),
          inGameUnit: p.in_game_unit,
          priceInr: Number(p.price_inr),
          originalPriceInr: p.original_price_inr ? Number(p.original_price_inr) : null,
          discountPercent: Number(p.discount_percent || '0'),
          bonusBadge: p.bonus_badge || '',
          description: p.description || '',
          isFeatured: Boolean(p.is_featured),
          currencyCode: p.currency_code,
          currencySymbol: p.currency_symbol,
          gameCurrencyId: p.game_currency_id,
          gameCurrencyName: p.game_currency_name,
          gameCurrencyImageUrl: p.game_currency_image_url,
          regionId: p.region_id,
          imageUrl: p.image_url || p.media_url || null,
          deliveryType: p.delivery_type,
        })),
        currencies: currenciesRes.rows,
      },
    } satisfies StoreGameDetailResponse;
  });

  if (!detail) {
    res.status(404).json({
      error: 'Game not found or currently unavailable.',
      code: 'GAME_NOT_FOUND',
    });
    return;
  }

  res.json(detail);
}));

/**
 * POST /api/orders/place
 * Phase 2 safe pending order creation without collecting payment.
 * Reads package & price strictly from PostgreSQL and validates dynamic game fields.
 */
storeRouter.post(
  '/orders/place',
  requireAuth,
  orderRateLimiter,
  failedCheckoutLimiter,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = placePendingOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid order details.',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const db = getDb();
    let customerId = req.authUser!.customerId;

    // Ensure customer profile row exists for authenticated user if placing an order
    if (!customerId) {
      const custCode = `LPS-${Date.now().toString(36).toUpperCase()}`;
      const upserted = await db.query<{ id: string }>(
        `INSERT INTO public.customers (profile_id, customer_code)
         VALUES ($1, $2)
         ON CONFLICT (profile_id) DO UPDATE SET profile_id = EXCLUDED.profile_id
         RETURNING id`,
        [req.authUser!.profileId, custCode]
      );
      customerId = upserted.rows[0].id;
    }

    const {
      packageId,
      regionId,
      quantity,
      playerDetails,
      customerNote,
      idempotencyKey,
      preferredDeliveryMethod,
    } = parsed.data;

    // Duplicate submission prevention via idempotencyKey
    if (idempotencyKey) {
      const existingIdempotent = await db.query<{
        id: string;
        order_number: string;
        status: string;
        payment_status: string;
        delivery_method: 'manual' | 'automatic' | 'both';
        total_inr: string;
        currency_code: string;
      }>(
        `SELECT id, order_number, status, payment_status, delivery_method, total_inr::text, currency_code
         FROM public.orders
         WHERE idempotency_key = $1 AND customer_id = $2
         LIMIT 1`,
        [idempotencyKey, customerId]
      );
      const dup = existingIdempotent.rows[0];
      if (dup) {
        res.status(200).json({
          orderId: dup.id,
          orderNumber: dup.order_number,
          status: dup.status,
          paymentStatus: dup.payment_status,
          deliveryMethod: dup.delivery_method,
          duplicatePrevented: true,
          totalInr: Number(dup.total_inr),
          currencyCode: dup.currency_code,
          paymentNotice: 'Order already recorded. Duplicate submission prevented.',
        } satisfies PlaceOrderResponse);
        return;
      }
    }

    const pkgRes = await db.query<{
      package_id: string;
      package_active: boolean;
      price_inr: string;
      supplier_cost_inr: string;
      package_delivery_type: 'manual' | 'automatic' | 'both';
      game_id: string;
      game_active: boolean;
      game_delivery_mode: 'manual' | 'automatic' | 'hybrid';
      game_currency_active: boolean | null;
      player_fields: PlayerFieldDefinition[] | null;
    }>(
      `SELECT
         p.id AS package_id,
         p.is_active AS package_active,
         p.price_inr::text,
         COALESCE(NULLIF(p.supplier_cost_inr, 0), p.cost_inr, 0)::text AS supplier_cost_inr,
         p.delivery_type AS package_delivery_type,
         g.id AS game_id,
         g.is_active AS game_active,
         g.delivery_mode AS game_delivery_mode,
         gc.is_active AS game_currency_active,
         g.player_fields
       FROM public.packages p
       JOIN public.games g ON g.id = p.game_id
       LEFT JOIN public.currencies gc ON gc.id = p.game_currency_id
       WHERE p.id = $1
       LIMIT 1`,
      [packageId]
    );

    const pkg = pkgRes.rows[0];
    if (!pkg || !pkg.package_active || !pkg.game_active || pkg.game_currency_active === false) {
      res.status(404).json({
        error: 'Selected game, currency, or package is currently unavailable.',
        code: 'PACKAGE_UNAVAILABLE',
      });
      return;
    }

    // Validate region belongs to this game when regions exist
    const activeRegions = await db.query<{ id: string }>(
      'SELECT id FROM public.game_regions WHERE game_id = $1 AND is_active = TRUE',
      [pkg.game_id]
    );
    let resolvedRegionId: string | null = regionId ?? null;
    if (activeRegions.rows.length > 0) {
      if (!resolvedRegionId) {
        res.status(400).json({
          error: 'Please select a valid game region.',
          code: 'REGION_REQUIRED',
        });
        return;
      }
      if (!activeRegions.rows.some((r) => r.id === resolvedRegionId)) {
        res.status(400).json({
          error: 'Selected region does not belong to this game.',
          code: 'INVALID_REGION',
        });
        return;
      }
    } else {
      resolvedRegionId = null;
    }

    const schemaFields = Array.isArray(pkg.player_fields) ? pkg.player_fields : [];
    const fieldValidation = sanitizeAndValidatePlayerFields(schemaFields, playerDetails);
    if (!fieldValidation.valid) {
      const firstErr = Object.values(fieldValidation.errors)[0] || 'Invalid player information.';
      res.status(400).json({
        error: firstErr,
        code: 'INVALID_PLAYER_DETAILS',
        fieldErrors: fieldValidation.errors,
      });
      return;
    }

    // Rapid identical order guard within 15 seconds if client omitted idempotencyKey
    if (!idempotencyKey) {
      const recentDup = await db.query<{
        id: string;
        order_number: string;
        status: string;
        payment_status: string;
        delivery_method: 'manual' | 'automatic' | 'both';
        total_inr: string;
        currency_code: string;
      }>(
        `SELECT o.id, o.order_number, o.status, o.payment_status, o.delivery_method, o.total_inr::text, o.currency_code
         FROM public.orders o
         JOIN public.order_items oi ON oi.order_id = o.id
         WHERE o.customer_id = $1
           AND oi.package_id = $2
           AND oi.target_player_uid = $3
           AND oi.quantity = $4
           AND o.created_at > NOW() - INTERVAL '15 seconds'
         ORDER BY o.created_at DESC
         LIMIT 1`,
        [customerId, pkg.package_id, fieldValidation.targetPlayerUid, quantity]
      );
      const dup = recentDup.rows[0];
      if (dup) {
        res.status(200).json({
          orderId: dup.id,
          orderNumber: dup.order_number,
          status: dup.status,
          paymentStatus: dup.payment_status,
          deliveryMethod: dup.delivery_method,
          duplicatePrevented: true,
          totalInr: Number(dup.total_inr),
          currencyCode: dup.currency_code,
          paymentNotice: 'Recent identical order detected. Duplicate creation prevented.',
        } satisfies PlaceOrderResponse);
        return;
      }
    }

    const deliveryMethod = resolveOrderDeliveryMethod({
      gameDeliveryMode: pkg.game_delivery_mode,
      packageDeliveryType: pkg.package_delivery_type,
      preferredMethod: preferredDeliveryMethod,
    });

    const unitPriceInr = Number(pkg.price_inr);
    const totalInr = Number((unitPriceInr * quantity).toFixed(2));
    const unitCostInr = Number(pkg.supplier_cost_inr || '0');
    const totalCostInr = Number((unitCostInr * quantity).toFixed(2));
    const amountPaise = convertInrToPaise(totalInr);
    const orderNumber = `LPS-${Date.now().toString(36).toUpperCase()}-${crypto
      .randomBytes(2)
      .toString('hex')
      .toUpperCase()}`;

    const created = await db.withTransaction(async (tx) => {
      const orderRes = await tx.query<{ id: string }>(
        `INSERT INTO public.orders
           (order_number, customer_id, status, payment_status, delivery_method, idempotency_key, subtotal_inr, total_inr, supplier_cost_inr, amount_paise, currency_code, payment_mode, customer_note)
         VALUES ($1, $2, 'payment_pending', 'pending', $3, $4, $5, $5, $6, $7, 'INR', 'test', $8)
         RETURNING id`,
        [
          orderNumber,
          customerId,
          deliveryMethod,
          idempotencyKey ?? null,
          totalInr,
          totalCostInr,
          amountPaise,
          customerNote ?? null,
        ]
      );
      const orderId = orderRes.rows[0].id;

      await tx.query(
        `INSERT INTO public.order_items
           (order_id, package_id, game_id, region_id, quantity, unit_price_inr, total_price_inr, unit_cost_inr, total_cost_inr, target_player_uid, target_server_id, player_details, fulfillment_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, 'pending')`,
        [
          orderId,
          pkg.package_id,
          pkg.game_id,
          resolvedRegionId,
          quantity,
          unitPriceInr,
          totalInr,
          unitCostInr,
          totalCostInr,
          fieldValidation.targetPlayerUid,
          fieldValidation.targetServerId,
          JSON.stringify(fieldValidation.sanitizedDetails),
        ]
      );

      await tx.query(
        `INSERT INTO public.order_delivery_logs
           (order_id, actor_profile_id, actor_label, event_type, previous_status, next_status, delivery_method, is_mock, message)
         VALUES ($1, $2, 'customer', 'order_created', NULL, 'payment_pending', $3, FALSE, 'Order placed cleanly in Payment Pending state (payments not yet enabled).')`,
        [orderId, req.authUser!.profileId, deliveryMethod]
      );

      await tx.query(
        `UPDATE public.customers SET total_orders = total_orders + 1 WHERE id = $1`,
        [customerId]
      );

      return { orderId };
    });

    const response: PlaceOrderResponse = {
      orderId: created.orderId,
      orderNumber,
      status: 'payment_pending',
      paymentStatus: 'pending',
      deliveryMethod,
      totalInr,
      currencyCode: 'INR',
      paymentNotice:
        'Order created in Payment Pending state. Payment options will be available soon.',
    };

    res.status(201).json(response);
  })
);

storeRouter.get('/customer/orders', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res) => {
  const customerId = req.authUser!.customerId;
  if (!customerId) {
    res.json({ orders: [] });
    return;
  }

  const db = getDb();
  const orders = await db.withUserRlsContext(req.authUser!.profileId, async (tx) => {
    interface OrderJoinRow {
      id: string;
      order_number: string;
      status: string;
      payment_status: string;
      delivery_method: 'manual' | 'automatic' | 'both' | null;
      customer_delivery_message: string | null;
      total_inr: string;
      currency_code: string;
      created_at: string;
      game_title: string | null;
      game_slug: string | null;
      package_name: string | null;
      in_game_amount: string | null;
      in_game_unit: string | null;
      quantity: number | null;
      fulfillment_status: string | null;
      player_details: Record<string, string> | null;
      region_name: string | null;
    }

    const result = await tx.query<OrderJoinRow>(
      `SELECT
         o.id,
         o.order_number,
         o.status,
         o.payment_status,
         o.delivery_method,
         o.customer_delivery_message,
         o.total_inr::text,
         o.currency_code,
         o.created_at,
         g.title AS game_title,
         g.slug AS game_slug,
         p.name AS package_name,
         p.in_game_amount::text,
         p.in_game_unit,
         oi.quantity,
         oi.fulfillment_status,
         oi.player_details,
         gr.region_name
       FROM public.orders o
       LEFT JOIN public.order_items oi ON oi.order_id = o.id
       LEFT JOIN public.games g ON g.id = oi.game_id
       LEFT JOIN public.packages p ON p.id = oi.package_id
       LEFT JOIN public.game_regions gr ON gr.id = oi.region_id
       WHERE o.customer_id = $1
       ORDER BY o.created_at DESC
       LIMIT 50`,
      [customerId]
    );

    return result.rows.map(
      (r): CustomerOrderItemView => ({
        id: r.id,
        orderNumber: r.order_number,
        gameTitle: r.game_title || 'Top-Up Order',
        gameSlug: r.game_slug || '',
        packageName: r.package_name || 'Package',
        inGameAmount: Number(r.in_game_amount || '0'),
        inGameUnit: r.in_game_unit || '',
        quantity: Number(r.quantity || 1),
        totalInr: Number(r.total_inr),
        currencyCode: r.currency_code,
        status: r.status,
        displayOrderStatus: mapPhase4OrderStatusLabel(r.status),
        paymentStatus: r.payment_status,
        displayPaymentStatus: mapPhase4PaymentStatusLabel(r.payment_status),
        deliveryMethod: r.delivery_method || 'manual',
        fulfillmentStatus: r.fulfillment_status || 'pending',
        displayDeliveryStatus: mapPhase4DeliveryStatusLabel(r.fulfillment_status || 'pending'),
        customerDeliveryMessage: r.customer_delivery_message || '',
        regionName: r.region_name,
        playerDetails: r.player_details || {},
        createdAt: r.created_at,
      })
    );
  });

  res.json({ orders });
}));

storeRouter.get('/customer/profile', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const profile = await db.withUserRlsContext(req.authUser!.profileId, async (tx) => {
    const resRow = await tx.query<{
      email: string;
      full_name: string;
      phone: string | null;
      account_status: string;
      created_at: string;
      customer_code: string | null;
      default_currency_code: string | null;
      total_orders: number | null;
    }>(
      `SELECT
         p.email,
         p.full_name,
         p.phone,
         p.account_status,
         p.created_at,
         c.customer_code,
         c.default_currency_code,
         c.total_orders
       FROM public.profiles p
       LEFT JOIN public.customers c ON c.profile_id = p.id
       WHERE p.id = $1
       LIMIT 1`,
      [req.authUser!.profileId]
    );
    return resRow.rows[0] || null;
  });

  if (!profile) {
    res.status(404).json({ error: 'Profile not found.', code: 'NOT_FOUND' });
    return;
  }

  const payload: CustomerProfileResponse = {
    profile: {
      email: profile.email,
      fullName: profile.full_name,
      phone: profile.phone,
      accountStatus: profile.account_status,
      customerCode: profile.customer_code || 'ADMIN-PROFILE',
      defaultCurrencyCode: profile.default_currency_code || 'INR',
      totalOrders: Number(profile.total_orders || 0),
      createdAt: profile.created_at,
    },
  };

  res.json(payload);
}));

storeRouter.patch('/customer/profile', requireAuth, profileRateLimiter, asyncHandler(async (req: AuthenticatedRequest, res) => {
  const parsed = updateCustomerProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Invalid profile update.',
      code: 'VALIDATION_ERROR',
    });
    return;
  }

  const db = getDb();
  const { fullName, phone } = parsed.data;

  await db.withUserRlsContext(req.authUser!.profileId, async (tx) => {
    await tx.query(
      `UPDATE public.profiles
       SET full_name = $1, phone = $2
       WHERE id = $3`,
      [fullName, phone ?? null, req.authUser!.profileId]
    );
  });

  res.json({ ok: true, fullName, phone: phone ?? null });
}));

storeRouter.post('/contact', contactRateLimiter, asyncHandler(async (req, res) => {
  const parsed = contactInquirySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Invalid contact inquiry.',
      code: 'VALIDATION_ERROR',
    });
    return;
  }

  const db = getDb();
  const { name, email, subject, message } = parsed.data;
  const inserted = await db.query<{ id: string; created_at: string }>(
    `INSERT INTO public.contact_inquiries (name, email, subject, message)
     VALUES ($1, $2, $3, $4)
     RETURNING id, created_at`,
    [name, email, subject, message]
  );

  res.status(201).json({
    id: inserted.rows[0].id,
    createdAt: inserted.rows[0].created_at,
    message: 'Inquiry received and logged for support follow-up.',
  });
}));
