import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../../server';
import { hashPassword } from '../authentication/password';
import { getAppliedMigrations, runMigrations } from '../database/migrate';
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
    db,
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

test('Security hardening & blueprint features: SSRF, URL XSS, UUID params, RBAC, CORS/CSRF, regions, analytics & failed checkout limiter', async () => {
  const { db, baseUrl, cleanup } = await startTestServer();
  try {
    // 1. Migrations include 0007 blueprint enhancements
    const applied = await getAppliedMigrations(db);
    assert.ok(applied.includes('0007_blueprint_enhancements.sql'));

    // 2. Security headers set on HTTP responses, X-Powered-By disabled
    const health = await fetch(`${baseUrl}/api/store/health`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(health.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(health.headers.get('x-powered-by'), null);
    assert.ok(health.headers.get('content-security-policy')?.includes("default-src 'self'"));

    // 3. Cross-origin request denied strictly without wildcard *
    const badCors = await fetch(`${baseUrl}/api/store/health`, {
      headers: { Origin: 'https://evil-attacker.example' },
    });
    assert.equal(badCors.status, 403);
    assert.equal(badCors.headers.get('access-control-allow-origin'), null);

    // Bootstrap owner admin
    const bootRes = await fetch(`${baseUrl}/api/auth/admin/bootstrap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        email: 'owner.sec@lpsstore.com',
        fullName: 'Security Owner',
        password: 'OwnerUltraSecurePassword123!',
      }),
    });
    assert.equal(bootRes.status, 201);
    const ownerCookie = extractCookie(bootRes.headers.get('set-cookie'));

    // 4. CSRF rejection on cookie-authenticated POST without X-Requested-With
    const csrfBlocked = await fetch(`${baseUrl}/api/admin/catalog/games`, {
      method: 'POST',
      headers: {
        Cookie: ownerCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ slug: 'x', title: 'X', category: 'Action' }),
    });
    assert.equal(csrfBlocked.status, 403);
    const csrfErr = (await csrfBlocked.json()) as { code: string };
    assert.equal(csrfErr.code, 'CSRF_HEADER_MISSING');

    // 5. Malformed UUID route parameter returns clean 400 VALIDATION_ERROR without SQL error leak
    const badUuidRes = await fetch(`${baseUrl}/api/admin/orders/not-a-uuid`, {
      headers: { Cookie: ownerCookie },
    });
    assert.equal(badUuidRes.status, 400);
    const badUuidJson = (await badUuidRes.json()) as { code: string; error: string };
    assert.equal(badUuidJson.code, 'VALIDATION_ERROR');
    assert.doesNotMatch(badUuidJson.error, /syntax|uuid|postgres/i);

    const badPayStatus = await fetch(`${baseUrl}/api/payments/status?orderId=not-a-uuid`, {
      headers: { Cookie: ownerCookie },
    });
    assert.equal(badPayStatus.status, 400);

    // 6. SSRF / internal URL rejection on supplier creation
    for (const blockedUrl of [
      'http://api.supplier.example',
      'https://127.0.0.1/admin',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/internal',
      'https://user:pass@supplier.example/api',
    ]) {
      const supRes = await fetch(`${baseUrl}/api/admin/suppliers`, {
        method: 'POST',
        headers: {
          Cookie: ownerCookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'LPS-Store-Client',
        },
        body: JSON.stringify({
          name: 'Blocked Supplier',
          code: `blocked_${Math.random().toString(36).slice(2, 7)}`,
          integrationType: 'api',
          mode: 'live',
          apiBaseUrl: blockedUrl,
        }),
      });
      assert.equal(supRes.status, 400, `Expected 400 for ${blockedUrl}`);
    }

    // 7. Stored XSS / javascript: URI rejection in website-settings and games
    const xssSettings = await fetch(`${baseUrl}/api/admin/website-settings`, {
      method: 'PATCH',
      headers: {
        Cookie: ownerCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        storeName: 'LPS STORE',
        storeLogoUrl: 'javascript:alert(1)',
        heroHeading: 'LEVEL UP',
        heroSubtitle: 'Sub',
        supportEmail: 'support@lpsstore.com',
        whatsappContact: '+91 00000 00000',
        footerDescription: 'Desc',
        supportHours: '24/7',
        supportNote: 'Note',
        announcementEnabled: false,
        announcementText: '',
        socialLinks: {
          discord: '',
          instagram: 'javascript:alert(2)',
          youtube: '',
          x: '',
        },
      }),
    });
    assert.equal(xssSettings.status, 400);

    const xssGameCover = await fetch(`${baseUrl}/api/admin/catalog/games`, {
      method: 'POST',
      headers: {
        Cookie: ownerCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        slug: 'xss-cover-game',
        title: 'XSS Cover Game',
        category: 'Action',
        coverImageUrl: 'javascript:alert(1)',
      }),
    });
    assert.equal(xssGameCover.status, 400);

    // 8. ReDoS / unsafe regex rejection in game playerFields
    const badRegexGame = await fetch(`${baseUrl}/api/admin/catalog/games`, {
      method: 'POST',
      headers: {
        Cookie: ownerCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        slug: 'unsafe-regex-game',
        title: 'Unsafe Regex Game',
        category: 'Battle Royale',
        playerFields: [
          {
            key: 'player_id',
            label: 'Player ID',
            type: 'text',
            required: true,
            validationRegex: '(a|aa)+$',
          },
        ],
      }),
    });
    assert.equal(badRegexGame.status, 400);
    const regexJson = (await badRegexGame.json()) as { code: string };
    assert.equal(regexJson.code, 'INVALID_VALIDATION_REGEX');

    // 9. Blueprint features: Game with safe regex, Regions CRUD, bonusBadge, supplierCostInr & Pricing Margin update
    const gameCreate = await fetch(`${baseUrl}/api/admin/catalog/games`, {
      method: 'POST',
      headers: {
        Cookie: ownerCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        slug: 'blueprint-arena',
        title: 'Blueprint Arena',
        category: 'Battle Royale',
        playerFields: [
          {
            key: 'player_id',
            label: 'Player UID',
            type: 'text',
            required: true,
            validationRegex: '^[0-9]{6,10}$',
            validationMessage: 'Player UID must be 6 to 10 digits.',
          },
        ],
      }),
    });
    assert.equal(gameCreate.status, 201);
    const { game } = (await gameCreate.json()) as { game: { id: string } };

    // Region CRUD
    const regionCreate = await fetch(`${baseUrl}/api/admin/catalog/games/${game.id}/regions`, {
      method: 'POST',
      headers: {
        Cookie: ownerCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        regionCode: 'IND',
        regionName: 'India',
        serverHint: 'Mumbai',
        isActive: true,
      }),
    });
    assert.equal(regionCreate.status, 201);
    const { region } = (await regionCreate.json()) as { region: { id: string } };

    // Package with bonusBadge & supplierCostInr
    const pkgCreate = await fetch(`${baseUrl}/api/admin/catalog/packages`, {
      method: 'POST',
      headers: {
        Cookie: ownerCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        gameId: game.id,
        sku: 'BPA-500',
        name: '500 Gems',
        inGameAmount: 500,
        inGameUnit: 'Gems',
        priceInr: 400,
        originalPriceInr: 500,
        bonusBadge: '+50 Bonus',
        supplierCostInr: 300,
        isActive: true,
      }),
    });
    assert.equal(pkgCreate.status, 201);
    const { package: createdPkg } = (await pkgCreate.json()) as { package: { id: string } };

    // Inline pricing update computes netProfit & marginPercent
    const pricePatch = await fetch(`${baseUrl}/api/admin/catalog/packages/${createdPkg.id}/price`, {
      method: 'PATCH',
      headers: {
        Cookie: ownerCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        priceInr: 500,
        supplierCostInr: 350,
        bonusBadge: '+75 Bonus',
      }),
    });
    assert.equal(pricePatch.status, 200);
    const pricePatchJson = (await pricePatch.json()) as {
      netProfitInr: number;
      marginPercent: number;
      bonusBadge: string;
    };
    assert.equal(pricePatchJson.netProfitInr, 150);
    assert.equal(pricePatchJson.marginPercent, 30);
    assert.equal(pricePatchJson.bonusBadge, '+75 Bonus');

    // 10. Support role admin CANNOT view audit logs in /admin/overview
    const supportRoleRes = await db.query<{ id: string }>(
      `SELECT id FROM public.roles WHERE code = 'support' LIMIT 1`
    );
    const supportPass = await hashPassword('SupportStrongPassword123!');
    const supportProf = await db.query<{ id: string }>(
      `INSERT INTO public.profiles (email, full_name, password_hash, account_status, is_email_verified)
       VALUES ('support.sec@lpsstore.com', 'Support Agent', $1, 'active', TRUE)
       RETURNING id`,
      [supportPass]
    );
    await db.query(
      `INSERT INTO public.admin_users (profile_id, role_id, is_owner, is_active)
       VALUES ($1, $2, FALSE, TRUE)`,
      [supportProf.rows[0].id, supportRoleRes.rows[0].id]
    );

    const supportLogin = await fetch(`${baseUrl}/api/auth/admin/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        email: 'support.sec@lpsstore.com',
        password: 'SupportStrongPassword123!',
      }),
    });
    assert.equal(supportLogin.status, 200);
    const supportCookie = extractCookie(supportLogin.headers.get('set-cookie'));

    const supportOverview = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { Cookie: supportCookie },
    });
    assert.equal(supportOverview.status, 200);
    const supOvJson = (await supportOverview.json()) as {
      recentAuditLogs: unknown[];
      salesAnalytics: { periods: { all: { grossRevenueInr: number } } };
    };
    assert.equal(supOvJson.recentAuditLogs.length, 0);

    // 11. Customer places valid order -> supplierCostInr & netProfitInr snapshot + failed checkout 429 rate limit
    const custReg = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        email: 'buyer.sec@example.com',
        fullName: 'Buyer One',
        password: 'BuyerStrongPassword123!',
      }),
    });
    assert.equal(custReg.status, 201);
    const buyerCookie = extractCookie(custReg.headers.get('set-cookie'));

    const validOrder = await fetch(`${baseUrl}/api/orders/place`, {
      method: 'POST',
      headers: {
        Cookie: buyerCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        packageId: createdPkg.id,
        regionId: region.id,
        quantity: 2,
        playerDetails: { player_id: '98765432' },
      }),
    });
    assert.equal(validOrder.status, 201);
    const validOrderJson = (await validOrder.json()) as { orderId: string; orderNumber: string };

    // Second customer CANNOT view Buyer One's orders or payment status
    const buyerBReg = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        email: 'buyer.b.sec@example.com',
        fullName: 'Buyer Two',
        password: 'BuyerTwoStrongPassword123!',
      }),
    });
    assert.equal(buyerBReg.status, 201);
    const buyerBCookie = extractCookie(buyerBReg.headers.get('set-cookie'));

    const buyerBOrders = await fetch(`${baseUrl}/api/customer/orders`, {
      headers: { Cookie: buyerBCookie },
    });
    assert.equal(buyerBOrders.status, 200);
    const buyerBOrdersJson = (await buyerBOrders.json()) as { orders: unknown[] };
    assert.equal(buyerBOrdersJson.orders.length, 0);

    const buyerBPayStatus = await fetch(
      `${baseUrl}/api/payments/status?orderId=${encodeURIComponent(validOrderJson.orderId)}`,
      { headers: { Cookie: buyerBCookie } }
    );
    assert.equal(buyerBPayStatus.status, 404);

    // Owner sees order cost snapshot and sales analytics
    const ownerOrders = await fetch(
      `${baseUrl}/api/admin/orders?search=${encodeURIComponent(validOrderJson.orderNumber)}`,
      { headers: { Cookie: ownerCookie } }
    );
    assert.equal(ownerOrders.status, 200);
    const ownerOrdersJson = (await ownerOrders.json()) as {
      orders: Array<{ totalInr: number; supplierCostInr: number; netProfitInr: number }>;
    };
    assert.equal(ownerOrdersJson.orders.length, 1);
    assert.equal(ownerOrdersJson.orders[0].totalInr, 1000);
    assert.equal(ownerOrdersJson.orders[0].supplierCostInr, 700);
    assert.equal(ownerOrdersJson.orders[0].netProfitInr, 300);

    const ownerOverview = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { Cookie: ownerCookie },
    });
    const ownerOvJson = (await ownerOverview.json()) as {
      recentAuditLogs: unknown[];
      salesAnalytics: { periods: { all: { grossRevenueInr: number; netProfitInr: number } } };
    };
    assert.ok(ownerOvJson.recentAuditLogs.length > 0);
    assert.ok(ownerOvJson.salesAnalytics.periods.all.grossRevenueInr >= 1000);

    // 5 failed checkout attempts -> 6th returns 429 FAILED_CHECKOUT_RATE_LIMITED
    for (let i = 0; i < 5; i++) {
      const badOrder = await fetch(`${baseUrl}/api/orders/place`, {
        method: 'POST',
        headers: {
          Cookie: buyerCookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'LPS-Store-Client',
          'X-Forwarded-For': '203.0.113.99',
        },
        body: JSON.stringify({
          packageId: createdPkg.id,
          regionId: region.id,
          quantity: 1,
          playerDetails: { player_id: 'BAD' },
        }),
      });
      assert.equal(badOrder.status, 400);
    }

    const rateLimitedOrder = await fetch(`${baseUrl}/api/orders/place`, {
      method: 'POST',
      headers: {
        Cookie: buyerCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
        'X-Forwarded-For': '203.0.113.99',
      },
      body: JSON.stringify({
        packageId: createdPkg.id,
        regionId: region.id,
        quantity: 1,
        playerDetails: { player_id: '98765432' },
      }),
    });
    assert.equal(rateLimitedOrder.status, 429);
    const rateJson = (await rateLimitedOrder.json()) as { code: string };
    assert.equal(rateJson.code, 'FAILED_CHECKOUT_RATE_LIMITED');
  } finally {
    await cleanup();
  }
});
