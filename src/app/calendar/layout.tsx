import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/supabase/auth";

export default async function CalendarLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionUser();
  if (!session) redirect("/login");

  return <div className="w-full px-4 pb-6 pt-3 sm:px-6 lg:pl-8 lg:pr-4">{children}</div>;
}
