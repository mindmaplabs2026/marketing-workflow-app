"use client";

import { motion, useReducedMotion } from "framer-motion";

type MotionSurfaceProps = {
  children: React.ReactNode;
  className?: string;
  delay?: number;
};

export function MotionSurface({
  children,
  className,
  delay = 0,
}: MotionSurfaceProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay, ease: [0.16, 1, 0.3, 1] }}
      whileHover={reduceMotion ? undefined : { y: -2 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
