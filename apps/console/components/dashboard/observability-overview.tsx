"use client";

import Link from "next/link";
import { Button, Card, Tag, TagGroup } from "@heroui/react";
import { Activity, Clock3, Database, RefreshCw, ShieldAlert, Workflow } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { useLocale } from "@/components/providers/locale-provider";
import type { AdminObservability } from "@/lib/api";
import { formatDateTime } from "@/lib/presentation";

const refreshIntervalMs = 15_000;

type HealthTone = "healthy" | "attention" | "danger";

function RuntimeTag({ tone, label, children }: { tone: HealthTone; label: string; children: React.ReactNode }) {
  const tagID = useId();
  return (
    <TagGroup aria-label={label} size="sm">
      <TagGroup.List>
        <Tag id={tagID} className={`admin-health-tag admin-health-tag-${tone}`}>
          {children}
        </Tag>
      </TagGroup.List>
    </TagGroup>
  );
}

function formatUptime(seconds: number, t: ReturnType<typeof useLocale>["t"]) {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return t("observability.uptimeValue", { days, hours, minutes });
}

export function ObservabilityOverview({ initialSnapshot }: { initialSnapshot: AdminObservability }) {
  const { locale, t } = useLocale();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [updatedAt, setUpdatedAt] = useState(() => new Date().toISOString());
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/admin/observability", { cache: "no-store" });
      if (!response.ok) return;
      setSnapshot((await response.json()) as AdminObservability);
      setUpdatedAt(new Date().toISOString());
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => void refresh(), refreshIntervalMs);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const schedulerTone: HealthTone =
    snapshot.lastSchedulerRun.status === "succeeded"
      ? "healthy"
      : snapshot.lastSchedulerRun.status === "failed"
        ? "danger"
        : "attention";
  const workerCount = snapshot.jobsInFlight.reduce((total, item) => total + item.count, 0);
  const lastScanAt = snapshot.lastSchedulerRun.finishedAt
    ? formatDateTime(snapshot.lastSchedulerRun.finishedAt, locale)
    : t("observability.notScanned");
  const schedulerLabel =
    snapshot.lastSchedulerRun.status === "succeeded"
      ? t("status.succeeded")
      : snapshot.lastSchedulerRun.status === "failed"
        ? t("status.failed")
        : t("status.unknown");
  const executionLabel = (kind: string) => {
    if (kind === "issue") return t("execution.issue");
    if (kind === "renew") return t("execution.renew");
    if (kind === "upload") return t("execution.upload");
    if (kind === "deploy") return t("execution.deploy");
    return kind;
  };

  return (
    <div className="dashboard-layout observability-layout">
      <section className="admin-health-strip observability-health-strip" aria-label={t("observability.healthLabel")}>
        <div className="admin-health-heading">
          <Activity size={18} />
          <span>{t("observability.healthLabel")}</span>
        </div>
        <div className="admin-health-items">
          <RuntimeTag label={t("observability.healthLabel")} tone={snapshot.databaseReady ? "healthy" : "danger"}>
            <Database size={14} />
            {snapshot.databaseReady
              ? t("observability.databaseHealthy", { latency: snapshot.databaseLatencyMs })
              : t("observability.databaseUnavailable")}
          </RuntimeTag>
          <RuntimeTag label={t("observability.healthLabel")} tone={schedulerTone}>
            <Clock3 size={14} />
            {t("observability.schedulerStatus", { status: schedulerLabel })}
          </RuntimeTag>
          <RuntimeTag label={t("observability.healthLabel")} tone={snapshot.queueDepth > 0 ? "attention" : "healthy"}>
            <Workflow size={14} />
            {t("observability.queueStatus", { count: snapshot.queueDepth })}
          </RuntimeTag>
        </div>
        <Button
          size="sm"
          variant="secondary"
          isIconOnly
          isPending={refreshing}
          aria-label={t("observability.refresh")}
          onPress={() => void refresh()}
        >
          <RefreshCw size={15} />
        </Button>
      </section>

      <section className="metric-grid observability-metric-grid" aria-label={t("observability.summaryLabel")}>
        <Card className="metric-card metric-card-healthy">
          <div className="metric-label">{t("observability.uptime")}</div>
          <div className="metric-value observability-uptime-value">{formatUptime(snapshot.uptimeSeconds, t)}</div>
          <div className="metric-note">{t("observability.startedAt", { value: formatDateTime(snapshot.startedAt, locale) })}</div>
        </Card>
        <Link className="metric-link" href="/executions">
          <Card className="metric-card metric-card-active">
            <div className="metric-label">{t("observability.queueDepth")}</div>
            <div className="metric-value">{snapshot.queueDepth}</div>
            <div className="metric-note">{t("observability.workersRunning", { count: workerCount })}</div>
          </Card>
        </Link>
        <Link className="metric-link" href="/certificates">
          <Card className={`metric-card ${snapshot.certificatesExpiring7 > 0 ? "metric-card-danger" : "metric-card-healthy"}`}>
            <div className="metric-label">{t("observability.expiringSevenDays")}</div>
            <div className="metric-value">{snapshot.certificatesExpiring7}</div>
            <div className="metric-note">{t("observability.expiringThirtyDays", { count: snapshot.certificatesExpiring30 })}</div>
          </Card>
        </Link>
        <Card className={`metric-card ${schedulerTone === "danger" ? "metric-card-danger" : "metric-card-active"}`}>
          <div className="metric-label">{t("observability.scheduler")}</div>
          <div className="metric-value">{snapshot.lastSchedulerRun.queued}</div>
          <div className="metric-note">{t("observability.lastScan", { value: lastScanAt })}</div>
        </Card>
      </section>

      <section className="content-grid observability-detail-grid">
        <article className="panel">
          <div className="panel-header">
            <div>
              <h2>{t("observability.workerActivity")}</h2>
              <span className="panel-subtitle">{t("observability.workerActivityDescription")}</span>
            </div>
            <Link className="panel-header-link" href="/executions">
              {t("observability.openExecutions")}
            </Link>
          </div>
          {snapshot.jobsInFlight.length === 0 ? (
            <p className="admin-panel-empty">{t("observability.noWorkers")}</p>
          ) : (
            <div className="observability-worker-list">
              {snapshot.jobsInFlight.map((job) => (
                <div className="observability-worker-row" key={job.kind}>
                  <span>{executionLabel(job.kind)}</span>
                  <strong>{job.count}</strong>
                </div>
              ))}
            </div>
          )}
        </article>
        <article className="panel">
          <div className="panel-header">
            <div>
              <h2>{t("observability.attention")}</h2>
              <span className="panel-subtitle">{t("observability.attentionDescription")}</span>
            </div>
            <ShieldAlert size={18} className="observability-attention-icon" aria-hidden="true" />
          </div>
          <div className="observability-attention-list">
            <div>
              <span>{t("observability.queueDepth")}</span>
              <strong>{snapshot.queueDepth}</strong>
            </div>
            <div>
              <span>{t("observability.expiringSevenDays")}</span>
              <strong>{snapshot.certificatesExpiring7}</strong>
            </div>
            <div>
              <span>{t("observability.schedulerQueued")}</span>
              <strong>{snapshot.lastSchedulerRun.queued}</strong>
            </div>
          </div>
          <div className="observability-updated-at">
            {t("observability.updatedAt", { value: formatDateTime(updatedAt, locale) })}
          </div>
        </article>
      </section>
    </div>
  );
}
