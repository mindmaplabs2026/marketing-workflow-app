"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarDays,
  ClipboardList,
  House,
  Newspaper,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { UserRole } from "@/lib/supabase/types";

const navigationItems = [
  {
    id: "dashboard",
    label: "Home",
    icon: House,
  },
  {
    id: "requests",
    label: "Requests",
    icon: ClipboardList,
  },
  {
    id: "calendar",
    label: "Calendar",
    icon: CalendarDays,
  },
  {
    id: "published",
    label: "Published",
    icon: Newspaper,
  },
  {
    id: "admin",
    label: "Admin",
    icon: UserCog,
  },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  icon: LucideIcon;
}>;

type NavigationId = (typeof navigationItems)[number]["id"];
type NavigationItem = (typeof navigationItems)[number];

const routeById: Record<NavigationId, string> = {
  dashboard: "/",
  requests: "/requests",
  calendar: "/calendar",
  published: "/feed",
  admin: "/admin",
};

const rolesById: Record<NavigationId, UserRole[]> = {
  dashboard: ["super_admin", "designer", "school_admin", "teacher", "decision_maker"],
  requests: ["super_admin", "designer", "school_admin", "teacher"],
  calendar: ["super_admin", "designer", "school_admin", "teacher", "decision_maker"],
  published: ["super_admin", "designer", "school_admin", "teacher", "decision_maker"],
  admin: ["super_admin", "school_admin"],
};

const springTransition = {
  type: "spring",
  stiffness: 350,
  damping: 28,
  mass: 0.8,
} as const;

const SVG_HEIGHT = 92;
const BAR_TOP = 30;
const BAR_BOTTOM = 92;
const BAR_RADIUS = 0;
const NOTCH_RADIUS = 29;
const HORIZONTAL_INSET = 34;

function isRouteActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function getTabCenter(index: number, count: number, width: number): number {
  const usableWidth = width - HORIZONTAL_INSET * 2;
  return HORIZONTAL_INSET + usableWidth * ((index + 0.5) / count);
}

function getBarPath(centerX: number, width: number): string {
  const leftNotch = centerX - NOTCH_RADIUS;
  const rightNotch = centerX + NOTCH_RADIUS;
  const notchBottom = BAR_TOP + NOTCH_RADIUS;

  return [
    `M ${BAR_RADIUS} ${BAR_TOP}`,
    `L ${leftNotch} ${BAR_TOP}`,
    `C ${leftNotch} ${BAR_TOP + 16} ${centerX - 16} ${notchBottom} ${centerX} ${notchBottom}`,
    `C ${centerX + 16} ${notchBottom} ${rightNotch} ${BAR_TOP + 16} ${rightNotch} ${BAR_TOP}`,
    `L ${width} ${BAR_TOP}`,
    `L ${width} ${BAR_BOTTOM}`,
    `L 0 ${BAR_BOTTOM}`,
    `L 0 ${BAR_TOP}`,
    "Z",
  ].join(" ");
}

function getNotchOutlinePath(centerX: number): string {
  const leftNotch = centerX - NOTCH_RADIUS;
  const rightNotch = centerX + NOTCH_RADIUS;
  const notchBottom = BAR_TOP + NOTCH_RADIUS;

  return [
    `M ${leftNotch} ${BAR_TOP}`,
    `C ${leftNotch} ${BAR_TOP + 16} ${centerX - 16} ${notchBottom} ${centerX} ${notchBottom}`,
    `C ${centerX + 16} ${notchBottom} ${rightNotch} ${BAR_TOP + 16} ${rightNotch} ${BAR_TOP}`,
  ].join(" ");
}

function getActiveId(pathname: string, visibleItems: readonly NavigationItem[]): NavigationId {
  return (
    visibleItems.find((item) => isRouteActive(pathname, routeById[item.id]))?.id ??
    visibleItems[0]?.id ??
    "dashboard"
  );
}

