import { getServerEnv } from '../configuration/env';
import { hashPassword } from '../authentication/password';
import type { DatabaseAdapter } from './pool';
import { RAZORPAY_CHECKLIST_DEFINITIONS } from '../utilities/checklist';

const DEFAULT_ROLES = [
  {
    code: 'owner',
    name: 'Store Owner',
    description: 'Full administrative control, gateway cutover, refunds, and role governance.',
    permissions: ['*'],
  },
  {
    code: 'manager',
    name: 'Operations Manager',
    description: 'Catalog, pricing, supplier routing, and order management without gateway live cutover.',
    permissions: ['admin.overview.read', 'admin.settings.read', 'orders.read', 'orders.manage', 'payments.read'],
  },
  {
    code: 'finance',
    name: 'Finance & Reconciliation',
    description: 'Payment reconciliation, refund review, and audit inspection.',
    permissions: ['admin.overview.read', 'admin.audit.read', 'payments.read', 'payments.refund', 'orders.read'],
  },
  {
    code: 'support',
    name: 'Customer Support',
    description: 'Read-only order and payment lookup for customer assistance.',
    permissions: ['admin.overview.read', 'orders.read', 'payments.read'],
  },
];

export async function seedFoundation(db: DatabaseAdapter): Promise<void> {
  // 1. Seed system roles
  for (const role of DEFAULT_ROLES) {
    await db.query(
      `INSERT INTO public.roles (code, name, description, permissions, is_system)
       VALUES ($1, $2, $3, $4::jsonb, TRUE)
       ON CONFLICT (code) DO UPDATE
       SET name = EXCLUDED.name,
           description = EXCLUDED.description,
           permissions = EXCLUDED.permissions`,
      [role.code, role.name, role.description, JSON.stringify(role.permissions)]
    );
  }

  // 2. Seed base currency (INR) and USD reference as settlement currencies
  await db.query(
    `INSERT INTO public.currencies (code, name, symbol, decimal_places, exchange_rate_to_inr, is_base, is_active, currency_kind)
     VALUES
       ('INR', 'Indian Rupee', '₹', 2, 1.000000, TRUE, TRUE, 'settlement'),
       ('USD', 'US Dollar', '$', 2, 84.000000, FALSE, TRUE, 'settlement')
     ON CONFLICT (code) DO UPDATE
     SET currency_kind = 'settlement'`
  );

  // 3. Seed default website_settings (strictly Test Mode by default, zero fake credentials)
  const env = getServerEnv();
  const initialChecklist: Record<string, { status: string; updatedAt: string | null; note: string }> = {};
  for (const item of RAZORPAY_CHECKLIST_DEFINITIONS) {
    initialChecklist[item.key] = {
      status: 'not_started',
      updatedAt: null,
      note: '',
    };
  }

  await db.query(
    `INSERT INTO public.website_settings (setting_key, setting_value, is_public)
     VALUES
       ('storefront_identity', $1::jsonb, TRUE),
       ('payment_mode', $2::jsonb, FALSE),
       ('razorpay_readiness_checklist', $3::jsonb, FALSE)
     ON CONFLICT (setting_key) DO NOTHING`,
    [
      JSON.stringify({
        storeName: 'LPS STORE',
        storeLogoUrl: null,
        heroHeading: 'LEVEL UP YOUR GAME',
        heroSubtitle: 'Your Gaming Top-Up Destination',
        supportEmail: 'support@lpsstore.example',
        whatsappContact: '+91 00000 00000',
        footerDescription:
          'A digital gaming top-up marketplace built with server-verified package pricing, Player ID validation, and transparent order tracking.',
        supportHours: 'Monday – Sunday · 10:00 – 22:00 IST',
        supportNote:
          'Reach out for pending order status checks, Player ID updates, or catalog support.',
        announcementEnabled: false,
        announcementText: '',
        socialLinks: {
          discord: '',
          instagram: '',
          youtube: '',
          x: '',
        },
        razorpayPrimaryGateway: true,
      }),
      JSON.stringify({ mode: env.defaultPaymentMode === 'live' ? 'test' : 'test' }),
      JSON.stringify(initialChecklist),
    ]
  );

  // 4. Seed default unpublished layout shell for future no-code customization
  await db.query(
    `INSERT INTO public.website_layouts (page_slug, title, sections, is_published)
     VALUES ('home', 'LPS STORE Home', '[]'::jsonb, FALSE)
     ON CONFLICT (page_slug) DO NOTHING`
  );

  // 5. Optional env-based owner bootstrap ONLY if both OWNER_ADMIN_EMAIL and ADMIN_BOOTSTRAP_PASSWORD are provided via env
  if (env.ownerAdminEmail && env.adminBootstrapPassword) {
    const existingOwner = await db.query<{ id: string }>(
      'SELECT id FROM public.admin_users WHERE is_owner = TRUE LIMIT 1'
    );
    if (existingOwner.rows.length === 0) {
      const passwordHash = await hashPassword(env.adminBootstrapPassword);
      const ownerRole = await db.query<{ id: string }>(
        `SELECT id FROM public.roles WHERE code = 'owner' LIMIT 1`
      );
      if (ownerRole.rows[0]) {
        const profileRes = await db.query<{ id: string }>(
          `INSERT INTO public.profiles (email, full_name, password_hash, account_status, is_email_verified)
           VALUES ($1, 'Store Owner', $2, 'active', TRUE)
           ON CONFLICT (email) DO UPDATE
           SET password_hash = EXCLUDED.password_hash,
               account_status = 'active'
           RETURNING id`,
          [env.ownerAdminEmail, passwordHash]
        );
        await db.query(
          `INSERT INTO public.admin_users (profile_id, role_id, is_owner, is_active)
           VALUES ($1, $2, TRUE, TRUE)
           ON CONFLICT (profile_id) DO NOTHING`,
          [profileRes.rows[0].id, ownerRole.rows[0].id]
        );
      }
    }
  }

  // 6. Seed initial database-backed catalog ONLY when games table is empty (never overwrites admin edits)
  await seedInitialCatalogIfEmpty(db);

  // 7. Seed initial in-game currencies ONLY when no in_game currencies exist yet (never overwrites admin edits)
  await seedInitialInGameCurrenciesIfEmpty(db);

  // 8. Seed initial Phase 4 supplier records ONLY when suppliers table is empty (TEST ONLY mock adapters)
  await seedInitialSuppliersIfEmpty(db);
}

