import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function NotificationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      {children}
    </div>
  );
}
