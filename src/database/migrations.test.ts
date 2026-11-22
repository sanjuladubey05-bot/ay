import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_DATABASE_TABLES } from '../types/database';
import { runMigrations } from './migrate';
import { createPgliteAdapter } from './pool';
import { seedFoundation } from './seed';

test('PostgreSQL migrations create all 21 core tables and enforce RLS policies', async () => {
  const db = createPgliteAdapter('memory://');
  try {
    const applied = await runMigrations(db);
    assert.ok(applied.includes('0001_phase1_initial_schema.sql'));
    assert.ok(applied.includes('0002_phase1_rls_policies.sql'));
    assert.ok(applied.includes('0003_phase1_auth_support.sql'));

    await seedFoundation(db);

    // 1. Verify all 21 required tables exist
    const tableRes = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    );
    const present = new Set(tableRes.rows.map((r) => r.table_name));
    for (const tableName of CORE_DATABASE_TABLES) {
      assert.equal(present.has(tableName), true, `Missing required table: ${tableName}`);
    }

    // 2. Verify CHECK constraint rejects negative/zero currency exchange rate
    await assert.rejects(() =>
      db.query(
        `INSERT INTO public.currencies (code, name, symbol, exchange_rate_to_inr)
         VALUES ('BAD', 'Bad Currency', 'B', 0)`
      )
    );

    // 3. Seed an owner admin + two customers to verify RLS policy isolation
    const ownerRole = await db.query<{ id: string }>(
      `SELECT id FROM public.roles WHERE code = 'owner' LIMIT 1`
    );
    const ownerProf = await db.query<{ id: string }>(
      `INSERT INTO public.profiles (email, full_name, account_status)
       VALUES ('owner@test.local', 'Owner', 'active') RETURNING id`
    );
    await db.query(
      `INSERT INTO public.admin_users (profile_id, role_id, is_owner, is_active)
       VALUES ($1, $2, TRUE, TRUE)`,
      [ownerProf.rows[0].id, ownerRole.rows[0].id]
    );
    await db.query(
      `INSERT INTO public.audit_logs (actor_profile_id, actor_role, action, resource_type)
       VALUES ($1, 'owner', 'test.owner_secret_action', 'system')`,
      [ownerProf.rows[0].id]
    );

    const custAProf = await db.query<{ id: string }>(
      `INSERT INTO public.profiles (email, full_name, account_status)
       VALUES ('cust_a@test.local', 'Customer A', 'active') RETURNING id`
    );
    const custA = await db.query<{ id: string }>(
      `INSERT INTO public.customers (profile_id, customer_code)
       VALUES ($1, 'CUST-A') RETURNING id`,
      [custAProf.rows[0].id]
    );

    const custBProf = await db.query<{ id: string }>(
      `INSERT INTO public.profiles (email, full_name, account_status)
       VALUES ('cust_b@test.local', 'Customer B', 'active') RETURNING id`
    );
    const custB = await db.query<{ id: string }>(
      `INSERT INTO public.customers (profile_id, customer_code)
       VALUES ($1, 'CUST-B') RETURNING id`,
      [custBProf.rows[0].id]
    );

    await db.query(
      `INSERT INTO public.orders (order_number, customer_id, subtotal_inr, total_inr, amount_paise, payment_mode)
       VALUES
         ('ORD-A-1', $1, 100.00, 100.00, 10000, 'test'),
         ('ORD-B-1', $2, 200.00, 200.00, 20000, 'test')`,
      [custA.rows[0].id, custB.rows[0].id]
    );

    // 4. Customer A under RLS must NOT see admin_users, roles, audit_logs, private settings, or Customer B's order
    await db.withUserRlsContext(custAProf.rows[0].id, async (tx) => {
      const rolesRead = await tx.query('SELECT * FROM public.roles');
      assert.equal(rolesRead.rows.length, 0, 'Customer must not read roles table');

      const adminRead = await tx.query('SELECT * FROM public.admin_users');
      assert.equal(adminRead.rows.length, 0, 'Customer must not read admin_users table');

      const auditRead = await tx.query('SELECT * FROM public.audit_logs');
      assert.equal(auditRead.rows.length, 0, 'Customer must not read audit_logs');

      const privateSettings = await tx.query(
        `SELECT * FROM public.website_settings WHERE setting_key = 'payment_mode'`
      );
      assert.equal(privateSettings.rows.length, 0, 'Customer must not read private settings');

      const ordersRead = await tx.query<{ order_number: string }>(
        'SELECT order_number FROM public.orders'
      );
      assert.deepEqual(
        ordersRead.rows.map((r) => r.order_number),
        ['ORD-A-1'],
        'Customer A must only see own order'
      );
    });

    // 5. Owner Admin under RLS CAN read audit_logs, roles, and private settings
    await db.withUserRlsContext(ownerProf.rows[0].id, async (tx) => {
      const auditRead = await tx.query('SELECT * FROM public.audit_logs');
      assert.equal(auditRead.rows.length, 1);

      const privateSettings = await tx.query(
        `SELECT * FROM public.website_settings WHERE setting_key = 'payment_mode'`
      );
      assert.equal(privateSettings.rows.length, 1);
    });
  } finally {
    await db.close();
  }
});
