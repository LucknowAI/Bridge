"use client";

import AuthCallback from "../../../backend/authcallback.jsx";
import { useRouter } from "next/navigation";

export default function CallbackPage() {
  const router = useRouter();

  return (
    <AuthCallback
      onAuthSuccess={() => router.push("/")}
      onAuthFail={() => router.push("/login")}
    />
  );
}
