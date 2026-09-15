"use client";

import { Cloud, FileCheck2, KeyRound } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useLocale } from "@/components/locale-provider";
import { marketingCopy } from "@/lib/marketing-copy";

const icons = [KeyRound, FileCheck2, Cloud];

export function MarketingCapabilities() {
  const reduceMotion = useReducedMotion();
  const { locale } = useLocale();
  const capabilities = marketingCopy[locale].capabilities.items;

  return (
    <div className="marketing-capability-grid">
      {capabilities.map(({ title, description }, index) => {
        const Icon = icons[index];
        return (
          <motion.article
            className={`marketing-capability marketing-capability-${index + 1}`}
            key={title}
            initial={reduceMotion ? false : { opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.52, delay: reduceMotion ? 0 : index * 0.1, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="marketing-capability-icon">
              <Icon size={22} strokeWidth={1.8} />
            </span>
            <h3>{title}</h3>
            <p>{description}</p>
          </motion.article>
        );
      })}
    </div>
  );
}
