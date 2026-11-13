/** Runs once when the Next.js server starts, before it serves any request. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertEnv } = await import("./src/lib/env");
  assertEnv("web");
}
