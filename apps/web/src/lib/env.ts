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
  DATABASE_SSL: ["disable", "require"],
  EMBEDDING_PROVIDER: ["gemini", "local"],
  EMAIL_DEV_FALLBACK: ["true", "false"],
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

  if (role === "web") {
    const secret = value("SESSION_SECRET");
    if (secret && secret.length < 32) {
      problems.push("SESSION_SECRET must be at least 32 characters.");
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

function isHttpUrl(raw: string): boolean {
  try {
    const { protocol } = new URL(raw);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
