"use client";

import { useRef, type ReactNode } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";

type RevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
};

const revealTransition = { duration: 0.55, ease: [0.16, 1, 0.3, 1] as const };

export function MarketingReveal({ children, className, delay = 0 }: RevealProps) {
  const reduceMotion = useReducedMotion();
  const isHero = className?.includes("marketing-hero-copy");

  return (
    <motion.div
      className={className}
      initial={reduceMotion || isHero ? false : { opacity: 0, y: 22 }}
      whileInView={isHero ? undefined : { opacity: 1, y: 0 }}
      viewport={isHero ? undefined : { once: true, amount: 0.25 }}
      transition={{ ...revealTransition, delay }}
    >
      {children}
    </motion.div>
  );
}

export function MarketingHeroPreviewMotion({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], reduceMotion ? [0, 0] : [0, -28]);
  const scale = useTransform(scrollYProgress, [0, 1], reduceMotion ? [1, 1] : [1, 0.985]);

  return (
    <motion.div
      ref={ref}
      className="marketing-hero-preview-motion"
      style={{ y, scale }}
      initial={false}
    >
      {children}
    </motion.div>
  );
}
