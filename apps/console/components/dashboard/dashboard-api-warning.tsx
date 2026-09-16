"use client";

import { AlertTriangle } from "lucide-react";
import { useLocale } from "@/components/providers/locale-provider";

export function DashboardAPIWarning() {
  const { t } = useLocale();
  return <div className="api-warning"><AlertTriangle size={17} /> {t("dashboard.apiUnavailable")}</div>;
}
