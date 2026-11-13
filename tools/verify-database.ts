/**
 * Checks that a database is a usable Mr. Bridge database: reachable, with
 * pgvector, every migration in this checkout applied unchanged, and the core
 * tables present. With --compare it also compares row counts with another
 * database, e.g. a restored copy against its source:
 *
 *   npm run db:verify -- --url <restored-url> --compare <source-url> [--strict]
 *
 * Without --url it checks DATABASE_URL. Counts may differ a little after a
 * point-in-time restore of a live database; --strict makes any difference fail.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import pg from "pg";
import { resolveSsl } from "../packages/db/src/client";
import { isMainModule } from "../packages/db/src/is-main";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "packages", "db", "migrations");

/** The tables the journey cannot work without; their row counts are compared. */
export const CORE_TABLES = [
  "organizations", "events", "registered_attendees", "event_participants", "event_matches",
  "matching_jobs", "intro_requests", "notification_outbox", "location_requests", "audit_events",
];

export interface DatabaseState {
  vector: boolean;
  /** Migration name -> checksum, as recorded in schema_migrations. */
  applied: Map<string, string>;
  counts: Record<string, number | null>;
}

export async function readState(url: string): Promise<DatabaseState> {
  const client = new pg.Client({ connectionString: url, ssl: resolveSsl(url) });
  await client.connect();
  try {
    const vector = (await client.query(`select 1 from pg_extension where extname = 'vector'`)).rows.length > 0;
    const migrations = await client.query<{ name: string; checksum: string }>(`select name, checksum from schema_migrations`).catch(() => ({ rows: [] }));
    const counts: Record<string, number | null> = {};
    for (const table of CORE_TABLES) {
      const exists = (await client.query(`select to_regclass($1) as name`, [`public.${table}`])).rows[0].name;
      counts[table] = exists ? Number((await client.query(`select count(*) from ${table}`)).rows[0].count) : null;
    }
    return { vector, applied: new Map(migrations.rows.map((row) => [row.name, row.checksum])), counts };
  } finally {
    await client.end();
  }
}

/**
 * Migration files in this checkout with their accepted checksums. The runner
 * hashes the file as checked out, so a database migrated on Linux (LF) and
 * checked from a Windows checkout (CRLF) is the same file: both are accepted.
 */
export function expectedMigrations(dir = MIGRATIONS_DIR): Map<string, string[]> {
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");
  return new Map(readdirSync(dir).filter((file) => file.endsWith(".sql")).sort().map((file) => {
    const lf = readFileSync(join(dir, file), "utf8").replace(/\r\n/g, "\n");
    return [file, [sha(lf), sha(lf.replace(/\n/g, "\r\n"))]];
  }));
}

/** Problems that make the database unusable, then count differences against `source`. */
export function compareState(state: DatabaseState, expected: Map<string, string[]>, source?: DatabaseState): { problems: string[]; differences: string[] } {
  const problems: string[] = [];
  if (!state.vector) problems.push("the pgvector extension is missing");
  for (const [name, checksums] of expected) {
    const applied = state.applied.get(name);
    if (!applied) problems.push(`migration ${name} is not applied`);
    else if (!checksums.includes(applied)) problems.push(`migration ${name} was applied from a different file`);
  }
  for (const [table, count] of Object.entries(state.counts)) {
    if (count === null) problems.push(`table ${table} is missing`);
  }
  const differences = source
    ? Object.keys(state.counts).filter((table) => state.counts[table] !== source.counts[table])
      .map((table) => `${table}: ${state.counts[table]} here, ${source.counts[table]} in the source`)
    : [];
  return { problems, differences };
}

export async function verifyDatabase(url: string, options: { compare?: string; strict?: boolean } = {}): Promise<boolean> {
  const state = await readState(url);
  const source = options.compare ? await readState(options.compare) : undefined;
  const { problems, differences } = compareState(state, expectedMigrations(), source);
  console.info(`[db:verify] ${state.applied.size} migrations applied; rows: ${CORE_TABLES.map((table) => `${table}=${state.counts[table] ?? "missing"}`).join(" ")}`);
  for (const problem of problems) console.error(`[db:verify] FAIL ${problem}`);
  for (const difference of differences) console[options.strict ? "error" : "warn"](`[db:verify] ${options.strict ? "FAIL" : "differs"} ${difference}`);
  const ok = problems.length === 0 && (!options.strict || differences.length === 0);
  console.info(ok ? "[db:verify] database is usable" : "[db:verify] database check failed");
  return ok;
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({ options: { url: { type: "string" }, compare: { type: "string" }, strict: { type: "boolean", default: false } } });
  const url = values.url ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("[db:verify] pass --url or set DATABASE_URL");
    process.exit(2);
  }
  process.exitCode = (await verifyDatabase(url, { compare: values.compare, strict: values.strict })) ? 0 : 1;
}