async function seedInitialCatalogIfEmpty(db: DatabaseAdapter): Promise<void> {
  const existingGames = await db.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM public.games'
  );
  if (Number(existingGames.rows[0]?.count || '0') > 0) {
    return;
  }

  const inrRes = await db.query<{ id: string }>(
    `SELECT id FROM public.currencies WHERE code = 'INR' LIMIT 1`
  );
  const inrCurrencyId = inrRes.rows[0]?.id;
  if (!inrCurrencyId) {
    return;
  }

  const catalog = [
    {
      slug: 'valor-arena',
      title: 'Valor Arena',
      publisher: 'Riot Tactical Studio',
      category: 'FPS',
      description:
        'Instant tactical points top-up for weapon skins, battle passes, and seasonal bundles.',
      coverImageUrl: '/src/assets/images/game_cover_valor_arena_1795268059693.jpg',
      deliveryMode: 'manual',
      isFeatured: true,
      sortOrder: 1,
      playerFields: [
        {
          key: 'riot_id',
          label: 'Riot ID',
          type: 'text',
          placeholder: 'e.g. Striker',
          hint: 'Enter your in-game Riot username without the # tag.',
          required: true,
          validationRegex: '^[A-Za-z0-9 _.-]{2,24}$',
          validationMessage: 'Riot ID must be 2–24 letters, numbers, or spaces.',
        },
        {
          key: 'tagline',
          label: 'Tagline',
          type: 'text',
          placeholder: 'e.g. #IND1',
          hint: 'Include your 3-5 character # tagline.',
          required: true,
          validationRegex: '^#?[A-Za-z0-9]{2,6}$',
          validationMessage: 'Enter a valid 2–6 character tagline (e.g. #IND1).',
        },
      ],
      regions: [
        { code: 'AP', name: 'Asia Pacific (Mumbai / Singapore)', hint: 'AP Shard' },
        { code: 'EU', name: 'Europe', hint: 'EU Shard' },
      ],
      packages: [
        { sku: 'VA-VP-475', name: '475 Tactical Points', amount: 475, unit: 'VP', price: 420, cost: 365, badge: '' },
        { sku: 'VA-VP-1000', name: '1,000 Tactical Points', amount: 1000, unit: 'VP', price: 850, cost: 730, badge: '+10% Extra' },
        { sku: 'VA-VP-2050', name: '2,050 Tactical Points', amount: 2050, unit: 'VP', price: 1690, cost: 1440, badge: 'Best Value' },
      ],
    },
    {
      slug: 'royal-drop',
      title: 'Royal Drop',
      publisher: 'Krafton Arena',
      category: 'Battle Royale',
      description:
        'Direct Unknown Cash top-up delivered safely via Player ID and server verification.',
      coverImageUrl: '/src/assets/images/game_cover_royal_drop_1795268059987.jpg',
      deliveryMode: 'manual',
      isFeatured: true,
      sortOrder: 2,
      playerFields: [
        {
          key: 'player_id',
          label: 'Character ID',
          type: 'text',
          placeholder: 'e.g. 5129482710',
          hint: 'Found in your in-game profile header.',
          required: true,
          validationRegex: '^\\d{6,15}$',
          validationMessage: 'Character ID must be 6–15 digits.',
        },
        {
          key: 'character_name',
          label: 'In-Game Nickname',
          type: 'text',
          placeholder: 'Optional verification name',
          required: false,
        },
      ],
      regions: [
        { code: 'IN', name: 'India Server', hint: 'Standard IN' },
        { code: 'GLOBAL', name: 'Global Server', hint: 'SEA / ME' },
      ],
      packages: [
        { sku: 'RD-UC-60', name: '60 Unknown Cash', amount: 60, unit: 'UC', price: 75, cost: 64, badge: '' },
        { sku: 'RD-UC-325', name: '325 Unknown Cash', amount: 325, unit: 'UC', price: 380, cost: 325, badge: 'Popular' },
        { sku: 'RD-UC-660', name: '660 Unknown Cash', amount: 660, unit: 'UC', price: 750, cost: 635, badge: '+10% Extra' },
        { sku: 'RD-UC-1800', name: '1,800 Unknown Cash', amount: 1800, unit: 'UC', price: 1900, cost: 1610, badge: 'Best Value' },
      ],
    },
    {
      slug: 'arcane-realm',
      title: 'Arcane Realm',
      publisher: 'HoYo Obsidian',
      category: 'Action RPG',
      description:
        'Genesis Crystals and Blessings top-up using UID and server region selection only.',
      coverImageUrl: '/src/assets/images/game_cover_arcane_realm_1795268059631.jpg',
      deliveryMode: 'manual',
      isFeatured: true,
      sortOrder: 3,
      playerFields: [
        {
          key: 'uid',
          label: 'Player UID',
          type: 'text',
          placeholder: 'e.g. 804912345',
          hint: '9-digit numeric UID shown at the bottom-right of your screen.',
          required: true,
          validationRegex: '^\\d{8,12}$',
          validationMessage: 'Player UID must be 8–12 numeric digits.',
        },
        {
          key: 'server_shard',
          label: 'Game Server',
          type: 'select',
          required: true,
          options: ['Asia', 'Europe', 'America', 'TW / HK / MO'],
        },
      ],
      regions: [
        { code: 'ASIA', name: 'Asia Server', hint: 'UID starts with 8' },
        { code: 'EU', name: 'Europe Server', hint: 'UID starts with 7' },
        { code: 'NA', name: 'America Server', hint: 'UID starts with 6' },
      ],
      packages: [
        { sku: 'AR-WELKIN-1', name: 'Moonlight Blessing (30 Days)', amount: 300, unit: 'Crystals + Pass', price: 449, cost: 380, badge: 'Popular' },
        { sku: 'AR-GC-980', name: '980 Genesis Crystals', amount: 980, unit: 'Crystals', price: 1299, cost: 1110, badge: '+15% Extra' },
        { sku: 'AR-GC-3280', name: '3,280 Genesis Crystals', amount: 3280, unit: 'Crystals', price: 3999, cost: 3420, badge: 'Best Value' },
      ],
    },
    {
      slug: 'nexus-legends',
      title: 'Nexus Legends',
      publisher: 'Moonton Esports',
      category: 'MOBA',
      description:
        'Fast Diamonds top-up using User ID and Zone ID without ever sharing account credentials.',
      coverImageUrl: '/src/assets/images/game_cover_nexus_legends_1795268060587.jpg',
      deliveryMode: 'manual',
      isFeatured: true,
      sortOrder: 4,
      playerFields: [
        {
          key: 'user_id',
          label: 'User ID',
          type: 'text',
          placeholder: 'e.g. 129847102',
          required: true,
          validationRegex: '^\\d{5,15}$',
          validationMessage: 'User ID must contain 5–15 digits.',
        },
        {
          key: 'zone_id',
          label: 'Zone / Server ID',
          type: 'text',
          placeholder: 'e.g. 2418',
          hint: 'The 4-5 digit number in parentheses next to your User ID.',
          required: true,
          validationRegex: '^\\d{3,6}$',
          validationMessage: 'Zone ID must be 3–6 digits.',
        },
      ],
      regions: [{ code: 'GLOBAL', name: 'Global / Southeast Asia', hint: 'All standard zones' }],
      packages: [
        { sku: 'NL-DM-86', name: '86 Diamonds', amount: 86, unit: 'Diamonds', price: 135, cost: 115, badge: '' },
        { sku: 'NL-DM-172', name: '172 Diamonds', amount: 172, unit: 'Diamonds', price: 265, cost: 224, badge: '+10% Extra' },
        { sku: 'NL-DM-514', name: '514 Diamonds', amount: 514, unit: 'Diamonds', price: 780, cost: 660, badge: 'Best Value' },
      ],
    },
  ];

  for (const item of catalog) {
    const gameRes = await db.query<{ id: string }>(
      `INSERT INTO public.games
         (slug, title, publisher, category, description, cover_image_url, delivery_mode, is_active, is_featured, sort_order, player_fields)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8, $9, $10::jsonb)
       ON CONFLICT (slug) DO NOTHING
       RETURNING id`,
      [
        item.slug,
        item.title,
        item.publisher,
        item.category,
        item.description,
        item.coverImageUrl,
        item.deliveryMode,
        item.isFeatured,
        item.sortOrder,
        JSON.stringify(item.playerFields),
      ]
    );
    const gameId = gameRes.rows[0]?.id;
    if (!gameId) continue;

    let firstRegionId: string | null = null;
    for (const reg of item.regions) {
      const regRes = await db.query<{ id: string }>(
        `INSERT INTO public.game_regions (game_id, region_code, region_name, server_hint, is_active)
         VALUES ($1, $2, $3, $4, TRUE)
         ON CONFLICT (game_id, region_code) DO NOTHING
         RETURNING id`,
        [gameId, reg.code, reg.name, reg.hint]
      );
      if (!firstRegionId && regRes.rows[0]?.id) {
        firstRegionId = regRes.rows[0].id;
      }
    }

    let sort = 1;
    for (const pkg of item.packages) {
      await db.query(
        `INSERT INTO public.packages
           (game_id, region_id, currency_id, sku, name, in_game_amount, in_game_unit, price_inr, supplier_cost_inr, bonus_badge, image_url, delivery_type, is_active, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'manual', TRUE, $12)
         ON CONFLICT (sku) DO NOTHING`,
        [
          gameId,
          firstRegionId,
          inrCurrencyId,
          pkg.sku,
          pkg.name,
          pkg.amount,
          pkg.unit,
          pkg.price,
          pkg.cost,
          pkg.badge,
          item.coverImageUrl,
          sort++,
        ]
      );
    }
  }
}

