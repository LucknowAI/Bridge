import Link from "next/link";

export default function NotFound() {
  return <main style={{ minHeight: "100vh", maxWidth: 680, margin: "0 auto", padding: "12vh 24px" }}>
    <h1>Page not found.</h1>
    <p>This event or page does not exist, or it is not open right now.</p>
    <Link className="btn" href="/" style={{ display: "inline-block", marginTop: 12, textDecoration: "none" }}>Go to the start</Link>
  </main>;
}
