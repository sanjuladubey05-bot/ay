import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import {
  asyncHandler,
  createFailedCheckoutRateLimiter,
  createRateLimiter,
  requireAdmin,
  requireAuth,
  requirePermission,
  type AuthenticatedRequest,
} from '../authentication/middleware';
import { getEnvReadinessSummary, getServerEnv } from '../configuration/env';
import { writeAuditLog } from '../database/audit';
import { getDb } from '../database/pool';
import type { PaymentMode, PaymentStatus } from '../types/database';
import {
  buildChecklistState,
  evaluateLiveModeEligibility,
  type StoredChecklistMap,
} from '../utilities/checklist';
import {
  canTransitionPaymentStatus,
  convertInrToPaise,
  evaluatePaymentModeGuard,
  isFulfillmentAuthorized,
  verifyRazorpayOrderSignature,
  verifyRazorpayWebhookSignature,
} from '../utilities/paymentMath';
import {
  createPaymentOrderSchema,
  paymentStatusQuerySchema,
  refundRequestSchema,
  verifyPaymentSchema,
} from '../utilities/validation';

export const paymentRouter = Router();

const paymentRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 20,
  keyPrefix: 'payments',
});

const failedCheckoutLimiter = createFailedCheckoutRateLimiter({
  windowMs: 60 * 1000,
  maxFailures: 5,
  keyPrefix: 'failed_checkout_payments',
});

const webhookRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 120,
  keyPrefix: 'payment_webhook',
});

const refundRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 15,
  keyPrefix: 'payment_refund',
});

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 10000
): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      redirect: 'error',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function getActivePaymentModeAndChecklist() {
  const db = getDb();
  const rows = await db.query<{ setting_key: string; setting_value: unknown }>(
    `SELECT setting_key, setting_value
     FROM public.website_settings
     WHERE setting_key IN ('payment_mode', 'razorpay_readiness_checklist')`
  );

  let mode: PaymentMode = 'test';
  let checklistMap: StoredChecklistMap = {};

  for (const row of rows.rows) {
    if (row.setting_key === 'payment_mode' && row.setting_value && typeof row.setting_value === 'object') {
      mode = (row.setting_value as { mode?: string }).mode === 'live' ? 'live' : 'test';
    }
    if (
      row.setting_key === 'razorpay_readiness_checklist' &&
      row.setting_value &&
      typeof row.setting_value === 'object'
    ) {
      checklistMap = row.setting_value as StoredChecklistMap;
    }
  }

  const envReadiness = getEnvReadinessSummary();
  const checklist = buildChecklistState(checklistMap, envReadiness);
  const liveEval = evaluateLiveModeEligibility(checklist, envReadiness);
  return { mode, liveChecklistComplete: liveEval.eligible };
}

/**
 * POST /api/payments/create-order
 * Server-authoritative Razorpay order creation:
 * - Reads package price exclusively from DB
 * - Converts INR to paise
 * - Enforces Test vs Live guardrails
 * - Handles missing Razorpay credentials safely without faking success
 */
