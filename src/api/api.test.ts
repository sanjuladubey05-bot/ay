import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { createApp } from '../../server';
import { runMigrations } from '../database/migrate';
import { createPgliteAdapter, resetDbForTests, setDbForTests } from '../database/pool';
import { seedFoundation } from '../database/seed';

async function startTestServer() {
  const prevUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  await resetDbForTests();

  const db = createPgliteAdapter('memory://');
  setDbForTests(db);
  await runMigrations(db);
  await seedFoundation(db);

  const app = await createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    cleanup: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await resetDbForTests();
      if (prevUrl) process.env.DATABASE_URL = prevUrl;
    },
  };
}

function extractCookie(setCookieHeader: string | null): string {
  if (!setCookieHeader) return '';
  return setCookieHeader.split(';')[0];
}

test('API security boundaries: customer isolation, owner bootstrap lock, and Razorpay guardrails', async () => {
  const { baseUrl, cleanup } = await startTestServer();
  try {
    const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // 1. Health endpoint
    const health = await fetch(`${baseUrl}/api/store/health`);
    assert.equal(health.status, 200);
    const healthJson = (await health.json()) as { ok: boolean; databaseConnected: boolean };
    assert.equal(healthJson.ok, true);
    assert.equal(healthJson.databaseConnected, true);

    // 2. Unauthenticated rejection on protected routes
    const unauthAdmin = await fetch(`${baseUrl}/api/admin/overview`);
    assert.equal(unauthAdmin.status, 401);

    const unauthOrders = await fetch(`${baseUrl}/api/customer/orders`);
    assert.equal(unauthOrders.status, 401);

    // 3. Customer registration rejects role tampering (.strict())
    const tamperReg = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        email: `tamper_${uniqueSuffix}@example.com`,
        fullName: 'Tamper User',
        password: 'StrongPassword123!',
        role: 'owner',
      }),
    });
    assert.equal(tamperReg.status, 400);

    // 4. Valid customer registration
    const custReg = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        email: `cust_${uniqueSuffix}@example.com`,
        fullName: 'Customer One',
        password: 'StrongPassword123!',
      }),
    });
    assert.equal(custReg.status, 201);
    const custCookie = extractCookie(custReg.headers.get('set-cookie'));
    assert.ok(custCookie.startsWith('lps_session='));

    // 5. Normal customer CANNOT access admin overview, settings, or refund endpoints
    const custAdminOverview = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { Cookie: custCookie },
    });
    assert.equal(custAdminOverview.status, 403);

    const custRefund = await fetch(`${baseUrl}/api/payments/refund`, {
      method: 'POST',
      headers: {
        Cookie: custCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        paymentId: crypto.randomUUID(),
        reason: 'Unauthorized test',
      }),
    });
    assert.equal(custRefund.status, 403);

    // 6. Payment create-order rejects missing Razorpay credentials safely (503)
    const createOrder = await fetch(`${baseUrl}/api/payments/create-order`, {
      method: 'POST',
      headers: {
        Cookie: custCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        packageId: crypto.randomUUID(),
        targetPlayerUid: 'PLAYER123',
      }),
    });
    assert.equal(createOrder.status, 503);
    const createOrderJson = (await createOrder.json()) as { code: string; configured: boolean };
    assert.equal(createOrderJson.code, 'MISSING_CREDENTIALS');
    assert.equal(createOrderJson.configured, false);

    // 7. Webhook rejects when secret is unconfigured (503)
    const webhookRes = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'payment.captured' }),
    });
    assert.equal(webhookRes.status, 503);

    // 8. Owner admin one-time bootstrap works once and permanently locks afterwards
    const bootRes = await fetch(`${baseUrl}/api/auth/admin/bootstrap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        email: `owner_${uniqueSuffix}@lpsstore.com`,
        fullName: 'LPS Owner',
        password: 'OwnerUltraSecurePassword123!',
      }),
    });
    assert.equal(bootRes.status, 201);
    const adminCookie = extractCookie(bootRes.headers.get('set-cookie'));
    assert.ok(adminCookie.startsWith('lps_session='));

    const secondBoot = await fetch(`${baseUrl}/api/auth/admin/bootstrap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        email: `attacker_${uniqueSuffix}@lpsstore.com`,
        fullName: 'Attacker',
        password: 'AttackerPassword123!',
      }),
    });
    assert.equal(secondBoot.status, 403);

    // 9. Owner Admin can read overview and settings, but cannot switch to LIVE without readiness
    const adminOverview = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { Cookie: adminCookie },
    });
    assert.equal(adminOverview.status, 200);
    const overviewJson = (await adminOverview.json()) as {
      database: { coreTablesPresent: number; rlsEnabledTables: number };
      paymentGateway: { mode: string };
    };
    assert.equal(overviewJson.database.coreTablesPresent, 21);
    assert.equal(overviewJson.database.rlsEnabledTables, 21);
    assert.equal(overviewJson.paymentGateway.mode, 'test');

    const switchLive = await fetch(`${baseUrl}/api/admin/settings/payment-mode`, {
      method: 'PATCH',
      headers: {
        Cookie: adminCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({ mode: 'live' }),
    });
    assert.equal(switchLive.status, 400);
    const liveErr = (await switchLive.json()) as { code: string; blockers: string[] };
    assert.equal(liveErr.code, 'LIVE_MODE_BLOCKED');
    assert.ok(liveErr.blockers.length > 0);
  } finally {
    await cleanup();
  }
});
