"use client";

import { useRef } from "react";
import { FileCheck2, KeyRound, ShieldCheck, Workflow } from "lucide-react";
import { motion, useReducedMotion, useScroll, useSpring } from "motion/react";
import { useLocale } from "@/components/providers/locale-provider";
import { marketingCopy } from "@/lib/marketing-copy";

const icons = [KeyRound, FileCheck2, Workflow, ShieldCheck];

export function MarketingWorkflow() {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const { locale } = useLocale();
  const workflow = marketingCopy[locale].workflow.items;
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 72%", "end 68%"] });
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 28, restDelta: 0.001 });

  return (
    <div className="marketing-workflow-track" ref={ref}>
      <motion.span
        aria-hidden="true"
        className="marketing-workflow-progress"
        style={{ scaleY: reduceMotion ? 1 : progress }}
      />
      <ol className="marketing-workflow-list">
        {workflow.map(({ title, detail }, index) => {
          const Icon = icons[index];
          return (
            <motion.li
              key={title}
              initial={reduceMotion ? false : { opacity: 0, x: 18 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, amount: 0.55 }}
              transition={{ duration: 0.46, delay: reduceMotion ? 0 : index * 0.05, ease: [0.16, 1, 0.3, 1] }}
            >
              <span className="marketing-workflow-icon">
                <Icon size={19} strokeWidth={1.8} />
              </span>
              <div>
                <h3>{title}</h3>
                <p>{detail}</p>
              </div>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
