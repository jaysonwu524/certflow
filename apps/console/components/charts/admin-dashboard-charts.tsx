"use client";

import * as echarts from "echarts";
import type { EChartsOption } from "echarts";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useLocale } from "@/components/providers/locale-provider";
import type { AdminDashboard } from "@/lib/api";

type Palette = {
  text: string;
  muted: string;
  border: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  surface: string;
};

const serverPalette: Palette = {
  text: "#17231d",
  muted: "#65716a",
  border: "#dce2dc",
  accent: "#0f766e",
  success: "#0f766e",
  warning: "#a35c00",
  danger: "#b42318",
  surface: "#ffffff",
};
let paletteSignature = "";
let cachedPalette = serverPalette;

function readPalette() {
  if (typeof window === "undefined") return serverPalette;
  const styles = window.getComputedStyle(document.documentElement);
  const nextPalette = {
    text: styles.getPropertyValue("--text").trim() || serverPalette.text,
    muted: styles.getPropertyValue("--text-muted").trim() || serverPalette.muted,
    border: styles.getPropertyValue("--border").trim() || serverPalette.border,
    accent: styles.getPropertyValue("--accent").trim() || serverPalette.accent,
    success: styles.getPropertyValue("--accent").trim() || serverPalette.success,
    warning: styles.getPropertyValue("--warning").trim() || serverPalette.warning,
    danger: styles.getPropertyValue("--danger").trim() || serverPalette.danger,
    surface: styles.getPropertyValue("--surface").trim() || serverPalette.surface,
  };
  const nextSignature = Object.values(nextPalette).join("|");
  if (nextSignature !== paletteSignature) {
    paletteSignature = nextSignature;
    cachedPalette = nextPalette;
  }
  return cachedPalette;
}

function subscribe(callback: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-color-theme"],
  });
  return () => observer.disconnect();
}

function Chart({ label, option, ready }: { label: string; option: EChartsOption; ready: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !ready) return;
    const chart = echarts.init(ref.current, undefined, { renderer: "svg" });
    chart.setOption(option, { notMerge: true });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [option, ready]);
  return <div ref={ref} className="dashboard-chart-canvas" role="img" aria-label={label} />;
}

