import "dotenv/config";

const issuer = (process.env.KEYCLOAK_INTERNAL_ISSUER || process.env.KEYCLOAK_ISSUER || "http://localhost:8080/realms/match-maker").replace(/\/$/, "");
const url = `${issuer}/.well-known/openid-configuration`;
const deadline = Date.now() + 120_000;

while (Date.now() < deadline) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      console.info(`[keycloak:wait] ready at ${url}`);
      process.exit(0);
    }
  } catch {
    // A short retry interval gives a useful local command while Keycloak warms up.
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

console.error(`[keycloak:wait] timed out waiting for ${url}`);
process.exit(1);
