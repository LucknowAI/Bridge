import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retired (R07). Listed the domains of every attendee across all
 * organizations for the old single-page matcher (app/MatchApp.jsx). The
 * event profile form now uses free-text domains scoped to its event.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  return NextResponse.json({ error: "This endpoint has been retired." }, { status: 410 });
}
