import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../../server';
import { runMigrations } from '../database/migrate';
import { createPgliteAdapter, resetDbForTests, setDbForTests } from '../database/pool';
import { seedFoundation } from '../database/seed';
import type {
  CustomerOrderItemView,
  PlaceOrderResponse,
  StoreGameDetailResponse,
  StoreGamesListResponse,
} from '../types/api';

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

test('Phase 2 storefront: catalog queries, server-verified pending order, RLS isolation, and admin reflection', async () => {
  const { baseUrl, cleanup } = await startTestServer();
  try {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // 1. Catalog list & search/category filters load dynamically from DB
    const listRes = await fetch(`${baseUrl}/api/store/games`);
    assert.equal(listRes.status, 200);
    const listJson = (await listRes.json()) as StoreGamesListResponse;
    assert.ok(listJson.games.length >= 4);
    assert.ok(listJson.categories.includes('FPS'));

    const searchRes = await fetch(`${baseUrl}/api/store/games?search=Royal`);
    const searchJson = (await searchRes.json()) as StoreGamesListResponse;
    assert.equal(searchJson.games.length, 1);
    assert.equal(searchJson.games[0].slug, 'royal-drop');

    // 2. Game detail loads currencies, regions, packages, and dynamic playerFields
    const detailRes = await fetch(`${baseUrl}/api/store/games/royal-drop`);
    assert.equal(detailRes.status, 200);
    const detailJson = (await detailRes.json()) as StoreGameDetailResponse;
    assert.ok(detailJson.game.packages.length >= 3);
    assert.ok(detailJson.game.regions.length >= 1);
    assert.ok(detailJson.game.currencies.some((c) => c.code === 'INR'));
    assert.ok(detailJson.game.playerFields.some((f) => f.key === 'player_id'));

    const chosenPkg = detailJson.game.packages[0];
    const chosenRegion = detailJson.game.regions[0];

    // 3. Register Customer A and Customer B
    const regA = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        email: `cust_a_${suffix}@example.com`,
        fullName: 'Customer Alpha',
        password: 'StrongPassword123!',
      }),
    });
    assert.equal(regA.status, 201);
    const cookieA = extractCookie(regA.headers.get('set-cookie'));

    const regB = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        email: `cust_b_${suffix}@example.com`,
        fullName: 'Customer Beta',
        password: 'StrongPassword123!',
      }),
    });
    assert.equal(regB.status, 201);
    const cookieB = extractCookie(regB.headers.get('set-cookie'));

    // 4. Reject order missing required dynamic Player ID field
    const invalidOrder = await fetch(`${baseUrl}/api/orders/place`, {
      method: 'POST',
      headers: {
        Cookie: cookieA,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        packageId: chosenPkg.id,
        regionId: chosenRegion.id,
        quantity: 1,
        playerDetails: { player_id: '' },
      }),
    });
    assert.equal(invalidOrder.status, 400);

    // 5. Place valid safe pending order (no payment collected, server calculates total)
    const placeRes = await fetch(`${baseUrl}/api/orders/place`, {
      method: 'POST',
      headers: {
        Cookie: cookieA,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        packageId: chosenPkg.id,
        regionId: chosenRegion.id,
        quantity: 2,
        playerDetails: { player_id: '5129482710' },
      }),
    });
    assert.equal(placeRes.status, 201);
    const placed = (await placeRes.json()) as PlaceOrderResponse;
    assert.equal(placed.status, 'payment_pending');
    assert.equal(placed.paymentStatus, 'pending');
    assert.equal(placed.totalInr, Number((chosenPkg.priceInr * 2).toFixed(2)));
    assert.match(placed.paymentNotice, /Payment options will be available soon\./);

    // 6. Customer A sees their order; Customer B cannot see Customer A's order (RLS isolation)
    const ordersARes = await fetch(`${baseUrl}/api/customer/orders`, {
      headers: { Cookie: cookieA },
    });
    assert.equal(ordersARes.status, 200);
    const ordersA = (await ordersARes.json()) as { orders: CustomerOrderItemView[] };
    assert.equal(ordersA.orders.length, 1);
    assert.equal(ordersA.orders[0].orderNumber, placed.orderNumber);
    assert.equal(ordersA.orders[0].displayOrderStatus, 'Payment Pending');
    assert.equal(ordersA.orders[0].displayDeliveryStatus, 'Pending');

    const ordersBRes = await fetch(`${baseUrl}/api/customer/orders`, {
      headers: { Cookie: cookieB },
    });
    assert.equal(ordersBRes.status, 200);
    const ordersB = (await ordersBRes.json()) as { orders: CustomerOrderItemView[] };
    assert.equal(ordersB.orders.length, 0);

    // 7. Admin catalog edits reflect immediately on storefront
    const bootRes = await fetch(`${baseUrl}/api/auth/admin/bootstrap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        email: `owner_${suffix}@lpsstore.com`,
        fullName: 'Store Owner',
        password: 'OwnerUltraSecurePassword123!',
      }),
    });
    assert.equal(bootRes.status, 201);
    const adminCookie = extractCookie(bootRes.headers.get('set-cookie'));

    // Reject sensitive playerFields even from admin API
    const badGameRes = await fetch(`${baseUrl}/api/admin/catalog/games`, {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        slug: `bad-game-${suffix}`,
        title: 'Bad Game',
        publisher: 'Studio',
        category: 'RPG',
        description: 'Should be rejected for requesting password.',
        playerFields: [{ key: 'account_password', label: 'Account Password', type: 'text', required: true }],
      }),
    });
    assert.equal(badGameRes.status, 400);

    // Create new game + package + reprice + disable game
    const newGameRes = await fetch(`${baseUrl}/api/admin/catalog/games`, {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        slug: 'cyber-drift',
        title: 'Cyber Drift',
        publisher: 'Drift Labs',
        category: 'Racing',
        description: 'Nitro credits top-up by Driver ID.',
        coverImageUrl: '/src/assets/images/catalog_obsidian_card_1795267139390.jpg',
        isActive: true,
        isFeatured: true,
        playerFields: [{ key: 'driver_id', label: 'Driver ID', type: 'text', required: true }],
      }),
    });
    assert.equal(newGameRes.status, 201);
    const { game: createdGame } = (await newGameRes.json()) as { game: { id: string } };

    const newPkgRes = await fetch(`${baseUrl}/api/admin/catalog/packages`, {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        gameId: createdGame.id,
        sku: `CD-NITRO-${suffix}`,
        name: '500 Nitro Credits',
        inGameAmount: 500,
        inGameUnit: 'Nitro',
        priceInr: 299,
      }),
    });
    assert.equal(newPkgRes.status, 201);
    const { package: createdPkg } = (await newPkgRes.json()) as { package: { id: string } };

    // Update package price -> storefront shows updated price
    const repriceRes = await fetch(`${baseUrl}/api/admin/catalog/packages/${createdPkg.id}`, {
      method: 'PATCH',
      headers: {
        Cookie: adminCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({ priceInr: 349 }),
    });
    assert.equal(repriceRes.status, 200);

    const cyberDetail = await fetch(`${baseUrl}/api/store/games/cyber-drift`);
    assert.equal(cyberDetail.status, 200);
    const cyberJson = (await cyberDetail.json()) as StoreGameDetailResponse;
    assert.equal(cyberJson.game.packages[0].priceInr, 349);

    // Disable game -> hidden from storefront & returns 404 on detail & order
    const disableRes = await fetch(`${baseUrl}/api/admin/catalog/games/${createdGame.id}`, {
      method: 'PATCH',
      headers: {
        Cookie: adminCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(disableRes.status, 200);

    const disabledDetail = await fetch(`${baseUrl}/api/store/games/cyber-drift`);
    assert.equal(disabledDetail.status, 404);
  } finally {
    await cleanup();
  }
});
