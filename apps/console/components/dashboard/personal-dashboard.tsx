"use client";

import Link from "next/link";
import { Card, Table } from "@heroui/react";
import { ArrowUpRight } from "lucide-react";
import { DashboardEmptyState } from "@/components/charts/dashboard-empty-state";
import { DashboardCharts } from "@/components/charts/dashboard-charts";
import { useLocale } from "@/components/providers/locale-provider";
import { StatusTag } from "@/components/ui/status-tag";
import type { AutomationTask, Certificate, Dashboard, Execution } from "@/lib/api";
import { formatDateTime } from "@/lib/presentation";

const metricDefinitions = [
  { key: "activeCertificates", label: "dashboard.activeCertificates", note: "dashboard.activeCertificatesNote", tone: "healthy" },
  { key: "expiringSoon", label: "dashboard.expiringSoon", note: "dashboard.expiringSoonNote", tone: "attention" },
  { key: "runningJobs", label: "dashboard.runningJobs", note: "dashboard.runningJobsNote", tone: "active" },
  { key: "failedExecutions", label: "dashboard.failedExecutions", note: "dashboard.failedExecutionsNote", tone: "danger" },
] as const;

const executionLabels: Record<string, "dashboard.execution.issue" | "dashboard.execution.renew" | "dashboard.execution.upload" | "dashboard.execution.deploy" | "dashboard.execution.cleanup"> = {
  issue: "dashboard.execution.issue", renew: "dashboard.execution.renew", upload: "dashboard.execution.upload", deploy: "dashboard.execution.deploy", cleanup: "dashboard.execution.cleanup",
};

export function PersonalDashboard({ dashboard, certificates, executions, automations }: { dashboard: Dashboard; certificates: Certificate[]; executions: Execution[]; automations: AutomationTask[] }) {
  const { locale, t } = useLocale();
  const recentExecutions = executions.slice(0, 5);
  const executionLabel = (kind: string) => t(executionLabels[kind] ?? "dashboard.task");

  return <div className="dashboard-layout">
    <section className="metric-grid" aria-label={t("dashboard.certificateStatus")}>
      {metricDefinitions.map((metric) => <Card className={`metric-card metric-card-${metric.tone}`} key={metric.key}><div className="metric-label">{t(metric.label)}</div><div className="metric-value">{dashboard[metric.key]}</div><div className="metric-note">{t(metric.note)}</div></Card>)}
    </section>
    <DashboardCharts certificates={certificates} executions={executions} automations={automations} />
    <section className="content-grid">
      <article className="panel dashboard-certificate-panel"><div className="panel-header"><div><h2>{t("dashboard.certificateStatus")}</h2><span className="panel-subtitle">{t("dashboard.recentCertificates")}</span></div><Link className="panel-header-link" href="/certificates">{t("dashboard.viewAll")} <ArrowUpRight size={14} /></Link></div>{certificates.length === 0 ? <DashboardEmptyState kind="certificates" title={t("dashboard.noCertificates")} description={t("dashboard.noCertificatesDescription")} /> : <Table className="dashboard-table" variant="secondary"><Table.ScrollContainer><Table.Content aria-label={t("dashboard.certificateStatus")} className="min-w-[620px]"><Table.Header><Table.Column isRowHeader>{t("dashboard.name")}</Table.Column><Table.Column>{t("common.status")}</Table.Column><Table.Column>{t("dashboard.validity")}</Table.Column></Table.Header><Table.Body>{certificates.slice(0, 5).map((certificate) => <Table.Row key={certificate.id}><Table.Cell><div className="row-title">{certificate.name}</div><div className="domain-list">{certificate.domains.join(", ")}</div></Table.Cell><Table.Cell><StatusTag status={certificate.status} /></Table.Cell><Table.Cell><span className="muted">{certificate.notAfter ? formatDateTime(certificate.notAfter, locale) : t("dashboard.pendingIssuance")}</span></Table.Cell></Table.Row>)}</Table.Body></Table.Content></Table.ScrollContainer></Table>}</article>
      <article className="panel"><div className="panel-header"><div><h2>{t("dashboard.recentExecutions")}</h2><span className="panel-subtitle">{t("dashboard.recentExecutionsDescription")}</span></div><Link className="panel-header-link" href="/executions">{t("dashboard.executionHistory")} <ArrowUpRight size={14} /></Link></div>{recentExecutions.length === 0 ? <div className="panel-body"><DashboardEmptyState kind="executions" title={t("dashboard.noExecutions")} description={t("dashboard.noExecutionsDescription")} /></div> : <Table className="dashboard-table dashboard-execution-table" variant="secondary"><Table.ScrollContainer><Table.Content aria-label={t("dashboard.recentExecutions")} className="min-w-[480px]"><Table.Header><Table.Column isRowHeader>{t("dashboard.task")}</Table.Column><Table.Column>{t("common.status")}</Table.Column><Table.Column>{t("dashboard.startedAt")}</Table.Column></Table.Header><Table.Body>{recentExecutions.map((execution) => <Table.Row key={execution.id}><Table.Cell><div className="row-title">{execution.certificate || executionLabel(execution.kind)}</div><div className="domain-list">{executionLabel(execution.kind)}</div></Table.Cell><Table.Cell><StatusTag status={execution.status} /></Table.Cell><Table.Cell><span className="muted">{formatDateTime(execution.startedAt, locale, t("dashboard.notStarted"))}</span></Table.Cell></Table.Row>)}</Table.Body></Table.Content></Table.ScrollContainer></Table>}</article>
    </section>
  </div>;
}
