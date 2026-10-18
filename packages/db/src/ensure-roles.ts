/**
 * Create or update the least-privilege database logins. The migration task runs
 * this as the master user, before migrations:
 *
 *   runtime   web and worker: read and write application rows; no DDL, and no
 *             access to other databases
 *   keycloak  owns the Keycloak database and nothing in the application one
 *
 * The master login is then used only by migrations. Passwords come from the
 * task's secrets, and re-running updates them, so rotation is a redeploy.
 *
 * Usage:  tsx packages/db/src/ensure-roles.ts
 *   DATABASE_URL                      master connection to the application database
 *   DATABASE_RUNTIME_USER / _PASSWORD runtime login (skipped when unset)
 *   KEYCLOAK_DB_USER / _PASSWORD      Keycloak login (skipped when unset)
 *   KEYCLOAK_DB_NAME                  Keycloak database (default "keycloak")
 */
import "dotenv/config";
import pg from "pg";
import { isMainModule } from "./is-main";
import { resolveSsl } from "./client";

export interface RoleSpec {
  runtime?: { user: string; password: string };
  keycloak?: { user: string; password: string; database: string };
}

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

export async function ensureRoles(databaseUrl: string, spec: RoleSpec): Promise<void> {
  for (const name of [spec.runtime?.user, spec.keycloak?.user, spec.keycloak?.database]) {
    if (name !== undefined && !IDENTIFIER.test(name)) throw new Error(`Invalid role or database name: ${name}`);
  }

  const app = await connect(databaseUrl);
  try {
    if (spec.runtime) await ensureRuntime(app, spec.runtime.user, spec.runtime.password, new URL(databaseUrl).pathname.slice(1));
    if (spec.keycloak) await ensureLogin(app, spec.keycloak.user, spec.keycloak.password);
  } finally {
    await app.end();
  }

  if (spec.keycloak) {
    const url = new URL(databaseUrl);
    url.pathname = `/${spec.keycloak.database}`;
    const identity = await connect(url.toString());
    try {
      await ensureKeycloakOwner(identity, spec.keycloak.user, spec.keycloak.database);
    } finally {
      await identity.end();
    }
  }
}

async function connect(connectionString: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString, ssl: resolveSsl(connectionString) });
  await client.connect();
  return client;
}

async function ensureLogin(client: pg.Client, user: string, password: string): Promise<void> {
  const role = client.escapeIdentifier(user);
  const { rowCount } = await client.query(`select 1 from pg_roles where rolname = $1`, [user]);
  if (!rowCount) await client.query(`create role ${role} login`);
  await client.query(`alter role ${role} with login nosuperuser nocreatedb nocreaterole password ${client.escapeLiteral(password)}`);
  console.log(`[ensure-roles] login ${user} ready`);
}

async function ensureRuntime(client: pg.Client, user: string, password: string, database: string): Promise<void> {
  await ensureLogin(client, user, password);
  const role = client.escapeIdentifier(user);
  const db = client.escapeIdentifier(database);
  for (const statement of [
    // Only named logins may connect to the application database.
    `revoke connect on database ${db} from public`,
    `grant connect on database ${db} to ${role}`,
    `grant usage on schema public to ${role}`,
    `grant select, insert, update, delete on all tables in schema public to ${role}`,
    `grant usage, select on all sequences in schema public to ${role}`,
    // Tables and sequences that later migrations create (as this master login).
    `alter default privileges in schema public grant select, insert, update, delete on tables to ${role}`,
    `alter default privileges in schema public grant usage, select on sequences to ${role}`,
  ]) await client.query(statement);
  console.log(`[ensure-roles] ${user} can read and write ${database} rows, without DDL`);
}

/**
 * Makes the Keycloak login own its database and every object in it, including
 * tables an earlier deploy created as the master user. Objects are handed over
 * one by one: REASSIGN OWNED would also move databases the master owns.
 */
async function ensureKeycloakOwner(client: pg.Client, user: string, database: string): Promise<void> {
  const role = client.escapeIdentifier(user);
  const db = client.escapeIdentifier(database);
  // A non-superuser master (RDS) may only transfer ownership to roles it belongs to.
  await client.query(`grant ${role} to current_user`).catch(() => {});
  await client.query(`alter database ${db} owner to ${role}`);
  await client.query(`revoke connect on database ${db} from public`);
  await client.query(`grant connect on database ${db} to ${role}`);
  await client.query(
    `do $$
     declare item record;
     begin
       for item in
         select 'table' as kind, format('%I.%I', schemaname, tablename) as name from pg_tables
          where schemaname = 'public' and tableowner = current_user
         union all
         select 'view', format('%I.%I', schemaname, viewname) from pg_views
          where schemaname = 'public' and viewowner = current_user
         union all
         select 'sequence', format('%I.%I', schemaname, sequencename) from pg_sequences
          where schemaname = 'public' and sequenceowner = current_user
       loop
         begin
           execute format('alter %s %s owner to %s', item.kind, item.name, ${client.escapeLiteral(role)});
         exception when others then
           -- Sequences owned by a column move with their table.
           null;
         end;
       end loop;
     end $$`
  );
  console.log(`[ensure-roles] ${user} owns database ${database}`);
}

function pair(user: string | undefined, password: string | undefined, label: string) {
  if (!user && !password) return undefined;
  if (!user || !password) throw new Error(`${label} user and password must be set together`);
  return { user, password };
}

if (isMainModule(import.meta.url)) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[ensure-roles] DATABASE_URL is not set");
    process.exit(1);
  }
  const runtime = pair(process.env.DATABASE_RUNTIME_USER, process.env.DATABASE_RUNTIME_PASSWORD, "DATABASE_RUNTIME");
  const keycloakLogin = pair(process.env.KEYCLOAK_DB_USER, process.env.KEYCLOAK_DB_PASSWORD, "KEYCLOAK_DB");
  const keycloak = keycloakLogin && { ...keycloakLogin, database: process.env.KEYCLOAK_DB_NAME || "keycloak" };
  if (!runtime && !keycloak) console.log("[ensure-roles] no logins configured; nothing to do");
  ensureRoles(databaseUrl, { runtime, keycloak })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[ensure-roles] failed:", err.message);
      process.exit(1);
    });
}
