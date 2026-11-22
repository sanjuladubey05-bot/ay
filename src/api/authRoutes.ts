import { Router } from 'express';
import {
  asyncHandler,
  createRateLimiter,
  requireAuth,
  type AuthenticatedRequest,
} from '../authentication/middleware';
import { verifyFirebaseIdToken } from '../authentication/firebaseToken';
import {
  generateOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  verifyPassword,
} from '../authentication/password';
import {
  clearSessionCookie,
  createPersistedSession,
  extractRawSessionToken,
  revokeSessionToken,
  setSessionCookie,
} from '../authentication/session';
import { getServerEnv } from '../configuration/env';
import { writeAuditLog } from '../database/audit';
import { getDb } from '../database/pool';
import type { AuthStatusResponse } from '../types/api';
import {
  adminBootstrapSchema,
  firebaseLoginSchema,
  loginSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  registerCustomerSchema,
} from '../utilities/validation';

export const authRouter = Router();

const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 25,
  keyPrefix: 'auth',
});

async function isAdminBootstrapRequired(): Promise<boolean> {
  const env = getServerEnv();
  if (env.adminBootstrapPassword) {
    return false;
  }
  const db = getDb();
  const res = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM public.admin_users
     WHERE is_owner = TRUE AND is_active = TRUE`
  );
  return Number(res.rows[0]?.count || '0') === 0;
}

authRouter.get('/status', asyncHandler(async (req: AuthenticatedRequest, res) => {
  const env = getServerEnv();
  const bootstrapRequired = await isAdminBootstrapRequired();

  const payload: AuthStatusResponse = {
    authenticated: Boolean(req.authUser),
    user: req.authUser || null,
    adminBootstrapRequired: bootstrapRequired,
    authMode: env.supabaseUrl && env.supabaseAnonKey ? 'supabase_hybrid' : 'local_postgres',
  };

  res.json(payload);
}));

authRouter.post('/admin/bootstrap', authRateLimiter, asyncHandler(async (req, res) => {
  const parsed = adminBootstrapSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Invalid bootstrap input.',
      code: 'VALIDATION_ERROR',
    });
    return;
  }

  const env = getServerEnv();
  if (env.adminBootstrapPassword) {
    res.status(403).json({
      error: 'Admin bootstrap is locked by server configuration.',
      code: 'BOOTSTRAP_LOCKED',
    });
    return;
  }

  const db = getDb();
  const { email, fullName, password } = parsed.data;
  const passwordHash = await hashPassword(password);

  try {
    const profileId = await db.withTransaction(async (tx) => {
      const existingOwner = await tx.query<{ id: string }>(
        'SELECT id FROM public.admin_users WHERE is_owner = TRUE LIMIT 1'
      );
      if (existingOwner.rows.length > 0) {
        throw new Error('BOOTSTRAP_ALREADY_CLAIMED');
      }

      const ownerRole = await tx.query<{ id: string }>(
        `SELECT id FROM public.roles WHERE code = 'owner' LIMIT 1`
      );
      if (!ownerRole.rows[0]) {
        throw new Error('OWNER_ROLE_MISSING');
      }

      const existingProfile = await tx.query<{ id: string }>(
        'SELECT id FROM public.profiles WHERE email = $1 LIMIT 1',
        [email]
      );
      if (existingProfile.rows.length > 0) {
        throw new Error('EMAIL_ALREADY_EXISTS');
      }

      const profRes = await tx.query<{ id: string }>(
        `INSERT INTO public.profiles
           (email, full_name, password_hash, account_status, is_email_verified, last_login_at)
         VALUES ($1, $2, $3, 'active', TRUE, NOW())
         RETURNING id`,
        [email, fullName, passwordHash]
      );
      const newProfileId = profRes.rows[0].id;

      await tx.query(
        `INSERT INTO public.admin_users (profile_id, role_id, is_owner, is_active)
         VALUES ($1, $2, TRUE, TRUE)`,
        [newProfileId, ownerRole.rows[0].id]
      );

      await writeAuditLog(
        {
          actorProfileId: newProfileId,
          actorRole: 'owner',
          action: 'admin.owner_bootstrapped',
          resourceType: 'admin_users',
          resourceId: newProfileId,
          req,
          details: { email },
        },
        tx
      );

      return newProfileId;
    });

    const session = await createPersistedSession({
      profileId,
      roleScope: 'admin',
      req,
    });
    setSessionCookie(res, req, session.rawToken, session.maxAgeSeconds);

    res.status(201).json({
      message: 'Initial Store Owner account created and authenticated.',
      user: {
        profileId,
        email,
        fullName,
        isAdmin: true,
        isOwner: true,
        roleCode: 'owner',
        permissions: ['*'],
        customerId: null,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'BOOTSTRAP_ALREADY_CLAIMED') {
      res.status(403).json({
        error: 'Initial Owner Admin has already been claimed. Public admin registration is disabled.',
        code: 'BOOTSTRAP_LOCKED',
      });
      return;
    }
    if (msg === 'EMAIL_ALREADY_EXISTS') {
      res.status(409).json({
        error: 'An account with this email already exists.',
        code: 'EMAIL_EXISTS',
      });
      return;
    }
    console.error('Admin bootstrap error:', err);
    res.status(500).json({ error: 'Unable to complete owner setup.' });
  }
}));

authRouter.post('/admin/login', authRateLimiter, asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Invalid credentials format.',
      code: 'VALIDATION_ERROR',
    });
    return;
  }

  const { email, password } = parsed.data;
  const db = getDb();

  interface AdminLoginRow {
    profile_id: string;
    email: string;
    full_name: string;
    password_hash: string | null;
    account_status: string;
    admin_active: boolean | null;
    is_owner: boolean | null;
    role_code: string | null;
    permissions: string[] | null;
  }

  const result = await db.query<AdminLoginRow>(
    `SELECT
       p.id AS profile_id,
       p.email,
       p.full_name,
       p.password_hash,
       p.account_status,
       au.is_active AS admin_active,
       au.is_owner,
       r.code AS role_code,
       r.permissions
     FROM public.profiles p
     LEFT JOIN public.admin_users au ON au.profile_id = p.id
     LEFT JOIN public.roles r ON r.id = au.role_id
     WHERE p.email = $1
     LIMIT 1`,
    [email]
  );

  const row = result.rows[0];
  if (!row || !row.password_hash) {
    res.status(401).json({
      error: 'Invalid administrator credentials.',
      code: 'INVALID_CREDENTIALS',
    });
    return;
  }

  const valid = await verifyPassword(password, row.password_hash);
  if (!valid) {
    await writeAuditLog({
      actorProfileId: row.profile_id,
      actorRole: row.role_code || 'customer',
      action: 'admin.login_failed',
      resourceType: 'auth_sessions',
      req,
      details: { reason: 'invalid_password' },
    }).catch(() => undefined);

    res.status(401).json({
      error: 'Invalid administrator credentials.',
      code: 'INVALID_CREDENTIALS',
    });
    return;
  }

  if (row.account_status !== 'active' || !row.admin_active || !row.role_code) {
    await writeAuditLog({
      actorProfileId: row.profile_id,
      actorRole: 'customer',
      action: 'admin.login_rejected_non_admin',
      resourceType: 'admin_users',
      req,
    }).catch(() => undefined);

    res.status(403).json({
      error: 'This account does not have administrator permissions.',
      code: 'ADMIN_ROLE_REQUIRED',
    });
    return;
  }

  await db.query('UPDATE public.profiles SET last_login_at = NOW() WHERE id = $1', [
    row.profile_id,
  ]);

  const session = await createPersistedSession({
    profileId: row.profile_id,
    roleScope: 'admin',
    req,
  });
  setSessionCookie(res, req, session.rawToken, session.maxAgeSeconds);

  await writeAuditLog({
    actorProfileId: row.profile_id,
    actorRole: row.role_code,
    action: 'admin.login_success',
    resourceType: 'auth_sessions',
    req,
  });

  res.json({
    user: {
      profileId: row.profile_id,
      email: row.email,
      fullName: row.full_name,
      isAdmin: true,
      isOwner: Boolean(row.is_owner),
      roleCode: row.role_code,
      permissions: row.permissions || [],
      customerId: null,
    },
  });
}));

authRouter.post('/register', authRateLimiter, asyncHandler(async (req, res) => {
  const parsed = registerCustomerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Invalid registration details.',
      code: 'VALIDATION_ERROR',
    });
    return;
  }

  const { email, password, fullName } = parsed.data;
  const db = getDb();

  const existing = await db.query<{ id: string }>(
    'SELECT id FROM public.profiles WHERE email = $1 LIMIT 1',
    [email]
  );
  if (existing.rows.length > 0) {
    res.status(409).json({
      error: 'An account with this email already exists.',
      code: 'EMAIL_EXISTS',
    });
    return;
  }

  const passwordHash = await hashPassword(password);
  const customerCode = `LPS-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;

  const created = await db.withTransaction(async (tx) => {
    const profRes = await tx.query<{ id: string }>(
      `INSERT INTO public.profiles
         (email, full_name, password_hash, account_status, is_email_verified, last_login_at)
       VALUES ($1, $2, $3, 'active', FALSE, NOW())
       RETURNING id`,
      [email, fullName, passwordHash]
    );
    const profileId = profRes.rows[0].id;

    const custRes = await tx.query<{ id: string }>(
      `INSERT INTO public.customers (profile_id, customer_code)
       VALUES ($1, $2)
       RETURNING id`,
      [profileId, customerCode]
    );

    return { profileId, customerId: custRes.rows[0].id };
  });

  const session = await createPersistedSession({
    profileId: created.profileId,
    roleScope: 'customer',
    req,
  });
  setSessionCookie(res, req, session.rawToken, session.maxAgeSeconds);

  res.status(201).json({
    user: {
      profileId: created.profileId,
      email,
      fullName,
      isAdmin: false,
      isOwner: false,
      roleCode: 'customer',
      permissions: [],
      customerId: created.customerId,
    },
  });
}));

