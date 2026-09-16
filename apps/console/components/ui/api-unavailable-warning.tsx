"use client";

import { useLocale } from "@/components/providers/locale-provider";

export function ApiUnavailableWarning() {
  const { t } = useLocale();
  return <div className="api-warning">{t("common.apiUnavailable")}</div>;
}
