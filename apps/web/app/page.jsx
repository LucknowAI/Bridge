import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function HomePage() {
  redirect(`/e/${process.env.DEFAULT_EVENT_SLUG || "demo"}`);
}
