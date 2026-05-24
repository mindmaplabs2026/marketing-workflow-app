import { redirect } from "next/navigation";
import { ExchangeForm } from "./exchange-form";

export default async function NativeCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  if (!code) {
    redirect("/login?error=missing_code");
  }
  return <ExchangeForm code={code} />;
}
