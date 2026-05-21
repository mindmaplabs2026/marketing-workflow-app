import { LoginForm } from "./login-form";

const ERROR_LABELS: Record<string, string> = {
  missing_code: "That sign-in link is incomplete. Request a new one.",
};

function friendlyError(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return ERROR_LABELS[raw] ?? raw;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return <LoginForm initialError={friendlyError(error)} />;
}