authRouter.post('/login', authRateLimiter, asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Invalid login details.',
      code: 'VALIDATION_ERROR',
    });
    return;
  }

  const { email, password } = parsed.data;
  const db = getDb();

  interface CustomerLoginRow {
    profile_id: string;
    email: string;
    full_name: string;
    password_hash: string | null;
    account_status: string;
    customer_id: string | null;
  }

  const resRow = await db.query<CustomerLoginRow>(
    `SELECT
       p.id AS profile_id,
       p.email,
       p.full_name,
       p.password_hash,
       p.account_status,
       c.id AS customer_id
     FROM public.profiles p
     LEFT JOIN public.customers c ON c.profile_id = p.id
     WHERE p.email = $1
     LIMIT 1`,
    [email]
  );

  const row = resRow.rows[0];
  if (!row || !row.password_hash) {
    res.status(401).json({
      error: 'Invalid email or password.',
      code: 'INVALID_CREDENTIALS',
    });
    return;
  }

  const valid = await verifyPassword(password, row.password_hash);
  if (!valid) {
    res.status(401).json({
      error: 'Invalid email or password.',
      code: 'INVALID_CREDENTIALS',
    });
    return;
  }

  if (row.account_status !== 'active') {
    res.status(403).json({
      error: 'Your account is currently suspended or pending verification.',
      code: 'ACCOUNT_INACTIVE',
    });
    return;
  }

  let customerId = row.customer_id;
  if (!customerId) {
    const customerCode = `LPS-${Date.now().toString(36).toUpperCase()}`;
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO public.customers (profile_id, customer_code)
       VALUES ($1, $2)
       ON CONFLICT (profile_id) DO UPDATE SET profile_id = EXCLUDED.profile_id
       RETURNING id`,
      [row.profile_id, customerCode]
    );
    customerId = inserted.rows[0].id;
  }

  await db.query('UPDATE public.profiles SET last_login_at = NOW() WHERE id = $1', [
    row.profile_id,
  ]);

  const session = await createPersistedSession({
    profileId: row.profile_id,
    roleScope: 'customer',
    req,
  });
  setSessionCookie(res, req, session.rawToken, session.maxAgeSeconds);

  res.json({
    user: {
      profileId: row.profile_id,
      email: row.email,
      fullName: row.full_name,
      isAdmin: false,
      isOwner: false,
      roleCode: 'customer',
      permissions: [],
      customerId,
    },
  });
}));

authRouter.post('/firebase', authRateLimiter, asyncHandler(async (req, res) => {
  const parsed = firebaseLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Invalid Firebase authentication payload.',
      code: 'VALIDATION_ERROR',
    });
    return;
  }

  let claims;
  try {
    claims = await verifyFirebaseIdToken(parsed.data.idToken);
  } catch (err) {
    console.warn('[LPS STORE] Firebase ID token rejected:', err instanceof Error ? err.message : err);
    res.status(401).json({
      error: 'Unable to verify your Google sign-in session. Please try again.',
      code: 'INVALID_FIREBASE_TOKEN',
    });
    return;
  }

  const db = getDb();
  const profileCheck = await db.query<{ id: string; account_status: string; full_name: string }>(
    'SELECT id, account_status, full_name FROM public.profiles WHERE email = $1 LIMIT 1',
    [claims.email]
  );

  let profileId: string;
  let fullName = claims.name;

  if (profileCheck.rows[0]) {
    if (profileCheck.rows[0].account_status !== 'active') {
      res.status(403).json({
        error: 'Your account is currently suspended or pending verification.',
        code: 'ACCOUNT_INACTIVE',
      });
      return;
    }
    profileId = profileCheck.rows[0].id;
    fullName = profileCheck.rows[0].full_name || claims.name;
    await db.query(
      'UPDATE public.profiles SET is_email_verified = TRUE, last_login_at = NOW() WHERE id = $1',
      [profileId]
    );
  } else {
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO public.profiles
         (email, full_name, password_hash, account_status, is_email_verified, last_login_at)
       VALUES ($1, $2, NULL, 'active', TRUE, NOW())
       RETURNING id`,
      [claims.email, fullName]
    );
    profileId = inserted.rows[0].id;
  }

  const custRes = await db.query<{ id: string }>(
    'SELECT id FROM public.customers WHERE profile_id = $1 LIMIT 1',
    [profileId]
  );

  let customerId = custRes.rows[0]?.id || null;
  if (!customerId) {
    const customerCode = `LPS-${Date.now().toString(36).toUpperCase()}-${Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase()}`;
    const createdCust = await db.query<{ id: string }>(
      `INSERT INTO public.customers (profile_id, customer_code)
       VALUES ($1, $2)
       ON CONFLICT (profile_id) DO UPDATE SET profile_id = EXCLUDED.profile_id
       RETURNING id`,
      [profileId, customerCode]
    );
    customerId = createdCust.rows[0].id;
  }

  const session = await createPersistedSession({
    profileId,
    roleScope: 'customer',
    req,
  });
  setSessionCookie(res, req, session.rawToken, session.maxAgeSeconds);

  await writeAuditLog({
    actorProfileId: profileId,
    actorRole: 'customer',
    action: 'customer.firebase_google_login',
    resourceType: 'auth_sessions',
    req,
    details: { firebaseUid: claims.uid },
  }).catch(() => undefined);

  res.json({
    user: {
      profileId,
      email: claims.email,
      fullName,
      isAdmin: false,
      isOwner: false,
      roleCode: 'customer',
      permissions: [],
      customerId,
    },
  });
}));