paymentRouter.post(
  '/create-order',
  requireAuth,
  paymentRateLimiter,
  failedCheckoutLimiter,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = createPaymentOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid payment order request.',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    if (!req.authUser?.customerId) {
      res.status(403).json({
        error: 'A customer profile is required to initiate a checkout order.',
        code: 'CUSTOMER_PROFILE_REQUIRED',
      });
      return;
    }

    const env = getServerEnv();
    const { mode, liveChecklistComplete } = await getActivePaymentModeAndChecklist();
    const guard = evaluatePaymentModeGuard({
      mode,
      keyId: env.razorpayKeyId,
      keySecret: env.razorpayKeySecret,
      webhookSecret: env.razorpayWebhookSecret,
      liveChecklistComplete,
    });

    if (!guard.allowed) {
      res.status(503).json({
        error: guard.reason,
        code: guard.code || 'RAZORPAY_NOT_CONFIGURED',
        mode,
        configured: false,
      });
      return;
    }

    const db = getDb();
    const { packageId, regionId, targetPlayerUid, targetServerId, quantity } = parsed.data;

    const pkgRes = await db.query<{
      id: string;
      game_id: string;
      price_inr: string;
      supplier_cost_inr: string;
      name: string;
      is_active: boolean;
      game_active: boolean;
      game_currency_active: boolean | null;
    }>(
      `SELECT
         p.id,
         p.game_id,
         p.price_inr::text,
         COALESCE(NULLIF(p.supplier_cost_inr, 0), p.cost_inr, 0)::text AS supplier_cost_inr,
         p.name,
         p.is_active,
         g.is_active AS game_active,
         gc.is_active AS game_currency_active
       FROM public.packages p
       JOIN public.games g ON g.id = p.game_id
       LEFT JOIN public.currencies gc ON gc.id = p.game_currency_id
       WHERE p.id = $1
       LIMIT 1`,
      [packageId]
    );

    const pkg = pkgRes.rows[0];
    if (!pkg || !pkg.is_active || !pkg.game_active || pkg.game_currency_active === false) {
      res.status(404).json({
        error: 'Selected top-up package is unavailable or inactive.',
        code: 'PACKAGE_NOT_FOUND',
      });
      return;
    }

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

    const unitPriceInr = Number(pkg.price_inr);
    const totalInr = Number((unitPriceInr * quantity).toFixed(2));
    const unitCostInr = Number(pkg.supplier_cost_inr || '0');
    const totalCostInr = Number((unitCostInr * quantity).toFixed(2));
    const amountPaise = convertInrToPaise(totalInr);
    const orderNumber = `LPS-${Date.now().toString(36).toUpperCase()}-${crypto
      .randomBytes(2)
      .toString('hex')
      .toUpperCase()}`;
    const idempotencyKey = crypto.randomUUID();

    // Create internal pending order first, then call Razorpay Orders API
    const internal = await db.withTransaction(async (tx) => {
      const orderRes = await tx.query<{ id: string }>(
        `INSERT INTO public.orders
           (order_number, customer_id, status, payment_status, subtotal_inr, total_inr, supplier_cost_inr, amount_paise, currency_code, payment_mode)
         VALUES ($1, $2, 'awaiting_payment', 'pending', $3, $3, $4, $5, 'INR', $6)
         RETURNING id`,
        [orderNumber, req.authUser!.customerId, totalInr, totalCostInr, amountPaise, mode]
      );
      const orderId = orderRes.rows[0].id;

      await tx.query(
        `INSERT INTO public.order_items
           (order_id, package_id, game_id, region_id, quantity, unit_price_inr, total_price_inr, unit_cost_inr, total_cost_inr, target_player_uid, target_server_id, fulfillment_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')`,
        [
          orderId,
          pkg.id,
          pkg.game_id,
          resolvedRegionId,
          quantity,
          unitPriceInr,
          totalInr,
          unitCostInr,
          totalCostInr,
          targetPlayerUid,
          targetServerId ?? null,
        ]
      );

      const payRes = await tx.query<{ id: string }>(
        `INSERT INTO public.payments
           (order_id, customer_id, gateway, mode, amount_paise, currency, status, idempotency_key)
         VALUES ($1, $2, 'razorpay', $3, $4, 'INR', 'pending', $5)
         RETURNING id`,
        [orderId, req.authUser!.customerId, mode, amountPaise, idempotencyKey]
      );

      return { orderId, paymentId: payRes.rows[0].id };
    });

    try {
      const authToken = Buffer.from(`${env.razorpayKeyId}:${env.razorpayKeySecret}`).toString(
        'base64'
      );
      const rzpResponse = await fetchWithTimeout('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: amountPaise,
          currency: 'INR',
          receipt: orderNumber,
          notes: {
            internal_order_id: internal.orderId,
            payment_mode: mode,
          },
        }),
      });

      if (!rzpResponse.ok) {
        const errBody = await rzpResponse.text();
        await db.query(
          `UPDATE public.payments SET status = 'failed', failure_code = $1, failure_reason = $2 WHERE id = $3`,
          [`HTTP_${rzpResponse.status}`, errBody.slice(0, 240), internal.paymentId]
        );
        res.status(502).json({
          error: 'Razorpay rejected order creation. Check gateway credentials and mode.',
          code: 'RAZORPAY_UPSTREAM_ERROR',
        });
        return;
      }

      const rzpOrder = (await rzpResponse.json()) as { id: string; amount: number; currency: string };
      await db.query(
        `UPDATE public.payments SET razorpay_order_id = $1, status = 'processing' WHERE id = $2`,
        [rzpOrder.id, internal.paymentId]
      );
      await db.query(
        `INSERT INTO public.payment_transactions
           (payment_id, order_id, event_type, gateway_order_id, status, amount_paise, signature_valid, raw_payload)
         VALUES ($1, $2, 'order.created', $3, 'processing', $4, TRUE, $5::jsonb)`,
        [internal.paymentId, internal.orderId, rzpOrder.id, amountPaise, JSON.stringify(rzpOrder)]
      );

      res.status(201).json({
        orderId: internal.orderId,
        orderNumber,
        paymentId: internal.paymentId,
        razorpayOrderId: rzpOrder.id,
        razorpayKeyId: env.razorpayKeyId,
        amountPaise,
        currency: 'INR',
        mode,
      });
    } catch (err) {
      console.error('Razorpay create-order network failure:', err);
      res.status(502).json({
        error: 'Unable to reach Razorpay Orders API.',
        code: 'RAZORPAY_NETWORK_ERROR',
      });
    }
  })
);

