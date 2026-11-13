/**
 * Integration suites skip themselves when their services are missing, so a
 * bare `npm test` works anywhere. In CI that would let them pass silently:
 * set REQUIRE_SERVICES (e.g. "db,keycloak") and the run fails up front
 * unless every listed service is reachable.
 */
export default async function requireServices(): Promise<void> {
  const required = (process.env.REQUIRE_SERVICES ?? "").split(",").map((name) => name.trim()).filter(Boolean);
  if (!required.length) return;
  await import("dotenv/config");
  const problems: string[] = [];

  if (required.includes("db")) {
    if (!process.env.DATABASE_URL) {
      problems.push("DATABASE_URL is not set");
    } else {
      const { default: pg } = await import("pg");
      const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
      try {
        await client.connect();
        await client.query("select 1");
      } catch (error) {
        problems.push(`Postgres is unreachable: ${(error as Error).message}`);
      } finally {
        await client.end().catch(() => {});
      }
    }
  }

  if (required.includes("keycloak")) {
    const issuer = (process.env.KEYCLOAK_INTERNAL_ISSUER || process.env.KEYCLOAK_ISSUER || "").replace(/\/$/, "");
    if (!issuer || !process.env.KEYCLOAK_ADMIN_PASSWORD) {
      problems.push("KEYCLOAK_ISSUER and KEYCLOAK_ADMIN_PASSWORD must be set");
    } else {
      const ok = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000) }).then((res) => res.ok).catch(() => false);
      if (!ok) problems.push(`Keycloak is unreachable at ${issuer}`);
    }
  }

  const unknown = required.filter((name) => !["db", "keycloak"].includes(name));
  if (unknown.length) problems.push(`Unknown REQUIRE_SERVICES entries: ${unknown.join(", ")}`);
  if (problems.length) {
    throw new Error(`Required test services are not available, so integration suites would skip:\n  - ${problems.join("\n  - ")}`);
  }
}
