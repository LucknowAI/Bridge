"use client";

/**
 * AuthCallback.jsx
 * Place this at route /auth/callback
 * Supabase redirects here after Google OAuth.
 * We verify the signed-in email matches a registered attendee,
 * then either proceed or sign the user out.
 */

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function AuthCallback({ onAuthSuccess, onAuthFail }) {
  const [status, setStatus] = useState("Verifying your access…");

  useEffect(() => {
    const run = async () => {
      // Let Supabase finish the OAuth exchange
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error || !session) {
        setStatus("Authentication failed. Redirecting…");
        setTimeout(() => onAuthFail?.(), 2000);
        return;
      }

      const email = session.user.email?.toLowerCase().trim();

      // Cross-check against registered_attendees table
      const { data, error: dbErr } = await supabase
        .from("registered_attendees")
        .select("id")
        .eq("email", email)
        .maybeSingle();

      if (dbErr || !data) {
        // Email not on attendee list — sign out immediately
        await supabase.auth.signOut();
        setStatus("⛔ Your Google account is not registered. Redirecting…");
        setTimeout(() => onAuthFail?.(), 2500);
        return;
      }

      setStatus("✓ Access granted! Loading…");
      setTimeout(() => onAuthSuccess?.(session.user), 800);
    };

    run();
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0e", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, sans-serif" }}>
      <div style={{ color: "#f59e0b", fontSize: 14, letterSpacing: 1, textAlign: "center", fontWeight: 600 }}>
        <div style={{ marginBottom: 16, fontSize: 32 }}>◈</div>
        {status}
      </div>
    </div>
  );
}