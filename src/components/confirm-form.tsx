"use client";

import { useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "./confirm-dialog";

export function ConfirmForm({
  action,
  message,
  title,
  confirmLabel,
  destructive = true,
  children,
  className,
}: {
  action: (formData: FormData) => void;
  message: string;
  title?: string;
  confirmLabel?: string;
  destructive?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const skipNext = useRef(false);
  const [open, setOpen] = useState(false);

  return (
    <>
      <form
        ref={formRef}
        action={action}
        className={className}
        onSubmit={(e) => {
          if (skipNext.current) {
            skipNext.current = false;
            return;
          }
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
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false);
          skipNext.current = true;
          formRef.current?.requestSubmit();
        }}
      />
    </>
  );
}