authRouter.post('/logout', asyncHandler(async (req: AuthenticatedRequest, res) => {
  const rawToken = extractRawSessionToken(req);
  if (rawToken) {
    await revokeSessionToken(rawToken);
  }
  if (req.authUser?.isAdmin) {
    await writeAuditLog({
      actorProfileId: req.authUser.profileId,
      actorRole: req.authUser.roleCode,
      action: 'admin.logout',
      resourceType: 'auth_sessions',
      req,
    }).catch(() => undefined);
  }
  clearSessionCookie(res, req);
  res.json({ ok: true });
}));

authRouter.post('/password-reset/request', authRateLimiter, asyncHandler(async (req, res) => {
  const parsed = passwordResetRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Enter a valid email.',
      code: 'VALIDATION_ERROR',
    });
    return;
  }

  const db = getDb();
  const { email } = parsed.data;
  const prof = await db.query<{ id: string }>(
    'SELECT id FROM public.profiles WHERE email = $1 LIMIT 1',
    [email]
  );

  if (prof.rows[0]) {
    const rawResetToken = generateOpaqueToken(32);
    const tokenHash = hashOpaqueToken(rawResetToken);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const ip =
      req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.ip || null;

    await db.query(
      `INSERT INTO public.password_reset_tokens (profile_id, token_hash, expires_at, requested_ip)
       VALUES ($1, $2, $3, $4)`,
      [prof.rows[0].id, tokenHash, expiresAt, ip]
    );

    await writeAuditLog({
      actorProfileId: prof.rows[0].id,
      actorRole: 'user',
      action: 'auth.password_reset_requested',
      resourceType: 'password_reset_tokens',
      req,
    }).catch(() => undefined);
  }

  // Always return a uniform response to prevent account enumeration
  res.json({
    message:
      'Password reset architecture recorded the request. Once an email provider or Supabase Auth SMTP is configured, a single-use reset link will be dispatched.',
  });
}));

