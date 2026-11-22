import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../../server';
import { runMigrations } from '../database/migrate';
import { createPgliteAdapter, resetDbForTests, setDbForTests } from '../database/pool';
import { seedFoundation } from '../database/seed';
import type {
  AdminOrderItem,
  AdminOverviewResponse,
  AdminSupplierItem,
  CustomerOrderItemView,
  PlaceOrderResponse,
  StoreGameDetailResponse,
} from '../types/api';

async function startPhase34TestServer() {
  const prevUrl = process.env.DATABASE_URL;
  const prevUploadDir = process.env.LPS_MEDIA_UPLOAD_DIR;
  delete process.env.DATABASE_URL;

  const tmpUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lps-media-test-'));
  process.env.LPS_MEDIA_UPLOAD_DIR = tmpUploadDir;

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
      fs.rmSync(tmpUploadDir, { recursive: true, force: true });
      if (prevUrl) process.env.DATABASE_URL = prevUrl;
      if (prevUploadDir) process.env.LPS_MEDIA_UPLOAD_DIR = prevUploadDir;
      else delete process.env.LPS_MEDIA_UPLOAD_DIR;
    },
  };
}

function extractCookie(setCookieHeader: string | null): string {
  if (!setCookieHeader) return '';
  return setCookieHeader.split(';')[0];
}

// 1x1 transparent PNG in base64 for media upload test
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

