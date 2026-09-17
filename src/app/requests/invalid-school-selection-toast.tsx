"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

export function InvalidSchoolSelectionToast() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasHandledSelection = useRef(false);

  useEffect(() => {
    if (hasHandledSelection.current) return;
    hasHandledSelection.current = true;

    toast.error("You are not a member of this school.");

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("school");
    const queryString = nextParams.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname);
  }, [pathname, router, searchParams]);

  return null;
}