authRouter.post('/password-reset/confirm', authRateLimiter, asyncHandler(async (req, res) => {
  const parsed = passwordResetConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Invalid reset request.',
      code: 'VALIDATION_ERROR',
    });
    return;
  }

  const db = getDb();
  const tokenHash = hashOpaqueToken(parsed.data.token);
  const newHash = await hashPassword(parsed.data.newPassword);

  const updated = await db.withTransaction(async (tx) => {
    const tokenRes = await tx.query<{ id: string; profile_id: string }>(
      `SELECT id, profile_id
       FROM public.password_reset_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
       LIMIT 1`,
      [tokenHash]
    );

    const row = tokenRes.rows[0];
    if (!row) {
      return false;
    }

    await tx.query('UPDATE public.profiles SET password_hash = $1 WHERE id = $2', [
      newHash,
      row.profile_id,
    ]);
    await tx.query('UPDATE public.password_reset_tokens SET used_at = NOW() WHERE id = $1', [
      row.id,
    ]);
    await tx.query(
      'UPDATE public.auth_sessions SET revoked_at = NOW() WHERE profile_id = $1 AND revoked_at IS NULL',
      [row.profile_id]
    );

    await writeAuditLog(
      {
        actorProfileId: row.profile_id,
        actorRole: 'user',
        action: 'auth.password_reset_completed',
        resourceType: 'profiles',
        resourceId: row.profile_id,
        req,
      },
      tx
    );

    return true;
  });

  if (!updated) {
    res.status(400).json({
      error: 'Reset token is invalid or expired.',
      code: 'INVALID_RESET_TOKEN',
    });
    return;
  }

  res.json({ message: 'Password updated and existing sessions revoked.' });
}));

authRouter.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.authUser });
});