async function seedInitialInGameCurrenciesIfEmpty(db: DatabaseAdapter): Promise<void> {
  const existingInGame = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM public.currencies WHERE currency_kind = 'in_game'`
  );
  if (Number(existingInGame.rows[0]?.count || '0') > 0) {
    return;
  }

  const gameRows = await db.query<{ id: string; slug: string; cover_image_url: string | null }>(
    `SELECT id, slug, cover_image_url FROM public.games`
  );
  const gameMap = new Map(gameRows.rows.map((g) => [g.slug, g]));

  const initialCurrencies = [
    {
      slug: 'valor-arena',
      code: 'VP',
      name: 'Tactical Points',
      symbol: 'VP',
      description: 'In-game tactical points for skins and battle passes.',
      sortOrder: 1,
    },
    {
      slug: 'royal-drop',
      code: 'UC',
      name: 'Unknown Cash',
      symbol: 'UC',
      description: 'Direct Unknown Cash delivered by Character ID.',
      sortOrder: 2,
    },
    {
      slug: 'arcane-realm',
      code: 'CRYSTALS',
      name: 'Genesis Crystals',
      symbol: 'Crystals',
      description: 'Genesis Crystals delivered by UID and server shard.',
      sortOrder: 3,
    },
    {
      slug: 'nexus-legends',
      code: 'DIAMONDS',
      name: 'Diamonds',
      symbol: 'Diamonds',
      description: 'Fast Diamonds top-up via User ID and Zone ID.',
      sortOrder: 4,
    },
  ];

  for (const item of initialCurrencies) {
    const game = gameMap.get(item.slug);
    const res = await db.query<{ id: string }>(
      `INSERT INTO public.currencies
         (code, name, symbol, decimal_places, exchange_rate_to_inr, is_base, is_active, currency_kind, game_id, description, image_url, sort_order)
       VALUES ($1, $2, $3, 0, 1.000000, FALSE, TRUE, 'in_game', $4, $5, $6, $7)
       ON CONFLICT (code) DO UPDATE
       SET game_id = COALESCE(public.currencies.game_id, EXCLUDED.game_id),
           currency_kind = 'in_game'
       RETURNING id`,
      [
        item.code,
        item.name,
        item.symbol,
        game?.id ?? null,
        item.description,
        game?.cover_image_url ?? null,
        item.sortOrder,
      ]
    );
    const currencyId = res.rows[0]?.id;
    if (currencyId && game?.id) {
      await db.query(
        `UPDATE public.packages
         SET game_currency_id = $1
         WHERE game_id = $2 AND game_currency_id IS NULL`,
        [currencyId, game.id]
      );
    }
  }
}

async function seedInitialSuppliersIfEmpty(db: DatabaseAdapter): Promise<void> {
  const existing = await db.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM public.suppliers'
  );
  if (Number(existing.rows[0]?.count || '0') > 0) {
    return;
  }

  await db.query(
    `INSERT INTO public.suppliers
       (name, code, integration_type, mode, api_base_url, is_active, timeout_ms, max_retries, supported_games_note, notes)
     VALUES
       (
         'LPS Sandbox Top-Up API',
         'mock-direct-topup',
         'api',
         'mock',
         NULL,
         TRUE,
         8000,
         2,
         'All games (TEST ONLY simulated dispatch)',
         'Runs strictly in TEST ONLY (MOCK MODE) until authorized supplier credentials and endpoints are configured.'
       ),
       (
         'Manual Operations Desk',
         'manual-desk',
         'manual',
         'mock',
         NULL,
         TRUE,
         8000,
         1,
         'All games requiring manual admin fulfillment',
         'Internal operator workflow for verified manual top-up processing.'
       )
     ON CONFLICT (code) DO NOTHING`
  );
}
