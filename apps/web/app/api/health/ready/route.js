import { NextResponse } from "next/server";
import { query } from "@match-maker/db";
import { discover } from "@match-maker/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Readiness probe — reports whether dependencies are actually reachable.
 *
 * Used by deploy scripts and dashboards, NOT by the ALB target group (see
 * /api/health for why). Checks run in parallel so one slow dependency doesn't
 * serialise the whole response.
 */
export async function GET() {
  const [database, keycloak] = await Promise.all([
    check(async () => {
      await query("select 1");
    }),
    check(async () => {
      await discover();
    }),
  ]);

  const ready = database.ok && keycloak.ok;

  return NextResponse.json(
    { ready, checks: { database, keycloak }, timestamp: new Date().toISOString() },
    { status: ready ? 200 : 503 }
  );
}

async function check(fn) {
  const startedAt = Date.now();
  try {
    await fn();
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
