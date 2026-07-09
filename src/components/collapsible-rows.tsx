"use client";

import { Children, cloneElement, isValidElement, useState } from "react";

/**
 * Renders a list of already-built row elements inside `className` container,
 * collapsed to `collapsedCount` rows with a "Show N more" toggle. Rows beyond
 * the collapsed count stay in the DOM (so the server-rendered markup is intact)
 * and are hidden via CSS, keeping each row a direct child of the container so
 * the divider (`border-b` / `last:border-b-0`) styling still applies.
 */
export function CollapsibleRows({
  children,
  collapsedCount = 3,
  className,
}: {
  children: React.ReactNode;
  collapsedCount?: number;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const items = Children.toArray(children).filter(isValidElement);
  const hiddenCount = items.length - collapsedCount;
  const canToggle = hiddenCount > 0;

  return (
    <div className={className}>
      {items.map((child, index) => {
        const hide = canToggle && !expanded && index >= collapsedCount;
        if (!hide) return child;
        const element = child as React.ReactElement<{ className?: string }>;
        const prev = element.props.className ?? "";
        return cloneElement(element, { className: `${prev} hidden` });
      })}
      {canToggle && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-violet-600 transition hover:bg-violet-50/60"
        >
          {expanded ? "Show less" : `Show ${hiddenCount} more`}
          <span className={`text-[10px] transition ${expanded ? "rotate-180" : ""}`}>
            ⌄
          </span>
        </button>
      )}
    </div>
  );
}
