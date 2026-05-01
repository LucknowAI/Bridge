import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function POST(req) {
  try {
    const { phone } = await req.json();
    if (!phone) return NextResponse.json({ error: "Phone required" }, { status: 400 });

    // Normalize to E.164
    const digits = phone.replace(/\D/g, "");
    const normalized =
      digits.length === 10 ? `+91${digits}` :
      digits.length === 12 && digits.startsWith("91") ? `+${digits}` :
      phone.startsWith("+") ? phone.trim() : `+${digits}`;

    const { data, error } = await supabase
      .from("registered_attendees")
      .select("email, name")
      .eq("phone", normalized)
      .maybeSingle();

    if (error) return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
    if (!data?.email) return NextResponse.json({ registered: false }, { status: 200 });

    return NextResponse.json({ registered: true, email: data.email, name: data.name });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
