"use client";

import { FileKey2, Workflow } from "lucide-react";
import { ResourceEmptyState } from "@/components/resource-empty-state";

type DashboardEmptyStateProps = {
  kind: "certificates" | "executions";
  title: string;
  description: string;
};

export function DashboardEmptyState({ kind, title, description }: DashboardEmptyStateProps) {
  return (
    <ResourceEmptyState
      icon={kind === "certificates" ? FileKey2 : Workflow}
      title={title}
      description={description}
      size="compact"
    />
  );
}
