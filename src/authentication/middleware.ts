import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { getServerEnv } from '../configuration/env';
import { writeAuditLog } from '../database/audit';
import type { AuthenticatedUser } from '../types/api';
import type { PermissionCode } from '../types/database';
import { resolveSessionUser } from './session';

export interface AuthenticatedRequest extends Request {
  authUser?: AuthenticatedUser;
}

/**
 * Ensures Express 4 async route rejections are always forwarded to the global error boundary.
 */
export function asyncHandler(
  fn: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as AuthenticatedRequest, res, next)).catch(next);
  };
}

function getRequestHost(req: Request): string {
  return (req.headers['x-forwarded-host'] || req.headers.host || '')
    .toString()
    .split(',')[0]
    .trim()
    .toLowerCase();
}

function isAllowedOrigin(origin: string, req: Request): boolean {
  try {
    const parsedOrigin = new URL(origin);
    if (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') {
      return false;
    }

    const requestHost = getRequestHost(req);
    if (requestHost && parsedOrigin.host.toLowerCase() === requestHost) {
      return true;
    }

    const configuredAppUrl = getServerEnv().appUrl;
    if (configuredAppUrl) {
      try {
        const appOrigin = new URL(configuredAppUrl).origin.toLowerCase();
        if (parsedOrigin.origin.toLowerCase() === appOrigin) {
          return true;
        }
      } catch {
        // Ignore malformed APP_URL
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Strict origin-verified CORS middleware.
 * Never returns wildcard '*' with credentials; rejects disallowed cross-origin requests.
 */
export function strictCorsProtection(req: Request, res: Response, next: NextFunction): void {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
  res.setHeader('Vary', 'Origin');

  if (!origin) {
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
    return;
  }

  if (!isAllowedOrigin(origin, req)) {
    res.status(403).json({
      error: 'Cross-origin request blocked by server CORS policy.',
      code: 'CORS_ORIGIN_DENIED',
    });
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
}

export async function attachAuthUser(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = await resolveSessionUser(req);
    if (user) {
      req.authUser = user;
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.authUser) {
    res.status(401).json({
      error: 'Authentication required. Please sign in to continue.',
      code: 'UNAUTHORIZED',
    });
    return;
  }
  next();
}

export async function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.authUser) {
    res.status(401).json({
      error: 'Administrator authentication required.',
      code: 'UNAUTHORIZED',
    });
    return;
  }

  if (!req.authUser.isAdmin) {
    await writeAuditLog({
      actorProfileId: req.authUser.profileId,
      actorRole: req.authUser.roleCode,
      action: 'admin.access_denied',
      resourceType: 'route',
      resourceId: req.originalUrl,
      req,
      details: { method: req.method },
    }).catch(() => undefined);

    res.status(403).json({
      error: 'Access denied. Administrator privileges are required for this resource.',
      code: 'FORBIDDEN',
    });
    return;
  }

  next();
}

export function requirePermission(permission: PermissionCode) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (!req.authUser || !req.authUser.isAdmin) {
      res.status(403).json({
        error: 'Administrator privileges required.',
        code: 'FORBIDDEN',
      });
      return;
    }

    const hasPerm =
      req.authUser.permissions.includes('*') ||
      req.authUser.permissions.includes(permission);

    if (!hasPerm) {
      await writeAuditLog({
        actorProfileId: req.authUser.profileId,
        actorRole: req.authUser.roleCode,
        action: 'admin.permission_denied',
        resourceType: 'permission',
        resourceId: permission,
        req,
      }).catch(() => undefined);

      res.status(403).json({
        error: `Missing required permission: ${permission}`,
        code: 'INSUFFICIENT_PERMISSION',
      });
      return;
    }

    next();
  };
}

/**
 * CSRF & Origin/Referer verification for browser-initiated state mutations.
 * Webhook endpoints bypass this middleware and authenticate via HMAC signature instead.
 */
export function requireCsrfProtection(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }

  const normalizedUrl = (req.originalUrl || req.path || '').split('?')[0];
  if (normalizedUrl === '/api/payments/webhook' || req.path === '/payments/webhook') {
    next();
    return;
  }

  const customHeader = req.headers['x-requested-with'];
  const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
  const refererHeader = typeof req.headers.referer === 'string' ? req.headers.referer.trim() : '';
  const sourceOrigin = originHeader || refererHeader;

  if (sourceOrigin && !isAllowedOrigin(sourceOrigin, req)) {
    res.status(403).json({
      error: 'Cross-origin mutation rejected.',
      code: 'CSRF_ORIGIN_MISMATCH',
    });
    return;
  }

  const isBrowserContext = Boolean(req.headers.cookie || originHeader || refererHeader);
  if (isBrowserContext && customHeader !== 'LPS-Store-Client') {
    res.status(403).json({
      error: 'Missing required CSRF verification header.',
      code: 'CSRF_HEADER_MISSING',
    });
    return;
  }

  next();
}

interface RateBucket {
  count: number;
  resetAt: number;
}

function pruneExpiredBuckets(buckets: Map<string, RateBucket>, now: number): void {
  if (buckets.size < 2000) return;
  for (const [k, v] of buckets.entries()) {
    if (v.resetAt <= now) {
      buckets.delete(k);
    }
  }
}

export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}) {
  const buckets = new Map<string, RateBucket>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip =
      req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
      req.ip ||
      'unknown';
    const key = `${options.keyPrefix}:${ip}`;
    const now = Date.now();
    pruneExpiredBuckets(buckets, now);
    const existing = buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    if (existing.count >= options.maxRequests) {
      const retrySeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retrySeconds));
      res.status(429).json({
        error: 'Too many requests. Please wait before retrying.',
        code: 'RATE_LIMITED',
      });
      return;
    }

    existing.count += 1;
    next();
  };
}

/**
 * Response-status-aware failed checkout limiter (e.g. max 5 failed checkout attempts/min per IP)
 * to mitigate card-testing and fraudulent checkout probing without blocking normal customers.
 */
export function createFailedCheckoutRateLimiter(options: {
  windowMs: number;
  maxFailures: number;
  keyPrefix: string;
}) {
  const buckets = new Map<string, RateBucket>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip =
      req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
      req.ip ||
      'unknown';
    const key = `${options.keyPrefix}:${ip}`;
    const now = Date.now();
    pruneExpiredBuckets(buckets, now);
    const existing = buckets.get(key);

    if (existing && existing.resetAt > now && existing.count >= options.maxFailures) {
      const retrySeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retrySeconds));
      res.status(429).json({
        error: 'Too many failed checkout attempts. Please wait a minute before retrying.',
        code: 'FAILED_CHECKOUT_RATE_LIMITED',
      });
      return;
    }

    res.once('finish', () => {
      if (res.statusCode >= 400 && res.statusCode !== 429) {
        const finishedNow = Date.now();
        const cur = buckets.get(key);
        if (!cur || cur.resetAt <= finishedNow) {
          buckets.set(key, { count: 1, resetAt: finishedNow + options.windowMs });
        } else {
          cur.count += 1;
        }
      }
    });

    next();
  };
}

