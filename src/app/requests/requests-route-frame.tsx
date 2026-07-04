"use client";

import { useSelectedLayoutSegment } from "next/navigation";

export function RequestsRouteFrame({ children }: { children: React.ReactNode }) {
  const segment = useSelectedLayoutSegment();

  if (segment === null) {
    return <>{children}</>;
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      {children}
    </div>
  );
}