export function FloatingBottomNavigation({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const router = useRouter();
  const navRef = useRef<HTMLDivElement>(null);
  const [navWidth, setNavWidth] = useState(400);
  const visibleItems = useMemo(
    () => navigationItems.filter((item) => rolesById[item.id].includes(role)),
    [role],
  );
  const routeActiveTab = getActiveId(pathname, visibleItems);
  const [activeTab, setActiveTab] = useState<NavigationId>("dashboard");
  const selectedTab = isRouteActive(pathname, routeById[activeTab])
    ? activeTab
    : routeActiveTab;
  const activeIndex = Math.max(
    0,
    visibleItems.findIndex((item) => item.id === selectedTab),
  );
  const activeCenter = getTabCenter(activeIndex, visibleItems.length, navWidth);
  const barPath = getBarPath(activeCenter, navWidth);
  const notchOutlinePath = getNotchOutlinePath(activeCenter);

  useEffect(() => {
    const node = navRef.current;
    if (!node) return;

    const updateWidth = () => {
      setNavWidth(Math.round(node.getBoundingClientRect().width));
    };
    const frame = requestAnimationFrame(updateWidth);

    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-0 md:hidden"
    >
      <div ref={navRef} className="relative h-[92px] w-full max-w-none overflow-visible">
        <svg
          aria-hidden="true"
          className="absolute inset-0 h-full w-full overflow-visible drop-shadow-[0_18px_32px_rgba(15,23,42,0.18)]"
          viewBox={`0 0 ${navWidth} ${SVG_HEIGHT}`}
        >
          <motion.path
            d={barPath}
            fill="rgba(255,255,255,0.94)"
            stroke="rgba(228,228,231,0.82)"
            strokeWidth="1"
            transition={springTransition}
          />
          <motion.path
            d={notchOutlinePath}
            fill="none"
            stroke="rgba(39,39,42,0.48)"
            strokeLinecap="round"
            strokeWidth="4"
            transition={springTransition}
          />
        </svg>
        <ul className="relative z-10 grid h-full grid-flow-col auto-cols-fr items-center px-[34px] pt-[30px]">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const active = selectedTab === item.id;
            const itemIndex = visibleItems.findIndex((navItem) => navItem.id === item.id);
            const distanceFromActive = Math.abs(activeIndex - itemIndex);

            return (
              <li key={item.id} className="relative flex h-full items-center justify-center">
                <button
                  type="button"
                  aria-label={item.label}
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    setActiveTab(item.id);
                    router.push(routeById[item.id]);
                  }}
                  className="group relative flex h-full w-full items-center justify-center rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-violet-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                >
                  {active ? (
                    <motion.div
                      layoutId="floating-nav-active-circle"
                      className="absolute -top-[29px] z-10 flex h-[58px] w-[58px] items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-blue-600 text-white shadow-[0_16px_30px_rgba(124,58,237,0.26)]"
                      transition={springTransition}
                    >
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, scale: 0.8, y: 2 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <Icon aria-hidden="true" size={22} strokeWidth={2} />
                      </motion.div>
                    </motion.div>
                  ) : (
                    <motion.span
                      className="flex items-center justify-center text-[#6B7280]"
                      initial={false}
                      animate={{
                        opacity: 0.7,
                        scale: 0.95,
                        x:
                          distanceFromActive === 1
                            ? activeIndex > itemIndex
                              ? -12
                              : 12
                            : 0,
                      }}
                      whileHover={{ scale: 1.1, opacity: 1 }}
                      whileTap={{ scale: 0.92 }}
                      transition={{ duration: 0.16 }}
                    >
                      <Icon aria-hidden="true" size={21} strokeWidth={2} />
                    </motion.span>
                  )}

                  <AnimatePresence mode="wait">
                    {active ? (
                      <motion.span
                        key={`${item.id}-label`}
                        className="absolute bottom-[16px] z-10 max-w-[78px] truncate text-[11px] font-bold leading-none text-zinc-950"
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        transition={{ duration: 0.24 }}
                      >
                        {item.label}
                      </motion.span>
                    ) : null}
                  </AnimatePresence>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