export function AdminDashboardCharts({ dashboard }: { dashboard: AdminDashboard }) {
  const { t } = useLocale();
  const expiryBucketLabel = useCallback(
    (bucket: string) => {
      const keys = {
        expired: "admin.expiry.expired",
        expiring_7d: "admin.expiry.expiring7d",
        expiring_30d: "admin.expiry.expiring30d",
        healthy: "admin.expiry.healthy",
      } as const;
      return keys[bucket as keyof typeof keys] ? t(keys[bucket as keyof typeof keys]) : bucket;
    },
    [t],
  );
  const palette = useSyncExternalStore(subscribe, readPalette, () => serverPalette);
  const ready = palette !== serverPalette;
  const trendOption = useMemo<EChartsOption>(
    () => ({
      animation: false,
      color: [palette.success, palette.danger, palette.warning],
      grid: { left: 42, right: 18, top: 42, bottom: 30 },
      legend: {
        top: 8,
        itemWidth: 9,
        itemHeight: 9,
        textStyle: { color: palette.muted, fontSize: 12 },
        data: [t("dashboard.chart.succeeded"), t("dashboard.chart.failed"), t("dashboard.chart.running")],
      },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: {
        type: "category",
        data: dashboard.executionTrend.map((item) => item.date.slice(5).replace("-", "/")),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: palette.border } },
        axisLabel: { color: palette.muted, fontSize: 11, interval: 4 },
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: { color: palette.muted, fontSize: 12 },
        splitLine: { lineStyle: { color: palette.border } },
      },
      series: [
        {
          name: t("dashboard.chart.succeeded"),
          type: "bar",
          stack: "total",
          data: dashboard.executionTrend.map((item) => item.succeeded),
          barMaxWidth: 22,
        },
        {
          name: t("dashboard.chart.failed"),
          type: "bar",
          stack: "total",
          data: dashboard.executionTrend.map((item) => item.failed),
          barMaxWidth: 22,
        },
        {
          name: t("dashboard.chart.running"),
          type: "bar",
          stack: "total",
          data: dashboard.executionTrend.map((item) => item.active),
          barMaxWidth: 22,
        },
      ],
    }),
    [dashboard.executionTrend, palette, t],
  );
  const expiryOption = useMemo<EChartsOption>(
    () => ({
      animation: false,
      color: [palette.danger, palette.warning, palette.accent, palette.success],
      tooltip: {
        trigger: "item",
        valueFormatter: (value) => t("dashboard.certificatesUnit", { count: String(value) }),
      },
      legend: { bottom: 2, textStyle: { color: palette.muted, fontSize: 12 } },
      series: [
        {
          type: "pie",
          radius: ["48%", "70%"],
          center: ["50%", "45%"],
          label: { show: false },
          data: dashboard.expiryDistribution.map((item) => ({
            name: expiryBucketLabel(item.bucket),
            value: item.count,
          })),
        },
      ],
      graphic: dashboard.expiryDistribution.every((item) => item.count === 0)
        ? {
            type: "text",
            left: "center",
            top: "middle",
            style: { text: t("admin.noIssuedCertificates"), fill: palette.muted, fontSize: 13 },
          }
        : undefined,
    }),
    [dashboard.expiryDistribution, expiryBucketLabel, palette, t],
  );
  const automationOption = useMemo<EChartsOption>(
    () => ({
      animation: false,
      color: [palette.success, palette.warning, palette.danger],
      grid: { left: 32, right: 28, top: 40, bottom: 34 },
      legend: {
        top: 6,
        itemWidth: 9,
        itemHeight: 9,
        textStyle: { color: palette.muted, fontSize: 12 },
        data: [t("dashboard.chart.healthy"), t("dashboard.chart.paused"), t("dashboard.chart.attention")],
      },
      xAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: { color: palette.muted, fontSize: 12 },
        splitLine: { lineStyle: { color: palette.border } },
      },
      yAxis: {
        type: "category",
        data: [t("nav.automations")],
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: { color: palette.muted, fontSize: 12 },
      },
      series: [
        {
          name: t("dashboard.chart.healthy"),
          type: "bar",
          stack: "total",
          data: [dashboard.automationHealth.healthy],
          barWidth: 30,
        },
        {
          name: t("dashboard.chart.paused"),
          type: "bar",
          stack: "total",
          data: [dashboard.automationHealth.paused],
          barWidth: 30,
        },
        {
          name: t("dashboard.chart.attention"),
          type: "bar",
          stack: "total",
          data: [dashboard.automationHealth.attention],
          barWidth: 30,
        },
      ],
    }),
    [dashboard.automationHealth, palette, t],
  );

  return (
    <section className="admin-dashboard-chart-grid" aria-label={t("admin.systemTrendHealth")}>
      <article className="panel admin-dashboard-trend">
        <div className="panel-header">
          <div>
            <h2>{t("admin.executionTrend")}</h2>
            <span className="panel-subtitle">{t("admin.executionTrendDescription")}</span>
          </div>
        </div>
        <Chart label={t("admin.executionTrendChart")} option={trendOption} ready={ready} />
      </article>
      <article className="panel">
        <div className="panel-header">
          <div>
            <h2>{t("dashboard.expiryDistribution")}</h2>
            <span className="panel-subtitle">{t("admin.expiryDistributionDescription")}</span>
          </div>
        </div>
        <Chart label={t("dashboard.expiryDistribution")} option={expiryOption} ready={ready} />
      </article>
      <article className="panel">
        <div className="panel-header">
          <div>
            <h2>{t("dashboard.automationHealth")}</h2>
            <span className="panel-subtitle">{t("admin.automationHealthDescription")}</span>
          </div>
        </div>
        <Chart label={t("dashboard.automationHealth")} option={automationOption} ready={ready} />
      </article>
    </section>
  );
}
