"use client";

import { toast } from "sonner";

/**
 * A drop-in replacement for `<form action={serverAction}>` that shows a
 * success/error toast when the action finishes — without changing the server
 * action itself. The form's `action` stays an async function, so a nested
 * <SubmitButton> still gets its pending state via useFormStatus.
 *
 * - Action returns `{ error }`  → error toast (with that message)
 * - Action throws              → generic error toast
 * - Action redirects/notFound  → re-thrown so navigation still happens
 * - Otherwise                  → success toast
 */
export function ToastForm({
  action,
  success,
  error,
  className,
  children,
}: {
  action: (formData: FormData) => Promise<unknown> | unknown;
  success: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <form
      className={className}
      action={async (formData) => {
        try {
          const result = await action(formData);
          if (
            result &&
            typeof result === "object" &&
            "error" in result &&
            (result as { error?: unknown }).error
          ) {
            toast.error(String((result as { error: unknown }).error));
          } else {
            toast.success(success);
          }
        } catch (e) {
          // Next.js signals redirect()/notFound() by throwing — let those pass
          // through so navigation still works.
          if (
            e &&
            typeof e === "object" &&
            "digest" in e &&
            typeof (e as { digest?: unknown }).digest === "string" &&
            (e as { digest: string }).digest.startsWith("NEXT_")
          ) {
            throw e;
          }
          toast.error(error ?? "Something went wrong. Please try again.");
        }
      }}
    >
      {children}
    </form>
  );
}
