"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "./confirm-dialog";

export function ConfirmForm({
  action,
  message,
  title,
  confirmLabel,
  destructive = true,
  success,
  children,
  className,
}: {
  action: (formData: FormData) => void | Promise<unknown>;
  message: string;
  title?: string;
  confirmLabel?: string;
  destructive?: boolean;
  /** Optional toast shown if the action completes without redirecting. */
  success?: string;
  children: ReactNode;
  className?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    startTransition(async () => {
      try {
        await action(fd);
        if (success) toast.success(success);
        setOpen(false);
      } catch (e) {
        // redirect()/notFound() throw a NEXT_* control-flow signal — let it
        // propagate so navigation still happens (that's a successful action).
        if (
          e &&
          typeof e === "object" &&
          "digest" in e &&
          typeof (e as { digest?: unknown }).digest === "string" &&
          (e as { digest: string }).digest.startsWith("NEXT_")
        ) {
          throw e;
        }
        toast.error(e instanceof Error ? e.message : "Something went wrong.");
        setOpen(false);
      }
    });
  }

  return (
    <>
      <form
        ref={formRef}
        className={className}
        onSubmit={(e) => {
          // The submit button just opens the confirm dialog; the real work
          // runs from confirm() so we can show a pending state + feedback.
          e.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </form>
      <ConfirmDialog
        open={open}
        title={title}
        message={message}
        confirmLabel={confirmLabel}
        destructive={destructive}
        busy={pending}
        onCancel={() => {
          if (!pending) setOpen(false);
        }}
        onConfirm={confirm}
      />
    </>
  );
}
