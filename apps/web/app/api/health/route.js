import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness probe for the ALB target group and the container HEALTHCHECK.
 *
 * Deliberately touches nothing external. If this returned unhealthy whenever
 * Postgres or Keycloak hiccuped, the load balancer would drain every task at
 * once and turn a recoverable dependency blip into a full outage. Dependency
 * health is reported separately by /api/health/ready.
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "match-maker-web",
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
}
