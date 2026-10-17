import { Suspense } from "react";
import { isGoogleSignInEnabled } from "@match-maker/auth";
import LoginRoute from "./login-route.jsx";

// Read Google availability per request, not once at build time.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  // `useSearchParams` (used for the ?error= handling) needs a Suspense boundary.
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#0a0a0e" }} />}>
      <LoginRoute googleEnabled={isGoogleSignInEnabled()} />
    </Suspense>
  );
}
