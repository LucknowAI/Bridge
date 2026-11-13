import { NextResponse } from "next/server";
import { attendees } from "@match-maker/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The signed-in user's session plus their roster profile.
 *
 * Replaces the browser's direct `registered_attendees` query. The profile is
 * read by id from the session, so a caller can only ever fetch their own row.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const profile = await attendees.findById(session.attendeeId);
  if (!profile) {
    // On the roster at login, removed since. Treat as signed out.
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      email: session.email,
      name: session.name,
      method: session.method,
    },
    profile: {
      id: profile.id,
      name: profile.name,
      email: profile.email,
      phone: profile.phone,
      about_me: profile.about_me,
      designation: profile.designation,
      domain: profile.domain,
      self_description: profile.self_description,
      years_of_experience: profile.years_of_experience,
      most_impressive_build: profile.most_impressive_build,
    },
  });
}
