import type { Request, Response } from 'express';
import { getDb } from '../database/pool';
import type { AuthenticatedUser } from '../types/api';
import type { AdminRoleCode, PermissionCode } from '../types/database';
import { generateOpaqueToken, hashOpaqueToken } from './password';

export const SESSION_COOKIE_NAME = 'lps_session';

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) {
    return result;
  }

  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(value);
      } catch {
        result[key] = value;
      }
    }
  }

  return result;
}

function isHttpsRequest(req: Request): boolean {
  const forwardedProto = req.headers['x-forwarded-proto'];
  if (typeof forwardedProto === 'string' && forwardedProto.split(',')[0].trim() === 'https') {
    return true;
  }
  return req.secure || req.protocol === 'https';
}

export function setSessionCookie(
  res: Response,
  req: Request,
  rawToken: string,
  maxAgeSeconds: number
): void {
  const isHttps = isHttpsRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (isHttps) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }

  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res: Response, req: Request): void {
  const isHttps = isHttpsRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
  ];

  if (isHttps) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }

  res.setHeader('Set-Cookie', parts.join('; '));
}

export async function createPersistedSession(params: {
  profileId: string;
  roleScope: 'customer' | 'admin';
  req: Request;
}): Promise<{ rawToken: string; expiresAt: Date; maxAgeSeconds: number }> {
  const db = getDb();
  const rawToken = generateOpaqueToken(32);
  const tokenHash = hashOpaqueToken(rawToken);
  const maxAgeSeconds = params.roleScope === 'admin' ? 60 * 60 * 12 : 60 * 60 * 24 * 7;
  const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000);

  const ip =
    params.req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
    params.req.ip ||
    null;
  const userAgent = params.req.headers['user-agent']?.slice(0, 240) || null;

  await db.query(
    `INSERT INTO public.auth_sessions
       (profile_id, token_hash, role_scope, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [params.profileId, tokenHash, params.roleScope, ip, userAgent, expiresAt.toISOString()]
  );

  return { rawToken, expiresAt, maxAgeSeconds };
}

export function extractRawSessionToken(req: Request): string | null {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[SESSION_COOKIE_NAME]) {
    return cookies[SESSION_COOKIE_NAME];
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token) return token;
  }

  return null;
}

export async function resolveSessionUser(req: Request): Promise<AuthenticatedUser | null> {
  const rawToken = extractRawSessionToken(req);
  if (!rawToken) {
    return null;
  }

  const tokenHash = hashOpaqueToken(rawToken);
  const db = getDb();

  interface SessionJoinRow {
    profile_id: string;
    email: string;
    full_name: string;
    account_status: string;
    role_scope: 'customer' | 'admin';
    admin_active: boolean | null;
    is_owner: boolean | null;
    role_code: AdminRoleCode | null;
    permissions: PermissionCode[] | null;
    customer_id: string | null;
  }

  const res = await db.query<SessionJoinRow>(
    `SELECT
       p.id AS profile_id,
       p.email,
       p.full_name,
       p.account_status,
       s.role_scope,
       au.is_active AS admin_active,
       au.is_owner,
       r.code AS role_code,
       r.permissions,
       c.id AS customer_id
     FROM public.auth_sessions s
     JOIN public.profiles p ON p.id = s.profile_id
     LEFT JOIN public.admin_users au ON au.profile_id = p.id
     LEFT JOIN public.roles r ON r.id = au.role_id
     LEFT JOIN public.customers c ON c.profile_id = p.id
     WHERE s.token_hash = $1
       AND s.revoked_at IS NULL
       AND s.expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );

  const row = res.rows[0];
  if (!row || row.account_status !== 'active') {
    return null;
  }

  const isAdmin = Boolean(row.admin_active && row.role_code && row.role_scope === 'admin');
  const permissions: PermissionCode[] = isAdmin && Array.isArray(row.permissions) ? row.permissions : [];

  return {
    profileId: row.profile_id,
    email: row.email,
    fullName: row.full_name,
    isAdmin,
    isOwner: Boolean(isAdmin && row.is_owner),
    roleCode: isAdmin && row.role_code ? row.role_code : 'customer',
    permissions,
    customerId: row.customer_id,
  };
}

export async function revokeSessionToken(rawToken: string): Promise<void> {
  if (!rawToken) return;
  const tokenHash = hashOpaqueToken(rawToken);
  const db = getDb();
  await db.query(
    `UPDATE public.auth_sessions
     SET revoked_at = NOW()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash]
  );
}
