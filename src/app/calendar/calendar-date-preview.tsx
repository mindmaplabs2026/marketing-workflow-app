"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, ExternalLink, Trash2 } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import type { CalendarItemStatus } from "@/lib/supabase/types";
import { ConfirmForm } from "@/components/confirm-form";
import { deleteCalendarItem } from "./actions";
import { CAL_STATUS_BADGE_CLASS } from "./status";

export type CalendarPreviewItem = {
  id: string;
  linkedRequestId: string | null;
  title: string;
  description: string | null;
  status: CalendarItemStatus;
  statusLabel: string;
  channel: string;
  canDelete: boolean;
};

/**
 * A small fixed preview avoids clipping inside the calendar's scrollable grid.
 * It stays reachable via hover, keyboard focus, and click/tap on the date's posts.
 */
export function CalendarDatePreview({
  dateLabel,
  items,
  children,
}: {
  dateLabel: string;
  items: CalendarPreviewItem[];
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState({ top: 12, left: 12 });

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  function placePreview() {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;

    const width = Math.min(336, window.innerWidth - 24);
    const previewHeight = 244;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const below = rect.bottom + 8;
    const top =
      below + previewHeight <= window.innerHeight || rect.top < previewHeight + 12
        ? below
        : Math.max(12, rect.top - previewHeight - 8);
    setPosition({ top, left });
  }

  function showPreview() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    placePreview();
    setOpen(true);
  }

  function hidePreview() {
    closeTimer.current = setTimeout(() => {
      // The preview is position: fixed, so moving from the date card to its
      // controls can briefly trigger the calendar cell's mouse-leave handler.
      // Only close once neither the trigger nor the preview is being used.
      const isStillHovered =
        rootRef.current?.matches(":hover") || previewRef.current?.matches(":hover");
      const hasFocus = rootRef.current?.contains(document.activeElement);
      if (!isStillHovered && !hasFocus) setOpen(false);
    }, 120);
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) hidePreview();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
      rootRef.current?.querySelector<HTMLElement>("a")?.focus();
    }
  }

  function preventNavigationOnTouch(event: MouseEvent<HTMLDivElement>) {
    // A click/tap first reveals the details. The visible "Open item" link keeps
    // navigation explicit, while desktop links retain their normal direct path.
    if (window.matchMedia("(hover: none)").matches) {
      event.preventDefault();
      showPreview();
    }
  }

  function move(direction: -1 | 1) {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
    setActiveIndex((current) =>
      Math.min(Math.max(current + direction, 0), items.length - 1),
    );
  }

  const item = items[activeIndex];

  return (
    <div
      ref={rootRef}
      className="relative"
      onMouseEnter={showPreview}
      onMouseLeave={hidePreview}
      onFocus={showPreview}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onClick={preventNavigationOnTouch}
    >
      {children}
      {open && item && (
        <div
          ref={previewRef}
          className="fixed z-[70] w-[min(21rem,calc(100vw-1.5rem))] rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_24px_60px_rgba(15,23,42,0.22)] ring-1 ring-white/90"
          style={position}
          role="dialog"
          aria-label={`${dateLabel} calendar posts`}
          onMouseEnter={showPreview}
          onMouseLeave={hidePreview}
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-950">{dateLabel}</p>
              <p className="text-[11px] text-slate-500">
                {items.length} {items.length === 1 ? "post" : "posts"} planned
              </p>
            </div>
            {items.length > 1 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Previous post"
                  disabled={activeIndex === 0}
                  onMouseDown={showPreview}
                  onClick={() => move(-1)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-violet-400"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Next post"
                  disabled={activeIndex === items.length - 1}
                  onMouseDown={showPreview}
                  onClick={() => move(1)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-violet-400"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>

          <div className="overflow-hidden">
            <div
              className="flex transition-transform duration-200 ease-out motion-reduce:transition-none"
              style={{ transform: `translateX(-${activeIndex * 100}%)` }}
            >
              {items.map((previewItem) => (
                <article key={previewItem.id} className="min-w-full rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ring-1 ${CAL_STATUS_BADGE_CLASS[previewItem.status]}`}>
                      {previewItem.statusLabel}
                    </span>
                    <span className="shrink-0 text-[10px] font-medium text-slate-500">{previewItem.channel}</span>
                  </div>
                  <h3 className="mt-2 line-clamp-2 text-sm font-semibold leading-5 text-slate-950">
                    {previewItem.title}
                  </h3>
                  <p className="mt-1 line-clamp-2 text-xs leading-4 text-slate-600">
                    {previewItem.description?.trim() || "No additional details provided."}
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <Link
                      href={
                        previewItem.linkedRequestId
                          ? `/requests/${previewItem.linkedRequestId}`
                          : `/calendar/${previewItem.id}`
                      }
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-violet-700 transition hover:bg-violet-50 focus:outline-none focus:ring-2 focus:ring-violet-400"
                    >
                      {previewItem.linkedRequestId ? "Open request" : "Open item"}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                    {previewItem.canDelete && (
                      <ConfirmForm
                        action={deleteCalendarItem}
                        title="Delete calendar item?"
                        message="This permanently deletes this unlinked calendar item. This cannot be undone."
                        confirmLabel="Delete item"
                      >
                        <input type="hidden" name="id" value={previewItem.id} />
                        <button
                          type="submit"
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-2.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </button>
                      </ConfirmForm>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </div>
          {items.length > 1 && (
            <div className="mt-2 flex justify-center gap-1.5" aria-label={`Post ${activeIndex + 1} of ${items.length}`}>
              {items.map((previewItem, index) => (
                <span
                  key={previewItem.id}
                  className={`h-1.5 rounded-full transition-all ${index === activeIndex ? "w-4 bg-violet-600" : "w-1.5 bg-slate-300"}`}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
