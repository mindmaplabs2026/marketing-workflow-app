import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/supabase/auth";

export default async function CalendarLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionUser();
  if (!session) redirect("/login");

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      {children}
    </div>
  );
}
