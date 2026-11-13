"use client";

import { Suspense } from "react";
import { useRouter } from "next/navigation";
import Login from "../login.jsx";

function LoginRoute() {
  const router = useRouter();
  return (
    <Login
      onAuthSuccess={(returnTo) => {
        // The session cookie is set by the API response, so a refresh is needed
        // for the server to see it on the next request.
        router.replace(returnTo || "/");
        router.refresh();
      }}
    />
  );
}

export default function LoginPage() {
  // `useSearchParams` (used for the ?error= handling) needs a Suspense boundary.
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#0a0a0e" }} />}>
      <LoginRoute />
    </Suspense>
  );
}