/**
 * POST /api/payments/verify
 * Verifies Razorpay Standard Checkout HMAC signature & confirms capture status server-side.
 * Never authorizes fulfillment on frontend callback alone.
 */
paymentRouter.post('/verify', requireAuth, paymentRateLimiter, failedCheckoutLimiter, asyncHandler(async (req: AuthenticatedRequest, res) => {
  const parsed = verifyPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Invalid verification payload.',
      code: 'VALIDATION_ERROR',
    });
    return;
  }

  const env = getServerEnv();
  if (!env.razorpayKeyId || !env.razorpayKeySecret) {
    res.status(503).json({
      error: 'Razorpay verification credentials are not configured on the server.',
      code: 'RAZORPAY_NOT_CONFIGURED',
    });
    return;
  }

  const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = parsed.data;
  const db = getDb();

  const payRes = await db.query<{
    id: string;
    order_id: string;
    customer_id: string;
    razorpay_order_id: string | null;
    razorpay_payment_id: string | null;
    amount_paise: string;
    status: PaymentStatus;
    mode: PaymentMode;
    signature_verified: boolean;
  }>(
    `SELECT id, order_id, customer_id, razorpay_order_id, razorpay_payment_id, amount_paise::text, status, mode, signature_verified
     FROM public.payments
     WHERE order_id = $1 AND razorpay_order_id = $2
     LIMIT 1`,
    [orderId, razorpayOrderId]
  );

  const payment = payRes.rows[0];
  if (!payment) {
    res.status(404).json({ error: 'Payment record not found.', code: 'PAYMENT_NOT_FOUND' });
    return;
  }

  if (!req.authUser!.isAdmin && payment.customer_id !== req.authUser!.customerId) {
    res.status(403).json({ error: 'Access denied for this payment.', code: 'FORBIDDEN' });
    return;
  }

  // Idempotent return if already captured & verified
  if (
    payment.signature_verified &&
    payment.razorpay_payment_id === razorpayPaymentId &&
    payment.status === 'captured'
  ) {
    res.json({
      verified: true,
      status: payment.status,
      fulfillmentAuthorized: true,
      idempotent: true,
    });
    return;
  }

  const signatureValid = verifyRazorpayOrderSignature({
    orderId: razorpayOrderId,
    paymentId: razorpayPaymentId,
    signature: razorpaySignature,
    keySecret: env.razorpayKeySecret,
  });

  if (!signatureValid) {
    await db.query(
      `INSERT INTO public.payment_transactions
         (payment_id, order_id, event_type, gateway_payment_id, gateway_order_id, status, amount_paise, signature_valid)
       VALUES ($1, $2, 'payment.verify_failed_signature', $3, $4, 'failed', $5, FALSE)`,
      [payment.id, payment.order_id, razorpayPaymentId, razorpayOrderId, Number(payment.amount_paise)]
    );

    res.status(400).json({
      error: 'Razorpay payment signature verification failed.',
      code: 'INVALID_PAYMENT_SIGNATURE',
    });
    return;
  }

  // Query authoritative payment status from Razorpay API so authorized vs captured is never conflated
  let serverPaymentStatus: PaymentStatus = 'authorized';
  let method: string | null = null;

  try {
    const authToken = Buffer.from(`${env.razorpayKeyId}:${env.razorpayKeySecret}`).toString('base64');
    const rzpPayRes = await fetchWithTimeout(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(razorpayPaymentId)}`,
      {
        headers: { Authorization: `Basic ${authToken}` },
      }
    );

    if (rzpPayRes.ok) {
      const rzpData = (await rzpPayRes.json()) as {
        status?: string;
        amount?: number;
        order_id?: string;
        method?: string;
      };
      if (rzpData.order_id !== razorpayOrderId || rzpData.amount !== Number(payment.amount_paise)) {
        res.status(400).json({
          error: 'Gateway payment amount or order ID mismatch.',
          code: 'AMOUNT_OR_ORDER_MISMATCH',
        });
        return;
      }
      method = rzpData.method || null;
      if (rzpData.status === 'captured') {
        serverPaymentStatus = 'captured';
      } else if (rzpData.status === 'authorized') {
        serverPaymentStatus = 'authorized';
      } else if (rzpData.status === 'failed') {
        serverPaymentStatus = 'failed';
      }
    }
  } catch (err) {
    console.warn('Could not query Razorpay payment detail API, retaining authorized pending webhook:', err);
  }

  await db.withTransaction(async (tx) => {
    await tx.query(
      `UPDATE public.payments
       SET razorpay_payment_id = $1,
           signature_verified = TRUE,
           method = COALESCE($2, method),
           status = $3,
           authorized_at = COALESCE(authorized_at, NOW()),
           captured_at = CASE WHEN $3 = 'captured' THEN NOW() ELSE captured_at END
       WHERE id = $4`,
      [razorpayPaymentId, method, serverPaymentStatus, payment.id]
    );

    await tx.query(
      `UPDATE public.orders
       SET payment_status = $1,
           status = CASE WHEN $1 = 'captured' THEN 'paid' ELSE 'awaiting_payment' END
       WHERE id = $2`,
      [serverPaymentStatus, payment.order_id]
    );

    await tx.query(
      `INSERT INTO public.payment_transactions
         (payment_id, order_id, event_type, gateway_payment_id, gateway_order_id, status, amount_paise, signature_valid)
       VALUES ($1, $2, 'payment.verified', $3, $4, $5, $6, TRUE)`,
      [
        payment.id,
        payment.order_id,
        razorpayPaymentId,
        razorpayOrderId,
        serverPaymentStatus,
        Number(payment.amount_paise),
      ]
    );
  });

  res.json({
    verified: true,
    status: serverPaymentStatus,
    fulfillmentAuthorized: isFulfillmentAuthorized(serverPaymentStatus),
  });
}));

export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

/**
 * POST /api/payments/webhook
 * Server-to-server Razorpay Webhook handler with HMAC-SHA256 verification and idempotency.
 */
paymentRouter.post('/webhook', webhookRateLimiter, asyncHandler(async (req: RawBodyRequest, res) => {
  const env = getServerEnv();
  if (!env.razorpayWebhookSecret) {
    res.status(503).json({
      error: 'Payment webhook secret is not configured on the server.',
      code: 'WEBHOOK_NOT_CONFIGURED',
    });
    return;
  }

  const signature = req.headers['x-razorpay-signature'];
  const eventId = req.headers['x-razorpay-event-id']?.toString() || null;
  const rawBody = req.rawBody || JSON.stringify(req.body || {});

  if (typeof signature !== 'string' || !signature) {
    res.status(401).json({ error: 'Missing X-Razorpay-Signature header.', code: 'MISSING_SIGNATURE' });
    return;
  }

  const valid = verifyRazorpayWebhookSignature({
    rawBody,
    signature,
    webhookSecret: env.razorpayWebhookSecret,
  });

  if (!valid) {
    res.status(401).json({ error: 'Invalid Razorpay webhook signature.', code: 'INVALID_SIGNATURE' });
    return;
  }

  const payload = req.body as {
    event?: string;
    payload?: {
      payment?: {
        entity?: {
          id?: string;
          order_id?: string;
          amount?: number;
          method?: string;
          error_code?: string;
          error_description?: string;
        };
      };
    };
  };

  const eventType = payload?.event || 'unknown';
  const payEntity = payload?.payload?.payment?.entity;
  const rzpOrderId = payEntity?.order_id;
  const rzpPaymentId = payEntity?.id;

  const db = getDb();
  if (eventId) {
    const existingEvent = await db.query<{ id: string }>(
      'SELECT id FROM public.payment_transactions WHERE gateway_event_id = $1 LIMIT 1',
      [eventId]
    );
    if (existingEvent.rows.length > 0) {
      res.json({ received: true, idempotent: true });
      return;
    }
  }

  if (rzpOrderId) {
    const paymentRes = await db.query<{
      id: string;
      order_id: string;
      status: PaymentStatus;
      amount_paise: string;
    }>(
      'SELECT id, order_id, status, amount_paise::text FROM public.payments WHERE razorpay_order_id = $1 LIMIT 1',
      [rzpOrderId]
    );

    const payment = paymentRes.rows[0];
    if (payment) {
      let nextStatus: PaymentStatus = payment.status;
      if (eventType === 'payment.authorized') nextStatus = 'authorized';
      if (eventType === 'payment.captured') nextStatus = 'captured';
      if (eventType === 'payment.failed') nextStatus = 'failed';

      if (canTransitionPaymentStatus(payment.status, nextStatus)) {
        await db.withTransaction(async (tx) => {
          await tx.query(
            `UPDATE public.payments
             SET status = $1,
                 razorpay_payment_id = COALESCE($2, razorpay_payment_id),
                 method = COALESCE($3, method),
                 authorized_at = CASE WHEN $1 IN ('authorized', 'captured') THEN COALESCE(authorized_at, NOW()) ELSE authorized_at END,
                 captured_at = CASE WHEN $1 = 'captured' THEN COALESCE(captured_at, NOW()) ELSE captured_at END,
                 failure_code = COALESCE($4, failure_code),
                 failure_reason = COALESCE($5, failure_reason)
             WHERE id = $6`,
            [
              nextStatus,
              rzpPaymentId ?? null,
              payEntity?.method ?? null,
              payEntity?.error_code ?? null,
              payEntity?.error_description ?? null,
              payment.id,
            ]
          );

          await tx.query(
            `UPDATE public.orders
             SET payment_status = $1,
                 status = CASE
                   WHEN $1 = 'captured' THEN 'paid'
                   WHEN $1 = 'failed' THEN 'failed'
                   ELSE status
                 END
             WHERE id = $2`,
            [nextStatus, payment.order_id]
          );

          await tx.query(
            `INSERT INTO public.payment_transactions
               (payment_id, order_id, event_type, gateway_event_id, gateway_payment_id, gateway_order_id, status, amount_paise, signature_valid, raw_payload)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9::jsonb)`,
            [
              payment.id,
              payment.order_id,
              eventType,
              eventId,
              rzpPaymentId ?? null,
              rzpOrderId,
              nextStatus,
              Number(payEntity?.amount ?? payment.amount_paise),
              JSON.stringify(payload),
            ]
          );
        });
      }
    }
  }

  res.json({ received: true });
}));

/**
 * GET /api/payments/status?orderId=<uuid>
 * Returns reconciled payment status under strict ownership / RLS checks.
 */
paymentRouter.get('/status', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res) => {
  const parsedQuery = paymentStatusQuerySchema.safeParse({
    orderId: typeof req.query.orderId === 'string' ? req.query.orderId : '',
  });
  if (!parsedQuery.success) {
    res.status(400).json({ error: 'Valid orderId UUID query parameter is required.', code: 'VALIDATION_ERROR' });
    return;
  }

  const { orderId } = parsedQuery.data;
  const isAdmin = Boolean(req.authUser!.isAdmin);
  const customerId = req.authUser!.customerId;

  if (!isAdmin && !customerId) {
    res.status(404).json({ error: 'Order payment record not found.', code: 'NOT_FOUND' });
    return;
  }

  const db = getDb();
  const rows = await db.withUserRlsContext(req.authUser!.profileId, async (tx) => {
    const result = await tx.query<{
      order_id: string;
      order_number: string;
      payment_id: string;
      razorpay_order_id: string | null;
      razorpay_payment_id: string | null;
      status: PaymentStatus;
      mode: PaymentMode;
      amount_paise: string;
      total_inr: string;
      signature_verified: boolean;
    }>(
      `SELECT
         o.id AS order_id,
         o.order_number,
         p.id AS payment_id,
         p.razorpay_order_id,
         p.razorpay_payment_id,
         p.status,
         p.mode,
         p.amount_paise::text,
         o.total_inr::text,
         p.signature_verified
       FROM public.orders o
       JOIN public.payments p ON p.order_id = o.id
       WHERE o.id = $1
         AND ($2::boolean = TRUE OR o.customer_id = $3::uuid)
       LIMIT 1`,
      [orderId, isAdmin, customerId]
    );
    return result.rows;
  });

  const row = rows[0];
  if (!row) {
    res.status(404).json({ error: 'Order payment record not found.', code: 'NOT_FOUND' });
    return;
  }

  res.json({
    orderId: row.order_id,
    orderNumber: row.order_number,
    paymentId: row.payment_id,
    razorpayOrderId: row.razorpay_order_id,
    razorpayPaymentId: row.razorpay_payment_id,
    status: row.status,
    mode: row.mode,
    amountPaise: Number(row.amount_paise),
    amountInr: Number(row.total_inr),
    signatureVerified: row.signature_verified,
    fulfillmentAuthorized: isFulfillmentAuthorized(row.status),
  });
}));

/**
 * POST /api/payments/refund
 * Strictly admin-only refund orchestration with permission checks and audit logging.
 */
paymentRouter.post(
  '/refund',
  requireAdmin,
  requirePermission('payments.refund'),
  refundRateLimiter,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = refundRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid refund request.',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const env = getServerEnv();
    const { mode, liveChecklistComplete } = await getActivePaymentModeAndChecklist();
    const guard = evaluatePaymentModeGuard({
      mode,
      keyId: env.razorpayKeyId,
      keySecret: env.razorpayKeySecret,
      webhookSecret: env.razorpayWebhookSecret,
      liveChecklistComplete,
    });

    if (!guard.allowed) {
      res.status(503).json({
        error: guard.reason,
        code: guard.code || 'RAZORPAY_NOT_CONFIGURED',
      });
      return;
    }

    const db = getDb();
    const { paymentId, amountPaise, reason } = parsed.data;

    const payRes = await db.query<{
      id: string;
      order_id: string;
      razorpay_payment_id: string | null;
      amount_paise: string;
      status: PaymentStatus;
    }>(
      `SELECT id, order_id, razorpay_payment_id, amount_paise::text, status
       FROM public.payments
       WHERE id = $1
       LIMIT 1`,
      [paymentId]
    );

    const payment = payRes.rows[0];
    if (!payment || !payment.razorpay_payment_id) {
      res.status(404).json({ error: 'Captured gateway payment not found.', code: 'PAYMENT_NOT_FOUND' });
      return;
    }

    if (payment.status !== 'captured' && payment.status !== 'partially_refunded') {
      res.status(400).json({
        error: `Cannot refund a payment in '${payment.status}' status. Only captured payments may be refunded.`,
        code: 'INVALID_REFUND_STATE',
      });
      return;
    }

    const totalPaidPaise = Number(payment.amount_paise);
    const refundAmount = amountPaise ?? totalPaidPaise;
    if (refundAmount > totalPaidPaise) {
      res.status(400).json({
        error: 'Refund amount exceeds original captured payment amount.',
        code: 'REFUND_EXCEEDS_PAYMENT',
      });
      return;
    }

    const adminRow = await db.query<{ id: string }>(
      'SELECT id FROM public.admin_users WHERE profile_id = $1 LIMIT 1',
      [req.authUser!.profileId]
    );

    const authToken = Buffer.from(`${env.razorpayKeyId}:${env.razorpayKeySecret}`).toString('base64');
    const rzpRefundRes = await fetchWithTimeout(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(payment.razorpay_payment_id)}/refund`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: refundAmount,
          notes: { reason },
        }),
      }
    );

    if (!rzpRefundRes.ok) {
      res.status(502).json({
        error: 'Razorpay refund API rejected the request.',
        code: 'RAZORPAY_REFUND_ERROR',
      });
      return;
    }

    const rzpRefund = (await rzpRefundRes.json()) as { id: string; status: string };
    const nextPaymentStatus: PaymentStatus =
      refundAmount === totalPaidPaise ? 'refunded' : 'partially_refunded';

    await db.withTransaction(async (tx) => {
      await tx.query(
        `INSERT INTO public.refunds
           (payment_id, order_id, razorpay_refund_id, amount_paise, reason, status, initiated_by_admin_id, processed_at)
         VALUES ($1, $2, $3, $4, $5, 'processed', $6, NOW())`,
        [
          payment.id,
          payment.order_id,
          rzpRefund.id,
          refundAmount,
          reason,
          adminRow.rows[0]?.id || null,
        ]
      );

      await tx.query('UPDATE public.payments SET status = $1 WHERE id = $2', [
        nextPaymentStatus,
        payment.id,
      ]);

      await tx.query(
        `UPDATE public.orders
         SET payment_status = $1,
             status = CASE WHEN $1 = 'refunded' THEN 'refunded' ELSE status END
         WHERE id = $2`,
        [nextPaymentStatus, payment.order_id]
      );

      await writeAuditLog(
        {
          actorProfileId: req.authUser!.profileId,
          actorRole: req.authUser!.roleCode,
          action: 'admin.payment_refunded',
          resourceType: 'refunds',
          resourceId: rzpRefund.id,
          req,
          details: { paymentId: payment.id, amountPaise: refundAmount, reason },
        },
        tx
      );
    });

    res.json({
      refunded: true,
      razorpayRefundId: rzpRefund.id,
      paymentStatus: nextPaymentStatus,
    });
  })
);
