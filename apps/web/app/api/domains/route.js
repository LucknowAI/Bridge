import { NextResponse } from "next/server";
import { attendees } from "@match-maker/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Distinct domains for the profile dropdown. Signed-in users only. */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const domains = await attendees.listDomains();
  return NextResponse.json({ domains });
}
