/**
 * Backup and restore rehearsal against the local docker compose Postgres:
 * dumps the database, restores the dump into a fresh scratch database,
 * verifies the copy (migrations, pgvector, core tables, row counts against
 * the source), times each step, and removes the scratch database and dump.
 * The source database is only read.
 *
 *   npm run db:restore-rehearsal
 *
 * Production uses RDS snapshots and point-in-time restore instead; see
 * "Restore the database" in docs/OPERATIONS.md, which ends with the same
 * `npm run db:verify` check.
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verifyDatabase } from "./verify-database";

const SCRATCH = process.env.RESTORE_REHEARSAL_DATABASE ?? "restore_rehearsal";
const user = process.env.POSTGRES_USER ?? "matchmaker";
const database = process.env.POSTGRES_DB ?? "matchmaker";
const source = process.env.DATABASE_URL;

function compose(args: string[], input?: Buffer): Buffer {
  const result = spawnSync("docker", ["compose", "exec", "-T", "postgres", ...args], { input, maxBuffer: 1024 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${args[0]} failed: ${result.stderr?.toString().trim() || result.error?.message}`);
  return result.stdout;
}
const psql = (sql: string) => compose(["psql", "-U", user, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAc", sql]).toString().trim();
async function timed<T>(label: string, step: () => T | Promise<T>): Promise<T> {
  const started = Date.now();
  const result = await step();
  console.info(`[restore] ${label}: ${((Date.now() - started) / 1000).toFixed(1)} s`);
  return result;
}

if (!source) {
  console.error("[restore] DATABASE_URL must point at the compose Postgres");
  process.exit(2);
}
if (psql(`select 1 from pg_database where datname = '${SCRATCH}'`)) {
  console.error(`[restore] database ${SCRATCH} already exists; it is not ours to replace. Remove it or set RESTORE_REHEARSAL_DATABASE.`);
  process.exit(2);
}

const dir = mkdtempSync(join(tmpdir(), "mr-bridge-restore-"));
const dump = join(dir, "backup.dump");
const started = Date.now();
let ok = false;
try {
  await timed("dump", () => writeFileSync(dump, compose(["pg_dump", "-U", user, "-d", database, "-Fc"])));
  console.info(`[restore] dump size: ${(statSync(dump).size / 1024 / 1024).toFixed(1)} MiB`);
  await timed("create scratch database", () => psql(`create database ${SCRATCH}`));
  await timed("restore", () => compose(["pg_restore", "-U", user, "-d", SCRATCH, "--no-owner", "--exit-on-error"], readFileSync(dump)));
  const restored = new URL(source);
  restored.pathname = `/${SCRATCH}`;
  ok = await timed("verify", () => verifyDatabase(restored.toString(), { compare: source }));
} finally {
  psql(`drop database if exists ${SCRATCH}`);
  rmSync(dir, { recursive: true, force: true });
}
console.info(`[restore] ${ok ? "rehearsal passed" : "rehearsal FAILED"} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
process.exitCode = ok ? 0 : 1;
