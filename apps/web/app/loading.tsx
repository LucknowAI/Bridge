/** Shown while a page's server data loads, so navigation never looks frozen. */
export default function Loading() {
  return <main style={{ minHeight: "100vh", maxWidth: 680, margin: "0 auto", padding: "12vh 24px" }}>
    <p role="status" style={{ color: "var(--muted)" }}>Loading…</p>
  </main>;
}
