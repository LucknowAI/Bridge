"use client";

import Login from "../login.jsx";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  return <Login onAuthSuccess={() => router.push("/")} />;
}
