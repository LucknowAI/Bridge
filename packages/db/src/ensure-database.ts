/**
 * Create a database if it does not already exist.
 *
 * RDS provisions exactly one initial database, but this stack needs two: the
 * application's and Keycloak's. This runs from the migration task, which is the
 * only thing in the deploy that already sits inside the VPC with credentials.
 *
 * Usage:  tsx packages/db/src/ensure-database.ts keycloak
 */
import "dotenv/config";
import pg from "pg";
import { isMainModule } from "./is-main";

/**
 * Connect to the `postgres` maintenance database rather than the target, since
 * CREATE DATABASE cannot run from inside the database being created.
 */
function maintenanceUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.pathname = "/postgres";
  return url.toString();
}

export async function ensureDatabase(name: string): Promise<boolean> {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    // Identifiers cannot be parameterised, so the name is validated instead of escaped.
    throw new Error(`Invalid database name: ${name}`);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");

  const client = new pg.Client({
    connectionString: maintenanceUrl(databaseUrl),
    ssl:
      process.env.DATABASE_SSL === "disable"
        ? false
        : { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    const { rowCount } = await client.query(
      `select 1 from pg_database where datname = $1`,
      [name]
    );

    if (rowCount && rowCount > 0) {
      console.log(`[ensure-database] ${name} already exists`);
      return false;
    }

    await client.query(`create database "${name}"`);
    console.log(`[ensure-database] created ${name}`);
    return true;
  } catch (err) {
    // Two concurrent deploys can race here; losing the race is not an error.
    if (err instanceof Error && /already exists/i.test(err.message)) {
      console.log(`[ensure-database] ${name} created concurrently`);
      return false;
    }
    throw err;
  } finally {
    await client.end();
  }
}

if (isMainModule(import.meta.url)) {
  const name = process.argv[2];
  if (!name) {
    console.error("Usage: tsx packages/db/src/ensure-database.ts <name>");
    process.exit(1);
  }
  ensureDatabase(name)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[ensure-database] failed:", err.message);
      process.exit(1);
    });
}
