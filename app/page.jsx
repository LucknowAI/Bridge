"use client";

import dynamic from "next/dynamic";

const MatchApp = dynamic(() => import("./MatchApp"), { ssr: false });

export default function Page() {
  return <MatchApp />;
}
