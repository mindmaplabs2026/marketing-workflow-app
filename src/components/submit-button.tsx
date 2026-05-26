"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  className,
  pendingLabel,
  children,
}: {
  className?: string;
  pendingLabel?: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${className ?? ""} disabled:cursor-not-allowed disabled:opacity-70`}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
