import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { adminRouter } from './src/api/adminRoutes';
import { authRouter } from './src/api/authRoutes';
import { storeRouter } from './src/api/customerRoutes';
import { paymentRouter, type RawBodyRequest } from './src/api/paymentRoutes';
import {
  attachAuthUser,
  createRateLimiter,
  requireCsrfProtection,
  strictCorsProtection,
} from './src/authentication/middleware';
import { getServerEnv } from './src/configuration/env';
import { runMigrations } from './src/database/migrate';
import { getDb, recoverLocalPglite } from './src/database/pool';
import { seedFoundation } from './src/database/seed';
import { getMediaUploadDir } from './src/utilities/mediaStorage';

const apiBaselineRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 180,
  keyPrefix: 'api_global',
});

export async function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  const env = getServerEnv();
  const isProd = env.nodeEnv === 'production';

  // Hardened HTTP security headers compatible with AI Studio preview iframe & Razorpay Checkout
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.razorpay.com")'
    );
    const scriptSrc = isProd
      ? "script-src 'self' https://checkout.razorpay.com https://apis.google.com"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://apis.google.com";
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        scriptSrc,
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' https: http: data: blob:",
        "connect-src 'self' https: ws: wss:",
        "frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://accounts.google.com https://*.firebaseapp.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ')
    );
    const forwardedProto = req.headers['x-forwarded-proto']?.toString().split(',')[0]?.trim();
    if (req.secure || forwardedProto === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  // Preserve raw request buffer for Razorpay webhook HMAC verification; allow 8mb for validated image uploads
  app.use(
    express.json({
      limit: '8mb',
      verify: (req, _res, buf) => {
        (req as RawBodyRequest).rawBody = buf;
      },
    })
  );

  // Serve uploaded storefront media safely (strict UUID.ext allowlist + resolved path containment)
  app.get('/media/:filename', (req, res) => {
    const filename = req.params.filename || '';
    if (!/^[a-f0-9-]+\.(jpg|png|webp)$/i.test(filename)) {
      res.status(404).end();
      return;
    }
    const baseDir = path.resolve(getMediaUploadDir());
    const fullPath = path.resolve(baseDir, path.basename(filename));
    if (!fullPath.startsWith(baseDir + path.sep) || !fs.existsSync(fullPath)) {
      res.status(404).end();
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(fullPath);
  });

  app.use('/api', apiBaselineRateLimiter);
  app.use('/api', strictCorsProtection);
  app.use('/api', attachAuthUser);
  app.use('/api', requireCsrfProtection);

  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/payments', paymentRouter);
  app.use('/api', storeRouter);

  // Unknown API routes return structured JSON 404 rather than falling back to index.html
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.', code: 'NOT_FOUND' });
  });

  // Centralized API error boundary (never leaks stack traces, SQL, or file paths)
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      if (err && typeof err === 'object') {
        const typedErr = err as { type?: string; status?: number };
        if (typedErr.type === 'entity.too.large' || typedErr.status === 413) {
          if (!res.headersSent) {
            res.status(413).json({
              error: 'Request payload exceeds maximum allowed size.',
              code: 'PAYLOAD_TOO_LARGE',
            });
          }
          return;
        }
        if (err instanceof SyntaxError && typedErr.status === 400) {
          if (!res.headersSent) {
            res.status(400).json({
              error: 'Malformed JSON request payload.',
              code: 'INVALID_JSON',
            });
          }
          return;
        }
      }

      console.error('[LPS STORE Server Error]:', err);
      if (!res.headersSent) {
        res.status(500).json({
          error: 'An internal server error occurred.',
          code: 'INTERNAL_ERROR',
        });
      }
    }
  );

  return app;
}

async function startServer() {
  const env = getServerEnv();
  let db = getDb();
  let newlyApplied: string[];
  try {
    newlyApplied = await runMigrations(db);
    await seedFoundation(db);
  } catch (err) {
    if (db.engine === 'pglite' && env.nodeEnv !== 'production') {
      console.warn(
        '[LPS STORE] Local PGlite startup failed after unclean shutdown; rebuilding local .data/pgdata...',
        err instanceof Error ? err.message : err
      );
      db = await recoverLocalPglite();
      newlyApplied = await runMigrations(db);
      await seedFoundation(db);
    } else {
      throw err;
    }
  }

  console.log(
    `[LPS STORE] PostgreSQL (${db.engine}) connected. Migrations applied: ${
      newlyApplied.length ? newlyApplied.join(', ') : 'up to date'
    }`
  );

  const app = await createApp();

  if (env.nodeEnv !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = app.listen(env.port, '0.0.0.0', () => {
    console.log(`[LPS STORE] Server listening on http://0.0.0.0:${env.port}`);
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close();
    try {
      await db.close();
    } catch {
      // Ignore shutdown errors
    }
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

// Start server when run directly
const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  path.basename(process.argv[1]) === 'server.ts';

if (isDirectRun) {
  startServer().catch((err) => {
    console.error('[LPS STORE] Fatal startup failure:', err);
    process.exit(1);
  });
}
