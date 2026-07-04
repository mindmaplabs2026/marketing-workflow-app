"use client";

import { useEffect, useState } from "react";

type AnimatedNumberProps = {
  value: number;
  start?: number;
  durationMs?: number;
  prefix?: string;
  suffix?: string;
};

export function AnimatedNumber({
  value,
  start = 1,
  durationMs = 850,
  prefix = "",
  suffix = "",
}: AnimatedNumberProps) {
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    let frameId = 0;

    frameId = requestAnimationFrame((startedAt) => {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reducedMotion || value <= start) {
        setDisplayValue(value);
        return;
      }

      const from = Math.max(0, start);
      setDisplayValue(from);

      function tick(now: number) {
        const progress = Math.min(1, (now - startedAt) / durationMs);
        const eased = 1 - Math.pow(1 - progress, 3);
        setDisplayValue(Math.round(from + (value - from) * eased));

        if (progress < 1) {
          frameId = requestAnimationFrame(tick);
        }
      }

      frameId = requestAnimationFrame(tick);
    });

    return () => cancelAnimationFrame(frameId);
  }, [durationMs, start, value]);

  return (
    <>
      {prefix}
      {displayValue}
      {suffix}
    </>
  );
}
