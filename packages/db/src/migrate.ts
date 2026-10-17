/**
 * Migration runner.
 *
 * Applies every unapplied `.sql` file in ../migrations in filename order and
 * records it in `schema_migrations`. Each file runs inside its own transaction,
 * so a failure leaves the database on the last good migration.
 *
 * Run with:  npm run db:migrate
 */
import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { closePool, getPool, query } from "./client";
import { isMainModule } from "./is-main";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

async function ensureMigrationsTable(): Promise<void> {
  await query(`
    create table if not exists schema_migrations (
      name        text primary key,
      checksum    text not null,
      applied_at  timestamptz not null default now()
    )
  `);
}

export async function migrate(): Promise<void> {
  await ensureMigrationsTable();

  const applied = new Map<string, string>();
  const { rows } = await query<{ name: string; checksum: string }>(
    `select name, checksum from schema_migrations`
  );
  for (const row of rows) applied.set(row.name, row.checksum);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.warn("[migrate] no .sql files found in", MIGRATIONS_DIR);
    return;
  }

  let count = 0;
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const previous = applied.get(file);

    if (previous) {
      // An edited migration would silently diverge across environments.
      if (previous !== checksum) {
        throw new Error(
          `Migration ${file} has changed since it was applied. ` +
            `Add a new migration instead of editing an applied one.`
        );
      }
      continue;
    }

    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        `insert into schema_migrations (name, checksum) values ($1, $2)`,
        [file, checksum]
      );
      await client.query("COMMIT");
      console.log(`[migrate] applied ${file}`);
      count++;
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(
        `Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      client.release();
    }
  }

  console.log(
    count === 0
      ? "[migrate] database already up to date"
      : `[migrate] applied ${count} migration(s)`
  );
}

// Only self-execute when invoked directly, so tests can import `migrate()`.
if (isMainModule(import.meta.url)) {
  migrate()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error("[migrate] failed:", err.message);
      await closePool().catch(() => {});
      process.exit(1);
    });
}
