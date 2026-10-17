"use client";

import { useRouter } from "next/navigation";
import Login from "../login.jsx";

export default function LoginRoute({ googleEnabled }) {
  const router = useRouter();
  return (
    <Login
      googleEnabled={googleEnabled}
      onAuthSuccess={(returnTo) => {
        // The session cookie is set by the API response, so a refresh is needed
        // for the server to see it on the next request.
        router.replace(returnTo || "/");
        router.refresh();
      }}
    />
  );
}
