import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, type DatabaseAdapter } from './pool';
import { seedFoundation } from './seed';

const MIGRATION_TRACKING_SQL = `
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export async function runMigrations(db: DatabaseAdapter = getDb()): Promise<string[]> {
  const migrationsDir = path.resolve(process.cwd(), 'supabase', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }

  await db.exec(MIGRATION_TRACKING_SQL);

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  const appliedRes = await db.query<{ filename: string }>(
    'SELECT filename FROM public.schema_migrations ORDER BY filename ASC'
  );
  const appliedSet = new Set(appliedRes.rows.map((r) => r.filename));

  const newlyApplied: string[] = [];

  for (const filename of files) {
    if (appliedSet.has(filename)) {
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, filename), 'utf8');
    await db.exec(sql);
    await db.query(
      'INSERT INTO public.schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING',
      [filename]
    );
    newlyApplied.push(filename);
  }

  return newlyApplied;
}

export async function getAppliedMigrations(db: DatabaseAdapter = getDb()): Promise<string[]> {
  const res = await db.query<{ filename: string }>(
    'SELECT filename FROM public.schema_migrations ORDER BY filename ASC'
  );
  return res.rows.map((r) => r.filename);
}

// Allow direct CLI execution via `npm run migrate`
const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  (async () => {
    const db = getDb();
    const applied = await runMigrations(db);
    await seedFoundation(db);
    console.log(
      `[LPS STORE] Migrations complete (${db.engine}). Newly applied: ${
        applied.length ? applied.join(', ') : 'none (up to date)'
      }`
    );
    await db.close();
  })().catch((err) => {
    console.error('[LPS STORE] Migration failed:', err);
    process.exit(1);
  });
}
