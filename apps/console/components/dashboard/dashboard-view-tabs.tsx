"use client";

import { Tabs } from "@heroui/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { useLocale } from "@/components/providers/locale-provider";

export type DashboardView = "system" | "mine";

export function DashboardViewTabs({ view, children }: { view: DashboardView; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLocale();

  function changeView(nextView: DashboardView) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextView === "system") params.delete("view");
    else params.set("view", nextView);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <Tabs
      className="dashboard-view-tabs"
      selectedKey={view}
      onSelectionChange={(key) => changeView(String(key) as DashboardView)}
    >
      <Tabs.ListContainer>
        <Tabs.List aria-label={t("dashboard.viewLabel")}>
          <Tabs.Tab id="system">
            {t("dashboard.system")}
            <Tabs.Indicator />
          </Tabs.Tab>
          <Tabs.Tab id="mine">
            {t("dashboard.mine")}
            <Tabs.Indicator />
          </Tabs.Tab>
        </Tabs.List>
      </Tabs.ListContainer>
      <Tabs.Panel className="dashboard-view-panel" id={view}>
        {children}
      </Tabs.Panel>
    </Tabs>
  );
}
