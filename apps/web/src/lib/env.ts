/**
 * Startup validation for runtime settings.
 *
 * Modules still read `process.env` lazily; this check only runs once at boot so
 * a misconfigured process stops immediately with every problem listed, instead
 * of failing on the first request that happens to need a missing value.
 */

export type EnvRole = "web" | "worker";

type Env = Record<string, string | undefined>;

const REQUIRED: Record<EnvRole, string[]> = {
  web: ["DATABASE_URL", "SESSION_SECRET", "KEYCLOAK_ISSUER", "KEYCLOAK_CLIENT_ID", "KEYCLOAK_CLIENT_SECRET"],
  worker: ["DATABASE_URL"],
};

const URLS = ["APP_BASE_URL", "KEYCLOAK_ISSUER", "KEYCLOAK_INTERNAL_ISSUER", "LOCAL_BGE_URL", "UPSTASH_REDIS_REST_URL"];

const POSITIVE_INTEGERS = [
  "DATABASE_POOL_MAX",
  "SESSION_MAX_AGE",
  "OTP_TTL_SECONDS",
  "OTP_MAX_PER_WINDOW",
  "OTP_RATE_WINDOW_SECONDS",
];

const ALLOWED: Record<string, string[]> = {
  DATABASE_SSL: ["disable", "require", "verify"],
  EMBEDDING_PROVIDER: ["gemini", "local", "hash"],
  EMAIL_DEV_FALLBACK: ["true", "false"],
  TRUSTED_PROXY_HOPS: ["0", "1", "2", "3"],
};

/** Returns one human-readable message per problem; empty when valid. */
export function checkEnv(role: EnvRole, env: Env = process.env): string[] {
  const problems: string[] = [];
  const value = (name: string) => env[name]?.trim() || undefined;

  for (const name of REQUIRED[role]) {
    if (!value(name)) problems.push(`${name} is required but not set.`);
  }

  for (const name of URLS) {
    const raw = value(name);
    if (raw && !isHttpUrl(raw)) problems.push(`${name} must be an http(s) URL, got "${raw}".`);
  }

  for (const name of POSITIVE_INTEGERS) {
    const raw = value(name);
    if (raw && !/^[1-9]\d*$/.test(raw)) problems.push(`${name} must be a positive integer, got "${raw}".`);
  }

  for (const [name, allowed] of Object.entries(ALLOWED)) {
    const raw = value(name);
    if (raw && !allowed.includes(raw)) {
      problems.push(`${name} must be one of ${allowed.join(", ")}, got "${raw}".`);
    }
  }

  const databaseUrl = value("DATABASE_URL");
  if (databaseUrl && !/^postgres(ql)?:\/\//.test(databaseUrl)) {
    problems.push("DATABASE_URL must start with postgres:// or postgresql://.");
  }

  // Production must not quietly fall back to unverified or plain transport.
  // Local hosts are exempt so the docker-compose stack still runs as production.
  if (value("NODE_ENV") === "production") {
    if (value("EMBEDDING_PROVIDER") === "hash") {
      problems.push("EMBEDDING_PROVIDER=hash is for capacity tests only and cannot run in production.");
    }
    if (databaseUrl && !isLocalHost(databaseUrl)) {
      if (value("DATABASE_SSL") !== "verify") {
        problems.push("DATABASE_SSL must be verify in production, so the database certificate is checked.");
      } else if (!value("DATABASE_CA_CERT") && !value("DATABASE_CA_CERT_FILE")) {
        problems.push("DATABASE_SSL=verify needs DATABASE_CA_CERT or DATABASE_CA_CERT_FILE (the RDS CA bundle).");
      }
    }
    const base = value("APP_BASE_URL");
    if (role === "web" && !base) problems.push("APP_BASE_URL is required in production.");
    if (role === "web" && base && isHttpUrl(base) && !isLocalHost(base) && new URL(base).protocol !== "https:") {
      problems.push(`APP_BASE_URL must use https in production, got "${base}".`);
    }
  }

  if (role === "web") {
    const secret = value("SESSION_SECRET");
    if (secret && secret.length < 32) {
      problems.push("SESSION_SECRET must be at least 32 characters.");
    }

    // Login depends on e-mail, so a deploy that cannot send it must not boot.
    if (!value("RESEND_API_KEY") && value("EMAIL_DEV_FALLBACK") !== "true") {
      problems.push("RESEND_API_KEY is required to send login e-mail (EMAIL_DEV_FALLBACK=true logs codes instead, local only).");
    }
    const from = value("EMAIL_FROM");
    if (value("RESEND_API_KEY") && !from) {
      problems.push("EMAIL_FROM is required when RESEND_API_KEY is set, using a sender on a domain verified in Resend.");
    }
    if (from && !isSenderAddress(from)) {
      problems.push(`EMAIL_FROM must be "address@domain" or "Name <address@domain>", got "${from}".`);
    }
  }

  if (value("EMBEDDING_PROVIDER") === "local" && !value("LOCAL_BGE_URL")) {
    problems.push("LOCAL_BGE_URL is required when EMBEDDING_PROVIDER=local.");
  }

  if (Boolean(value("UPSTASH_REDIS_REST_URL")) !== Boolean(value("UPSTASH_REDIS_REST_TOKEN"))) {
    problems.push("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set together.");
  }

  return problems;
}

/** Throws one error listing every problem, so a bad deploy fails at boot. */
export function assertEnv(role: EnvRole, env: Env = process.env): void {
  const problems = checkEnv(role, env);
  if (problems.length === 0) return;
  throw new Error(
    `Invalid ${role} configuration:\n` +
      problems.map((problem) => `  - ${problem}`).join("\n") +
      "\nSee .env.example for every setting."
  );
}

function isSenderAddress(raw: string): boolean {
  const address = raw.match(/^[^<>]*<([^<>]+)>$/)?.[1] ?? raw;
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address.trim());
}

function isLocalHost(raw: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "postgres"].includes(new URL(raw).hostname);
  } catch {
    return false;
  }
}

function isHttpUrl(raw: string): boolean {
  try {
    const { protocol } = new URL(raw);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
