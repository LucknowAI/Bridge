"use client";

import Link from "next/link";
import { useEffect } from "react";

/** Shown instead of a blank crash page when a page fails to render. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return <main role="alert" style={shell}>
    <h1>Something went wrong.</h1>
    <p>This page could not load. Please try again; if it keeps happening, sign in again or contact the event organizer.</p>
    {error.digest && <p style={{ color: "var(--muted)" }}>Reference: {error.digest}</p>}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 20 }}>
      <button className="btn" onClick={reset}>Try again</button>
      <Link className="btn btn-secondary" href="/" style={{ textDecoration: "none" }}>Go to the start</Link>
    </div>
  </main>;
}

const shell = { minHeight: "100vh", maxWidth: 680, margin: "0 auto", padding: "12vh 24px" } as const;
