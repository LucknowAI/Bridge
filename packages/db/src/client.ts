import pg from "pg";
import { readFileSync } from "node:fs";
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

/**
 * TLS for a connection, from DATABASE_SSL:
 *   disable  plain connection (local docker-compose Postgres has no TLS)
 *   require  encrypted, certificate not checked
 *   verify   encrypted and the server certificate is checked against
 *            DATABASE_CA_CERT (PEM text) or DATABASE_CA_CERT_FILE (a path);
 *            production images ship the RDS bundle for this
 * Unset: off for local hosts, otherwise verify when a CA is configured and
 * require when not. Production startup refuses `require` for remote hosts.
 */
export function resolveSsl(connectionString: string, env: NodeJS.ProcessEnv = process.env): TlsOptions | false {
  const mode = env.DATABASE_SSL;
  if (mode === "disable") return false;
  if (!mode && isLocalDatabase(connectionString)) return false;

  const ca = env.DATABASE_CA_CERT || (env.DATABASE_CA_CERT_FILE ? readFileSync(env.DATABASE_CA_CERT_FILE, "utf8") : "");
  if (mode === "verify" && !ca) {
    throw new Error("DATABASE_SSL=verify needs DATABASE_CA_CERT or DATABASE_CA_CERT_FILE");
  }
  if (mode === "verify" || (!mode && ca)) return { ca, rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

/** Local docker-compose or developer databases, which have no TLS. */
export function isLocalDatabase(connectionString: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "postgres"].includes(new URL(connectionString).hostname);
  } catch {
    return false;
  }
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
