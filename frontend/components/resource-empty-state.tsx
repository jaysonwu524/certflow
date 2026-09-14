"use client";

import { Button } from "@heroui/react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type ResourceEmptyStateAction = {
  label: string;
  onPress: () => void;
  icon?: LucideIcon;
};

type ResourceEmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  primaryAction?: ResourceEmptyStateAction;
  secondaryAction?: ResourceEmptyStateAction;
  variant?: "empty" | "filtered" | "error";
  size?: "default" | "compact";
};

export function ResourceEmptyState({
  icon: Icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  variant = "empty",
  size = "default",
}: ResourceEmptyStateProps) {
  return (
    <section
      className={`resource-empty-state resource-empty-state-${variant} resource-empty-state-${size}`}
      role={variant === "error" ? "alert" : "status"}
    >
      <span className="resource-empty-state-icon" aria-hidden="true">
        <Icon size={34} strokeWidth={1.45} />
      </span>
      <div className="resource-empty-state-content">
        <div className="resource-empty-state-copy">
          <strong>{title}</strong>
          {description ? <p>{description}</p> : null}
        </div>
        {primaryAction || secondaryAction ? (
          <div className="resource-empty-state-actions">
            {secondaryAction ? <EmptyStateAction action={secondaryAction} variant="secondary" /> : null}
            {primaryAction ? <EmptyStateAction action={primaryAction} variant="primary" /> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function EmptyStateAction({ action, variant }: { action: ResourceEmptyStateAction; variant: "primary" | "secondary" }) {
  const Icon = action.icon;
  return (
    <Button variant={variant} onPress={action.onPress}>
      {Icon ? <Icon size={16} /> : null}
      {action.label}
    </Button>
  );
}
