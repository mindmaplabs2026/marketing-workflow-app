"use client";

import type { ReactNode } from "react";

/**
 * A form wrapper that shows a browser confirm dialog before submitting.
 * Use for destructive actions like archive, delete, and remove.
 */
export function ConfirmForm({
  action,
  message,
  children,
  className,
}: {
  action: (formData: FormData) => void;
  message: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <form
      action={action}
      className={className}
      onSubmit={(e) => {
        if (!window.confirm(message)) {
          e.preventDefault();
        }
      }}
    >
      {children}
    </form>
  );
}