test('Phase 3 & Phase 4: admin RBAC, catalog CRUD, media safety, duplicate prevention, manual confirmation & mock supplier delivery', async () => {
  const { baseUrl, cleanup } = await startPhase34TestServer();
  try {
    const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`.replace(/[^a-z0-9]/g, '');

    // 1. Register Customer & Bootstrap Owner Admin
    const custReg = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        email: `player_${suffix}@example.com`,
        fullName: 'Test Player',
        password: 'StrongPassword123!',
      }),
    });
    assert.equal(custReg.status, 201);
    const customerCookie = extractCookie(custReg.headers.get('set-cookie'));

    // Customer cannot call admin endpoints (RBAC check)
    const deniedAdminRes = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { Cookie: customerCookie },
    });
    assert.equal(deniedAdminRes.status, 403);

    const bootRes = await fetch(`${baseUrl}/api/auth/admin/bootstrap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        email: `owner_${suffix}@lpsstore.com`,
        fullName: 'LPS Owner',
        password: 'OwnerUltraSecurePassword123!',
      }),
    });
    assert.equal(bootRes.status, 201);
    const adminCookie = extractCookie(bootRes.headers.get('set-cookie'));

    // 2. Overview telemetry returns real DB counts
    const overviewRes = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { Cookie: adminCookie },
    });
    assert.equal(overviewRes.status, 200);
    const overviewJson = (await overviewRes.json()) as AdminOverviewResponse;
    assert.ok(overviewJson.stats.totalGames >= 4);
    assert.ok(overviewJson.stats.totalPackages >= 4);

    // 3. Upload Media -> Attach to Game -> Reject Delete while Referenced
    const uploadRes = await fetch(`${baseUrl}/api/admin/media/upload`, {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        fileName: 'apex_badge.png',
        mimeType: 'image/png',
        dataBase64: TINY_PNG_BASE64,
        altText: 'Apex Badge',
      }),
    });
    assert.equal(uploadRes.status, 201);
    const { media: uploadedMedia } = (await uploadRes.json()) as {
      media: { id: string; publicUrl: string };
    };

    const gameCreateRes = await fetch(`${baseUrl}/api/admin/catalog/games`, {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        slug: `nebula-arena-${suffix}`,
        title: 'Nebula Arena',
        publisher: 'Nebula Studio',
        category: 'MOBA',
        description: 'Direct Starlight Gems top-up.',
        coverImageUrl: uploadedMedia.publicUrl,
        coverMediaId: uploadedMedia.id,
        deliveryMode: 'hybrid',
        isActive: true,
        isFeatured: true,
        playerFields: [
          { key: 'player_id', label: 'Player ID', type: 'text', required: true },
          { key: 'server_id', label: 'Server ID', type: 'text', required: false },
        ],
      }),
    });
    assert.equal(gameCreateRes.status, 201);
    const { game: nebulaGame } = (await gameCreateRes.json()) as { game: { id: string } };

    // Referenced media delete returns 409 conflict
    const blockedMediaDel = await fetch(`${baseUrl}/api/admin/media/${uploadedMedia.id}`, {
      method: 'DELETE',
      headers: {
        Cookie: adminCookie,
        'X-Requested-With': 'LPS-Store-Client',
      },
    });
    assert.equal(blockedMediaDel.status, 409);

    // 4. Create Currency & Discounted Package ('both' delivery) + Update Price
    const currRes = await fetch(`${baseUrl}/api/admin/catalog/currencies`, {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        code: `NGEMS_${suffix.toUpperCase()}`,
        name: 'Starlight Gems',
        symbol: 'GEM',
        gameId: nebulaGame.id,
      }),
    });
    assert.equal(currRes.status, 201);
    const { currency: starCurr } = (await currRes.json()) as { currency: { id: string } };

    const pkgCreateRes = await fetch(`${baseUrl}/api/admin/catalog/packages`, {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        gameId: nebulaGame.id,
        gameCurrencyId: starCurr.id,
        sku: `NEB-500-${suffix.toUpperCase()}`,
        name: '500 Starlight Gems',
        inGameAmount: 500,
        inGameUnit: 'Starlight Gems',
        priceInr: 450,
        originalPriceInr: 500,
        deliveryType: 'both',
        isActive: true,
      }),
    });
    assert.equal(pkgCreateRes.status, 201);
    const { package: nebulaPkg } = (await pkgCreateRes.json()) as { package: { id: string } };

    // Verify storefront reflects game + currency + discount %
    const storeDetailRes = await fetch(`${baseUrl}/api/store/games/nebula-arena-${suffix}`);
    assert.equal(storeDetailRes.status, 200);
    const storeDetail = (await storeDetailRes.json()) as StoreGameDetailResponse;
    assert.equal(storeDetail.game.packages[0].discountPercent, 10);
    assert.equal(storeDetail.game.packages[0].deliveryType, 'both');

    // 5. Phase 4 Duplicate Order Prevention via idempotencyKey
    const idemKey = `idem-${suffix}`;
    const orderPayload = {
      packageId: nebulaPkg.id,
      quantity: 2,
      playerDetails: { player_id: '77889900', server_id: 'IN-WEST' },
      preferredDeliveryMethod: 'manual',
      idempotencyKey: idemKey,
    };

    const order1Res = await fetch(`${baseUrl}/api/orders/place`, {
      method: 'POST',
      headers: {
        Cookie: customerCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify(orderPayload),
    });
    assert.equal(order1Res.status, 201);
    const order1 = (await order1Res.json()) as PlaceOrderResponse;
    assert.equal(order1.status, 'payment_pending');
    assert.equal(order1.paymentStatus, 'pending');
    assert.equal(order1.deliveryMethod, 'manual');
    assert.equal(order1.totalInr, 900);

    // Repeating same idempotencyKey returns existing order without creating a duplicate
    const order1DupRes = await fetch(`${baseUrl}/api/orders/place`, {
      method: 'POST',
      headers: {
        Cookie: customerCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify(orderPayload),
    });
    assert.equal(order1DupRes.status, 200);
    const order1Dup = (await order1DupRes.json()) as PlaceOrderResponse;
    assert.equal(order1Dup.duplicatePrevented, true);
    assert.equal(order1Dup.orderId, order1.orderId);

    // Rapid identical submission without idempotencyKey within 15s is also prevented
    const { idempotencyKey: _omit, ...rapidPayload } = orderPayload;
    const rapidRes = await fetch(`${baseUrl}/api/orders/place`, {
      method: 'POST',
      headers: {
        Cookie: customerCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify(rapidPayload),
    });
    assert.equal(rapidRes.status, 200);
    const rapidJson = (await rapidRes.json()) as PlaceOrderResponse;
    assert.equal(rapidJson.duplicatePrevented, true);

    // 6. Phase 4 Unpaid Security Rule: Cannot mark Paid / Payment Verified / Refunded manually
    for (const forbidden of ['paid', 'payment_verified', 'refunded']) {
      const badTransition = await fetch(`${baseUrl}/api/admin/orders/${order1.orderId}`, {
        method: 'PATCH',
        headers: {
          Cookie: adminCookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'LPS-Store-Client',
        },
        body: JSON.stringify({ status: forbidden }),
      });
      assert.equal(badTransition.status, 400);
    }

    // 7. Manual Completion Confirmation Guard
    const unconfirmedComplete = await fetch(`${baseUrl}/api/admin/orders/${order1.orderId}`, {
      method: 'PATCH',
      headers: {
        Cookie: adminCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({ status: 'completed' }),
    });
    assert.equal(unconfirmedComplete.status, 400);

    // Valid transition: processing -> completed with confirmCompleted + customerDeliveryMessage
    const startProcRes = await fetch(`${baseUrl}/api/admin/orders/${order1.orderId}`, {
      method: 'PATCH',
      headers: {
        Cookie: adminCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        status: 'processing',
        deliveryNotes: 'Checking Player ID 77889900',
      }),
    });
    assert.equal(startProcRes.status, 200);

    const completeRes = await fetch(`${baseUrl}/api/admin/orders/${order1.orderId}`, {
      method: 'PATCH',
      headers: {
        Cookie: adminCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        status: 'completed',
        confirmCompleted: true,
        deliveryNotes: 'Credited manually via partner terminal #42',
        customerDeliveryMessage: 'Credited 1,000 Starlight Gems to Player ID 77889900.',
      }),
    });
    assert.equal(completeRes.status, 200);

    // Verify customer sees Completed + separated Payment Pending (Unpaid) + customerDeliveryMessage
    const custOrdersRes = await fetch(`${baseUrl}/api/customer/orders`, {
      headers: { Cookie: customerCookie },
    });
    const custOrders = (await custOrdersRes.json()) as { orders: CustomerOrderItemView[] };
    assert.equal(custOrders.orders[0].displayOrderStatus, 'Completed');
    assert.equal(custOrders.orders[0].displayPaymentStatus, 'Payment Pending (Unpaid)');
    assert.equal(custOrders.orders[0].displayDeliveryStatus, 'Delivered');
    assert.match(custOrders.orders[0].customerDeliveryMessage, /Credited 1,000 Starlight Gems/);

    // 8. Second Order -> Automatic Supplier Dispatch in TEST ONLY (MOCK MODE)
    const order2Res = await fetch(`${baseUrl}/api/orders/place`, {
      method: 'POST',
      headers: {
        Cookie: customerCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        packageId: nebulaPkg.id,
        quantity: 1,
        playerDetails: { player_id: '99887766', server_id: 'IN-EAST' },
        preferredDeliveryMethod: 'automatic',
        idempotencyKey: `idem-auto-${suffix}`,
      }),
    });
    assert.equal(order2Res.status, 201);
    const order2 = (await order2Res.json()) as PlaceOrderResponse;
    assert.equal(order2.deliveryMethod, 'automatic');

    // Fetch seeded suppliers & map package to mock supplier
    const supListRes = await fetch(`${baseUrl}/api/admin/suppliers`, {
      headers: { Cookie: adminCookie },
    });
    const supList = (await supListRes.json()) as { suppliers: AdminSupplierItem[] };
    const mockSup = supList.suppliers.find((s) => s.mode === 'mock' && s.integrationType === 'api');
    assert.ok(mockSup);

    const mapSaveRes = await fetch(`${baseUrl}/api/admin/supplier-mappings`, {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        supplierId: mockSup.id,
        packageId: nebulaPkg.id,
        externalProductCode: 'SUP-NEBULA-500',
        externalProductName: 'Nebula 500 Direct',
        supplierCostInr: 410,
      }),
    });
    assert.equal(mapSaveRes.status, 201);

    // Dispatch order2 to mock supplier -> marked TEST ONLY (MOCK MODE), never auto-completed
    const dispatchRes = await fetch(`${baseUrl}/api/admin/orders/${order2.orderId}/dispatch-supplier`, {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({ supplierId: mockSup.id }),
    });
    assert.equal(dispatchRes.status, 201);
    const dispatchJson = (await dispatchRes.json()) as {
      supplierOrderId: string;
      isMock: boolean;
      environmentLabel: string;
      status: string;
    };
    assert.equal(dispatchJson.isMock, true);
    assert.equal(dispatchJson.environmentLabel, 'TEST ONLY (MOCK MODE)');
    assert.equal(dispatchJson.status, 'submitted');

    // Duplicate supplier dispatch on same order is blocked cleanly
    const dupDispatchRes = await fetch(
      `${baseUrl}/api/admin/orders/${order2.orderId}/dispatch-supplier`,
      {
        method: 'POST',
        headers: {
          Cookie: adminCookie,
          'Content-Type': 'application/json',
          'X-Requested-With': 'LPS-Store-Client',
        },
        body: JSON.stringify({ supplierId: mockSup.id }),
      }
    );
    assert.equal(dupDispatchRes.status, 409);

    // Inspect order2 details -> must NOT be auto-completed and logs include MOCK warning
    const detail2Res = await fetch(`${baseUrl}/api/admin/orders/${order2.orderId}`, {
      headers: { Cookie: adminCookie },
    });
    const detail2 = (await detail2Res.json()) as { order: AdminOrderItem };
    assert.notEqual(detail2.order.status, 'completed');
    assert.equal(detail2.order.status, 'awaiting_delivery');
    assert.ok(detail2.order.deliveryLogs?.some((l) => l.isMock));

    // Website settings update persists cleanly
    const wsRes = await fetch(`${baseUrl}/api/admin/website-settings`, {
      method: 'PATCH',
      headers: {
        Cookie: adminCookie,
        'Content-Type': 'application/json',
        'X-Requested-With': 'LPS-Store-Client',
      },
      body: JSON.stringify({
        storeName: 'LPS STORE PRO',
        storeLogoUrl: null,
        heroHeading: 'LEVEL UP FASTER',
        heroSubtitle: 'Dynamic Storefront Subtitle',
        supportEmail: 'help@lpsstore.example',
        whatsappContact: '+91 98765 43210',
        footerDescription: 'Official store footer updated by admin.',
        supportHours: '24/7 Support',
        supportNote: 'Updated support note.',
        announcementEnabled: true,
        announcementText: 'Festival Bonus Active',
        socialLinks: { discord: '', instagram: '', youtube: '', x: '' },
      }),
    });
    assert.equal(wsRes.status, 200);
  } finally {
    await cleanup();
  }
});
