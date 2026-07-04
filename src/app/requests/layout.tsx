import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/supabase/auth";
import { RequestsRouteFrame } from "./requests-route-frame";

export default async function RequestsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionUser();
  if (!session) redirect("/login");
  if (session.role === "decision_maker") redirect("/feed");

  return <RequestsRouteFrame>{children}</RequestsRouteFrame>;
}
