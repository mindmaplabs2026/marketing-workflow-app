import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/supabase/auth";

export default async function RequestsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionUser();
  if (!session) redirect("/login");
  if (session.role === "decision_maker") redirect("/feed");

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      {children}
    </div>
  );
}
