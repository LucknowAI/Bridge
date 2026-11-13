import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retired (R07). This endpoint used to rank the whole attendee directory —
 * every organization and event, hidden profiles included — through its own
 * Gemini prompt and a process-wide uploaded file. Matching now happens only
 * inside an event, through the shared pipeline: saved matches at
 * /e/<event>/matches and search at /e/<event>/search, both of which check
 * event membership and profile eligibility.
 *
 * The route file stays so old clients get a clear answer instead of a 404.
 */
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  return NextResponse.json(
    {
      error: "This matching endpoint has been retired. Open your event's matches page instead.",
      matchesPath: "/e/<event>/matches",
    },
    { status: 410 }
  );
}
