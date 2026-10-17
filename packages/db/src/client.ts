import pg from "pg";
import type { ConnectionOptions as TlsOptions } from "node:tls";

const { Pool } = pg;

// Postgres returns NUMERIC as a string to preserve precision. Match scores are
// small fixed-point values that the UI treats as numbers, so coerce them here
// rather than sprinkling Number() across the callers.
pg.types.setTypeParser(1700, (value: string) => Number.parseFloat(value));

let pool: pg.Pool | null = null;

/**
 * Lazily-created connection pool.
 *
 * Next.js re-evaluates modules on every hot reload in development, which would
 * leak a pool per reload. Caching on `globalThis` keeps exactly one pool alive
 * across reloads; in production the module is evaluated once anyway.
 */
export function getPool(): pg.Pool {
  if (pool) return pool;

  const globalForPool = globalThis as typeof globalThis & {
    __matchMakerPool?: pg.Pool;
  };

  if (globalForPool.__matchMakerPool) {
    pool = globalForPool.__matchMakerPool;
    return pool;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and fill it in."
    );
  }

  pool = new Pool({
    connectionString,
    // RDS terminates TLS with an Amazon-issued CA that is not in Node's default
    // trust store. Verification is enabled only when a CA bundle is supplied.
    ssl: resolveSsl(connectionString),
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  pool.on("error", (err) => {
    // A pooled connection dropped while idle (failover, network blip). The pool
    // discards it and opens a new one on next use — log, but never crash.
    console.error("[db] idle client error:", err.message);
  });

  globalForPool.__matchMakerPool = pool;
  return pool;
}

function resolveSsl(connectionString: string): TlsOptions | false {
  if (process.env.DATABASE_SSL === "disable") return false;

  // Local docker-compose Postgres has no TLS at all.
  const isLocal =
    connectionString.includes("@localhost") ||
    connectionString.includes("@127.0.0.1") ||
    connectionString.includes("@postgres:");
  if (isLocal && process.env.DATABASE_SSL !== "require") return false;

  const ca = process.env.DATABASE_CA_CERT;
  return ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
}

/** Run a parameterised query. Never interpolate user input into `text`. */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params);
}

/** Run `fn` inside a transaction, rolling back if it throws. */
export async function transaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
  delete (globalThis as { __matchMakerPool?: pg.Pool }).__matchMakerPool;
}
