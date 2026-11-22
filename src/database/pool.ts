import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Pool, type PoolClient } from 'pg';
import { getServerEnv } from '../configuration/env';

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface QueryRunner {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
}

export interface DatabaseAdapter extends QueryRunner {
  engine: 'postgres' | 'pglite';
  withTransaction<T>(fn: (tx: QueryRunner) => Promise<T>): Promise<T>;
  withUserRlsContext<T>(
    profileId: string | null,
    fn: (tx: QueryRunner) => Promise<T>
  ): Promise<T>;
  close(): Promise<void>;
}

function createPgPoolAdapter(connectionString: string): DatabaseAdapter {
  const isLocal =
    connectionString.includes('localhost') ||
    connectionString.includes('127.0.0.1');

  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 15000,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });

  pool.on('error', (err) => {
    console.error('Unexpected PostgreSQL pool error:', err);
  });

  const wrapClient = (client: PoolClient): QueryRunner => ({
    async query<T = Record<string, unknown>>(text: string, params?: unknown[]) {
      const res = await client.query(text, params);
      return {
        rows: res.rows as T[],
        rowCount: res.rowCount ?? res.rows.length,
      };
    },
    async exec(sql: string) {
      await client.query(sql);
    },
  });

  return {
    engine: 'postgres',
    async query<T = Record<string, unknown>>(text: string, params?: unknown[]) {
      const res = await pool.query(text, params);
      return {
        rows: res.rows as T[],
        rowCount: res.rowCount ?? res.rows.length,
      };
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    async withTransaction<T>(fn: (tx: QueryRunner) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrapClient(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async withUserRlsContext<T>(
      profileId: string | null,
      fn: (tx: QueryRunner) => Promise<T>
    ): Promise<T> {
      return this.withTransaction(async (tx) => {
        await tx.query('SET LOCAL ROLE lps_rls_enforced');
        await tx.query(`SELECT set_config('app.current_user_id', $1, true)`, [
          profileId || '',
        ]);
        return fn(tx);
      });
    },
    async close() {
      await pool.end();
    },
  };
}

export function createPgliteAdapter(dataDir?: string): DatabaseAdapter {
  let pg: PGlite;
  if (dataDir === 'memory://') {
    pg = new PGlite();
  } else {
    const resolved = path.resolve(dataDir || path.join(process.cwd(), '.data', 'pgdata'));
    fs.mkdirSync(resolved, { recursive: true });
    const pidFile = path.join(resolved, 'postmaster.pid');
    if (fs.existsSync(pidFile)) {
      fs.rmSync(pidFile, { force: true });
    }
    pg = new PGlite(resolved);
  }

  let lock = Promise.resolve();
  const runSerialized = async <T>(fn: () => Promise<T>): Promise<T> => {
    const prev = lock;
    let release!: () => void;
    lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  };

  const runner: QueryRunner = {
    async query<T = Record<string, unknown>>(text: string, params?: unknown[]) {
      const res = await pg.query<T>(text, params);
      return {
        rows: res.rows,
        rowCount: res.affectedRows ?? res.rows.length,
      };
    },
    async exec(sql: string) {
      await pg.exec(sql);
    },
  };

  return {
    engine: 'pglite',
    async query<T = Record<string, unknown>>(text: string, params?: unknown[]) {
      return runSerialized(() => runner.query<T>(text, params));
    },
    async exec(sql: string) {
      return runSerialized(() => runner.exec(sql));
    },
    async withTransaction<T>(fn: (tx: QueryRunner) => Promise<T>): Promise<T> {
      return runSerialized(async () => {
        await pg.query('BEGIN');
        try {
          const result = await fn(runner);
          await pg.query('COMMIT');
          return result;
        } catch (error) {
          await pg.query('ROLLBACK');
          throw error;
        }
      });
    },
    async withUserRlsContext<T>(
      profileId: string | null,
      fn: (tx: QueryRunner) => Promise<T>
    ): Promise<T> {
      return this.withTransaction(async (tx) => {
        await tx.query('SET LOCAL ROLE lps_rls_enforced');
        await tx.query(`SELECT set_config('app.current_user_id', $1, true)`, [
          profileId || '',
        ]);
        return fn(tx);
      });
    },
    async close() {
      await pg.close();
    },
  };
}

let cachedAdapter: DatabaseAdapter | null = null;

export function getDb(): DatabaseAdapter {
  if (cachedAdapter) {
    return cachedAdapter;
  }

  const env = getServerEnv();
  if (env.databaseUrl) {
    cachedAdapter = createPgPoolAdapter(env.databaseUrl);
  } else {
    cachedAdapter = createPgliteAdapter();
  }

  return cachedAdapter;
}

export async function recoverLocalPglite(): Promise<DatabaseAdapter> {
  if (cachedAdapter) {
    try {
      await cachedAdapter.close();
    } catch {
      // Ignore close error on already-aborted instance
    }
    cachedAdapter = null;
  }
  const pgDataDir = path.resolve(process.cwd(), '.data', 'pgdata');
  fs.rmSync(pgDataDir, { recursive: true, force: true });
  cachedAdapter = createPgliteAdapter(pgDataDir);
  return cachedAdapter;
}

export function setDbForTests(adapter: DatabaseAdapter): void {
  cachedAdapter = adapter;
}

export async function resetDbForTests(): Promise<void> {
  if (cachedAdapter) {
    await cachedAdapter.close();
    cachedAdapter = null;
  }
}
