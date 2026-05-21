import "server-only";
import { Resend } from "resend";

let cached: Resend | null = null;

export function resendClient(): Resend | null {
  if (cached) return cached;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  cached = new Resend(key);
  return cached;
}

export function emailFrom(): string {
  return process.env.EMAIL_FROM || "onboarding@resend.dev";
}

export function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "http://localhost:3000"
  );
}
