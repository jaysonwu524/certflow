"use client";

import Link from "next/link";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";
import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { AutomationTask, Certificate, Execution } from "@/lib/api";
import { useLocale, type TranslationKey } from "@/components/providers/locale-provider";

type ChartPalette = {
  text: string;
  muted: string;
  border: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  surface: string;
  contrastText: string;
};

type ChartCanvasProps = {
  ariaLabel: string;
  option: EChartsOption;
  isReady: boolean;
};

const expiryRanges: { label: TranslationKey; days: number }[] = [
  { label: "dashboard.expiry7d", days: 7 },
  { label: "dashboard.expiry30d", days: 30 },
  { label: "dashboard.expiry60d", days: 60 },
  { label: "dashboard.expiry90d", days: 90 },
] as const;

// This palette is safe during the server render. It is replaced with the
// active CSS-token palette after the component mounts in the browser.
const serverChartPalette: ChartPalette = {
  text: "#17231d",
  muted: "#65716a",
  border: "#dce2dc",
  accent: "#0f766e",
  success: "#0f766e",
  warning: "#a35c00",
  danger: "#b42318",
  surface: "#ffffff",
  contrastText: "#f5faf7",
};

let browserPaletteSignature = "";
let browserPalette = serverChartPalette;

// Dashboard charts use the same CSS tokens as the shell so a personal theme
// change redraws every series consistently without maintaining a second palette.
function readChartPalette(): ChartPalette {
  if (typeof window === "undefined") return serverChartPalette;
  const styles = window.getComputedStyle(document.documentElement);
  const nextPalette: ChartPalette = {
    text: styles.getPropertyValue("--text").trim(),
    muted: styles.getPropertyValue("--text-muted").trim(),
    border: styles.getPropertyValue("--border").trim(),
    accent: styles.getPropertyValue("--accent").trim(),
    success: styles.getPropertyValue("--accent").trim(),
    warning: styles.getPropertyValue("--warning").trim(),
    danger: styles.getPropertyValue("--danger").trim(),
    surface: styles.getPropertyValue("--surface").trim(),
    contrastText: "#f5faf7",
  };
  const signature = Object.values(nextPalette).join("|");
  if (signature !== browserPaletteSignature) {
    browserPaletteSignature = signature;
    browserPalette = nextPalette;
  }
  return browserPalette;
}

function subscribeToChartTheme(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-color-theme"],
  });
  return () => observer.disconnect();
}

function ChartCanvas({ ariaLabel, option, isReady }: ChartCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isReady) return;
    const chart = echarts.init(container, undefined, { renderer: "svg" });
    chart.setOption(option, { notMerge: true });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [isReady, option]);

  return <div ref={containerRef} className="dashboard-chart-canvas" role="img" aria-label={ariaLabel} />;
}

function daysUntil(value: string) {
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
}

function localDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function chartDateLabel(value: Date) {
  return `${value.getMonth() + 1}/${value.getDate()}`;
}

function useChartPalette() {
  const palette = useSyncExternalStore(subscribeToChartTheme, readChartPalette, () => serverChartPalette);
  return { palette, isReady: palette !== serverChartPalette };
}

function ChartPanel({
  title,
  description,
  link,
  children,
  className = "",
}: {
  title: string;
  description: string;
  link: { href: string; label: string };
  children: ReactNode;
  className?: string;
}) {
  return (
    <article className={`panel dashboard-chart-panel ${className}`}>
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
          <span className="panel-subtitle">{description}</span>
        </div>
        <Link href={link.href}>{link.label}</Link>
      </div>
      {children}
    </article>
  );
}

