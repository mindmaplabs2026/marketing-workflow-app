"use client";

import { usePathname, useSelectedLayoutSegment } from "next/navigation";

export function RequestsRouteFrame({ children }: { children: React.ReactNode }) {
  const segment = useSelectedLayoutSegment();
  const pathname = usePathname();

  if (segment === null) {
    return <>{children}</>;
  }

  const parts = pathname.split("/").filter(Boolean);
  const isRequestDetail = parts[0] === "requests" && parts.length === 2;

  if (isRequestDetail) {
    return <>{children}</>;
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      {children}
    </div>
  );
}
