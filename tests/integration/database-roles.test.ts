/**
 * The least-privilege logins against a real Postgres. Creates its own roles and
 * Keycloak-style database, removes them afterwards, and restores the default
 * CONNECT grant it revokes on the local application database.
 * Skipped when DATABASE_URL is unset.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/src/migrate";
import { ensureRoles } from "../../packages/db/src/ensure-roles";

const databaseUrl = process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

const suffix = randomBytes(3).toString("hex");
const runtime = { user: `test_runtime_${suffix}`, password: randomBytes(12).toString("hex") };
const keycloak = { user: `test_kc_${suffix}`, password: randomBytes(12).toString("hex"), database: `test_kc_db_${suffix}` };

function urlFor(user?: { user: string; password: string }, database?: string): string {
  const url = new URL(databaseUrl!);
  if (user) {
    url.username = user.user;
    url.password = user.password;
  }
  if (database) url.pathname = `/${database}`;
  return url.toString();
}

async function as<T>(connection: string, work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: connection });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

describeDb("least-privilege database logins", () => {
  const appDatabase = () => new URL(databaseUrl!).pathname.slice(1);

  beforeAll(async () => {
    await migrate();
    // A Keycloak database that an earlier deploy filled as the master user.
    await as(urlFor(undefined, "postgres"), (c) => c.query(`create database ${keycloak.database}`));
    await as(urlFor(undefined, keycloak.database), (c) => c.query(`create table realm (id serial primary key, name text)`));
    await ensureRoles(databaseUrl!, { runtime, keycloak });
  });

  afterAll(async () => {
    await as(urlFor(undefined, "postgres"), (c) => c.query(`drop database if exists ${keycloak.database}`));
    await as(databaseUrl!, async (c) => {
      await c.query(`grant connect on database ${c.escapeIdentifier(appDatabase())} to public`);
      await c.query(`drop owned by ${runtime.user}, ${keycloak.user}`);
      await c.query(`drop role if exists ${runtime.user}`);
      await c.query(`drop role if exists ${keycloak.user}`);
    });
  });

  it("lets the runtime login read and write application rows", async () => {
    await as(urlFor(runtime), async (c) => {
      const key = `test:roles:${suffix}`;
      await c.query(`insert into rate_limit_buckets (bucket_key, window_started_at, count) values ($1, now(), 1)`, [key]);
      expect((await c.query(`select count(*)::int as n from rate_limit_buckets where bucket_key = $1`, [key])).rows[0].n).toBe(1);
      await c.query(`delete from rate_limit_buckets where bucket_key = $1`, [key]);
    });
  });

  it("refuses the runtime login any schema change", async () => {
    await as(urlFor(runtime), async (c) => {
      await expect(c.query(`create table test_forbidden (id int)`)).rejects.toThrow(/permission denied/);
      await expect(c.query(`drop table rate_limit_buckets`)).rejects.toThrow(/must be owner|permission denied/);
    });
  });

  it("keeps the runtime login out of the Keycloak database", async () => {
    await expect(as(urlFor(runtime, keycloak.database), (c) => c.query("select 1"))).rejects.toThrow(/permission denied/);
  });

  it("makes the Keycloak login own its database, including older tables", async () => {
    await as(urlFor(keycloak, keycloak.database), async (c) => {
      const owner = await c.query(`select tableowner from pg_tables where tablename = 'realm'`);
      expect(owner.rows[0].tableowner).toBe(keycloak.user);
      await c.query(`alter table realm add column if not exists display_name text`);
      await c.query(`insert into realm (name) values ('match-maker')`);
    });
  });

  it("keeps the Keycloak login out of the application database", async () => {
    await expect(as(urlFor(keycloak), (c) => c.query("select 1"))).rejects.toThrow(/permission denied/);
  });

  it("is safe to run again and updates passwords", async () => {
    const rotated = { ...runtime, password: randomBytes(12).toString("hex") };
    await ensureRoles(databaseUrl!, { runtime: rotated });
    await expect(as(urlFor(rotated), (c) => c.query("select 1 from events limit 1"))).resolves.toBeDefined();
    await expect(as(urlFor(runtime), (c) => c.query("select 1"))).rejects.toThrow(/password/);
  });
});