export function DashboardCharts({
  certificates,
  executions,
  automations,
}: {
  certificates: Certificate[];
  executions: Execution[];
  automations: AutomationTask[];
}) {
  const { t } = useLocale();
  const { palette, isReady } = useChartPalette();

  const expiryCounts = useMemo(() => {
    const buckets = expiryRanges.map(() => 0);
    for (const certificate of certificates) {
      if (!certificate.notAfter) continue;
      const remaining = daysUntil(certificate.notAfter);
      if (remaining < 0 || remaining > 90) continue;
      const index = remaining <= 7 ? 0 : remaining <= 30 ? 1 : remaining <= 60 ? 2 : 3;
      buckets[index] += 1;
    }
    return buckets;
  }, [certificates]);

  const executionTrend = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Array.from({ length: 14 }, (_, index) => {
      const day = new Date(today);
      day.setDate(today.getDate() - 13 + index);
      return day;
    });
    const counts = new Map(days.map((day) => [localDateKey(day), { succeeded: 0, failed: 0, active: 0 }]));
    for (const execution of executions) {
      if (!execution.startedAt) continue;
      const startedAt = new Date(execution.startedAt);
      const item = counts.get(localDateKey(startedAt));
      if (!item) continue;
      if (execution.status === "succeeded") item.succeeded += 1;
      else if (execution.status === "failed") item.failed += 1;
      else if (["queued", "running", "waiting_user"].includes(execution.status)) item.active += 1;
    }
    return {
      labels: days.map(chartDateLabel),
      succeeded: days.map((day) => counts.get(localDateKey(day))?.succeeded ?? 0),
      failed: days.map((day) => counts.get(localDateKey(day))?.failed ?? 0),
      active: days.map((day) => counts.get(localDateKey(day))?.active ?? 0),
    };
  }, [executions]);

  const automationHealth = useMemo(() => {
    return automations.reduce(
      (summary, automation) => {
        if (!automation.enabled) summary.paused += 1;
        else if (automation.lastStatus === "failed") summary.attention += 1;
        else summary.healthy += 1;
        return summary;
      },
      { healthy: 0, paused: 0, attention: 0 },
    );
  }, [automations]);

  const expiryOption = useMemo<EChartsOption>(() => {
    const colors = [palette.danger, palette.warning, palette.success, palette.accent];
    return {
      animation: false,
      grid: { left: 84, right: 32, top: 20, bottom: 28 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (value) => t("dashboard.certificatesUnit", { count: String(value) }),
      },
      xAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: { color: palette.muted, fontSize: 12 },
        splitLine: { lineStyle: { color: palette.border } },
      },
      yAxis: {
        type: "category",
        data: expiryRanges.map((item) => t(item.label)),
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: { color: palette.muted, fontSize: 12 },
      },
      series: [
        {
          type: "bar",
          data: expiryCounts.map((value, index) => ({ value, itemStyle: { color: colors[index] } })),
          barMaxWidth: 20,
          showBackground: true,
          backgroundStyle: { color: palette.surface },
          label: { show: true, position: "right", color: palette.text, fontSize: 12, formatter: "{c}" },
          emphasis: { focus: "series" },
        },
      ],
      graphic: expiryCounts.every((value) => value === 0)
        ? {
            type: "text",
            left: "center",
            top: "middle",
            style: { text: t("dashboard.expiryEmpty"), fill: palette.muted, fontSize: 13 },
          }
        : undefined,
    };
  }, [expiryCounts, palette, t]);

  const trendOption = useMemo<EChartsOption>(
    () => ({
      animation: false,
      color: [palette.success, palette.danger, palette.warning],
      grid: { left: 40, right: 20, top: 42, bottom: 28 },
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
        data: executionTrend.labels,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: palette.border } },
        axisLabel: { color: palette.muted, fontSize: 11, interval: 1 },
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
          data: executionTrend.succeeded,
          barMaxWidth: 24,
        },
        {
          name: t("dashboard.chart.failed"),
          type: "bar",
          stack: "total",
          data: executionTrend.failed,
          barMaxWidth: 24,
        },
        {
          name: t("dashboard.chart.running"),
          type: "bar",
          stack: "total",
          data: executionTrend.active,
          barMaxWidth: 24,
        },
      ],
      graphic:
        executionTrend.succeeded.every((value) => value === 0) &&
        executionTrend.failed.every((value) => value === 0) &&
        executionTrend.active.every((value) => value === 0)
          ? {
              type: "text",
              left: "center",
              top: "middle",
              style: { text: t("dashboard.executionEmpty"), fill: palette.muted, fontSize: 13 },
            }
          : undefined,
    }),
    [executionTrend, palette, t],
  );

  const automationOption = useMemo<EChartsOption>(
    () => ({
      animation: false,
      color: [palette.success, palette.warning, palette.danger],
      grid: { left: 18, right: 18, top: 54, bottom: 42 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (value) => t("dashboard.tasksUnit", { count: String(value) }),
      },
      legend: {
        top: 10,
        icon: "roundRect",
        itemWidth: 8,
        itemHeight: 8,
        textStyle: { color: palette.muted, fontSize: 12 },
      },
      xAxis: { type: "value", show: false, max: Math.max(automations.length, 1) },
      yAxis: { type: "category", data: [t("nav.automations")], show: false },
      series: [
        {
          name: t("dashboard.chart.healthy"),
          type: "bar",
          stack: "total",
          data: [automationHealth.healthy],
          barWidth: 32,
          label: {
            show: automationHealth.healthy > 0,
            position: "inside",
            color: palette.contrastText,
            fontSize: 12,
            formatter: "{c}",
          },
        },
        {
          name: t("dashboard.chart.paused"),
          type: "bar",
          stack: "total",
          data: [automationHealth.paused],
          barWidth: 32,
          label: {
            show: automationHealth.paused > 0,
            position: "inside",
            color: palette.contrastText,
            fontSize: 12,
            formatter: "{c}",
          },
        },
        {
          name: t("dashboard.chart.attention"),
          type: "bar",
          stack: "total",
          data: [automationHealth.attention],
          barWidth: 32,
          label: {
            show: automationHealth.attention > 0,
            position: "inside",
            color: palette.contrastText,
            fontSize: 12,
            formatter: "{c}",
          },
        },
      ],
      graphic:
        automations.length === 0
          ? {
              type: "text",
              left: "center",
              top: "middle",
              style: { text: t("dashboard.automationEmpty"), fill: palette.muted, fontSize: 13 },
            }
          : undefined,
    }),
    [automationHealth, automations.length, palette, t],
  );

  const expiryDescription = useMemo(
    () =>
      t("dashboard.expiryDescription", { count: expiryCounts.reduce((total, value) => total + value, 0) }),
    [expiryCounts, t],
  );
  const automationDescription = useMemo(
    () =>
      t("dashboard.automationDescription", {
        attention: automationHealth.attention,
        paused: automationHealth.paused,
      }),
    [automationHealth, t],
  );
  return (
    <>
      <section className="dashboard-chart-grid" aria-label={t("dashboard.certificatesAutomationOverview")}>
        <ChartPanel
          title={t("dashboard.expiryDistribution")}
          description={expiryDescription}
          link={{ href: "/certificates", label: t("dashboard.viewCertificates") }}
        >
          <ChartCanvas ariaLabel={t("dashboard.expiryChartLabel")} isReady={isReady} option={expiryOption} />
        </ChartPanel>
        <ChartPanel
          title={t("dashboard.automationHealth")}
          description={automationDescription}
          link={{ href: "/automations", label: t("dashboard.viewAutomations") }}
        >
          <ChartCanvas
            ariaLabel={t("dashboard.automationChartLabel")}
            isReady={isReady}
            option={automationOption}
          />
        </ChartPanel>
      </section>
      <section
        className="dashboard-chart-grid dashboard-chart-grid-secondary"
        aria-label={t("dashboard.executionTrend")}
      >
        <ChartPanel
          className="dashboard-execution-chart"
          title={t("dashboard.executionTrend")}
          description={t("dashboard.executionTrendDescription")}
          link={{ href: "/executions", label: t("dashboard.executionHistory") }}
        >
          <ChartCanvas
            ariaLabel={t("dashboard.executionChartLabel")}
            isReady={isReady}
            option={trendOption}
          />
        </ChartPanel>
      </section>
    </>
  );
}
