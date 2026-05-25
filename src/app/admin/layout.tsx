import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/supabase/auth";
import { AdminTabs } from "./admin-tabs";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionUser();
  if (!session) redirect("/login");
  if (session.role !== "super_admin") redirect("/?denied=1");

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 border-b border-zinc-200 dark:border-zinc-800">
        <AdminTabs />
      </div>
      {children}
    </div>
  );
}
