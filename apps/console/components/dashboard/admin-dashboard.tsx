"use client";

import Link from "next/link";
import { Card, Table, Tag, TagGroup } from "@heroui/react";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Mail, ServerCog, UsersRound } from "lucide-react";
import type { ReactNode } from "react";
import { AdminDashboardCharts } from "@/components/charts/admin-dashboard-charts";
import { useLocale, type TranslationKey } from "@/components/providers/locale-provider";
import { StatusTag } from "@/components/ui/status-tag";
import { translateErrorCode } from "@/lib/error-message";
import type { AdminDashboard } from "@/lib/api";
import { formatDateTime } from "@/lib/presentation";

const executionLabels: Record<string, TranslationKey> = {
  issue: "execution.issue",
  renew: "execution.renew",
  upload: "execution.upload",
  deploy: "execution.deploy",
  cleanup: "execution.cleanup",
};

type MetricDefinition = {
  key:
    | "activeUsers"
    | "certificatesTotal"
    | "certificatesExpiring7d"
    | "jobsQueued"
    | "failedExecutions24h"
    | "invalidCloudCredentials";
  label: TranslationKey;
  note: (
    dashboard: AdminDashboard,
    t: (key: TranslationKey, values?: Record<string, string | number>) => string,
  ) => string;
  href: string;
  tone: "healthy" | "active" | "attention" | "danger";
};

const metricDefinitions: MetricDefinition[] = [
  {
    key: "activeUsers",
    label: "admin.activeUsers",
    note: (data, t) => t("admin.activeUsersNote", { count: data.metrics.newUsers30d }),
    href: "/settings",
    tone: "healthy",
  },
  {
    key: "certificatesTotal",
    label: "admin.managedCertificates",
    note: (data, t) => t("admin.issuedCertificatesNote", { count: data.metrics.certificatesIssued }),
    href: "/certificates",
    tone: "active",
  },
  {
    key: "certificatesExpiring7d",
    label: "admin.expiringSevenDays",
    note: (data, t) => t("admin.expiringThirtyDaysNote", { count: data.metrics.certificatesExpiring30d }),
    href: "/certificates",
    tone: "attention",
  },
  {
    key: "jobsQueued",
    label: "admin.queuedJobs",
    note: (data, t) => t("admin.runningJobsNote", { count: data.metrics.jobsRunning }),
    href: "/executions",
    tone: "active",
  },
  {
    key: "failedExecutions24h",
    label: "admin.failedTwentyFourHours",
    note: (data, t) => t("admin.failureRateNote", { rate: data.metrics.executionFailureRate30d }),
    href: "/executions",
    tone: "danger",
  },
  {
    key: "invalidCloudCredentials",
    label: "admin.invalidCloudCredentials",
    note: (data, t) =>
      t("admin.invalidResourcesNote", {
        dns: data.metrics.invalidDNSAccounts,
        acme: data.metrics.invalidACMEAccounts,
      }),
    href: "/cloud-credentials",
    tone: "danger",
  },
];

function HealthTag({
  id,
  tone,
  children,
}: {
  id: string;
  tone: "healthy" | "attention" | "danger";
  children: ReactNode;
}) {
  const { t } = useLocale();
  return (
    <TagGroup aria-label={t("admin.systemHealth")} size="sm">
      <TagGroup.List>
        <Tag id={id} className={`admin-health-tag admin-health-tag-${tone}`}>
          {children}
        </Tag>
      </TagGroup.List>
    </TagGroup>
  );
}

export function AdminDashboardOverview({ dashboard }: { dashboard: AdminDashboard }) {
  const { locale, t } = useLocale();
  const executionLabel = (kind: string) => (executionLabels[kind] ? t(executionLabels[kind]) : kind);
  const hasCriticalRisk =
    dashboard.metrics.failedExecutions24h > 0 ||
    dashboard.metrics.certificatesExpiring7d > 0 ||
    dashboard.metrics.invalidCloudCredentials > 0 ||
    dashboard.metrics.invalidDNSAccounts > 0 ||
    dashboard.metrics.invalidACMEAccounts > 0;
  const invalidResources =
    dashboard.metrics.invalidCloudCredentials +
    dashboard.metrics.invalidDNSAccounts +
    dashboard.metrics.invalidACMEAccounts;

  return (
    <div className="dashboard-layout admin-dashboard-layout">
      {hasCriticalRisk ? (
        <div className="admin-risk-banner" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>
            {t("admin.riskBanner", {
              expiring: dashboard.metrics.certificatesExpiring7d,
              failed: dashboard.metrics.failedExecutions24h,
            })}
          </span>
          <Link href="/executions">
            {t("admin.viewFailedExecutions")} <ArrowUpRight size={14} />
          </Link>
        </div>
      ) : null}

      <section className="admin-health-strip" aria-label={t("admin.systemHealth")}>
        <div className="admin-health-heading">
          <ServerCog size={18} />
          <span>{t("admin.systemHealth")}</span>
        </div>
        <div className="admin-health-items">
          <HealthTag id="database-ready" tone="healthy">
            <CheckCircle2 size={14} /> {t("admin.databaseReady")}
          </HealthTag>
          <HealthTag id="queue-state" tone={dashboard.metrics.jobsQueued > 0 ? "attention" : "healthy"}>
            {t("admin.queueState", {
              queued: dashboard.metrics.jobsQueued,
              running: dashboard.metrics.jobsRunning,
            })}
          </HealthTag>
          <HealthTag id="smtp-state" tone={dashboard.metrics.smtpConfigured ? "healthy" : "attention"}>
            <Mail size={14} />{" "}
            {dashboard.metrics.smtpConfigured ? t("admin.smtpConfigured") : t("admin.smtpUnconfigured")}
          </HealthTag>
          <HealthTag id="resource-state" tone={invalidResources > 0 ? "danger" : "healthy"}>
            {invalidResources > 0
              ? t("admin.resourceIssues", { count: invalidResources })
              : t("admin.resourceHealthy")}
          </HealthTag>
        </div>
      </section>

      <section className="metric-grid admin-metric-grid" aria-label={t("admin.kpiLabel")}>
        {metricDefinitions.map((metric) => (
          <Link className="metric-link" href={metric.href} key={metric.key}>
            <Card className={`metric-card metric-card-${metric.tone}`}>
              <div className="metric-label">{t(metric.label)}</div>
              <div className="metric-value">{dashboard.metrics[metric.key]}</div>
              <div className="metric-note">{metric.note(dashboard, t)}</div>
            </Card>
          </Link>
        ))}
      </section>

      <AdminDashboardCharts dashboard={dashboard} />

      <section className="content-grid admin-risk-grid">
        <article className="panel">
          <div className="panel-header">
            <div>
              <h2>{t("admin.riskCertificates")}</h2>
              <span className="panel-subtitle">{t("admin.riskCertificatesDescription")}</span>
            </div>
            <Link className="panel-header-link" href="/certificates">
              {t("admin.viewCertificates")} <ArrowUpRight size={14} />
            </Link>
          </div>
          {dashboard.riskCertificates.length === 0 ? (
            <p className="admin-panel-empty">{t("admin.noCertificateRisks")}</p>
          ) : (
            <Table className="dashboard-table" variant="secondary">
              <Table.ScrollContainer>
                <Table.Content aria-label={t("admin.riskCertificates")} className="min-w-[650px]">
                  <Table.Header>
                    <Table.Column isRowHeader>{t("admin.certificates")}</Table.Column>
                    <Table.Column>{t("admin.owner")}</Table.Column>
                    <Table.Column>{t("common.status")}</Table.Column>
                    <Table.Column>{t("dashboard.validity")}</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {dashboard.riskCertificates.map((item) => (
                      <Table.Row key={item.id}>
                        <Table.Cell>
                          <div className="row-title">{item.name}</div>
                          {item.lastError ? (
                            <div className="domain-list admin-error-text">{item.lastError}</div>
                          ) : null}
                        </Table.Cell>
                        <Table.Cell>
                          <span className="muted">{item.ownerEmail || t("admin.unassigned")}</span>
                        </Table.Cell>
                        <Table.Cell>
                          <StatusTag status={item.status} />
                        </Table.Cell>
                        <Table.Cell>
                          <span className="muted">
                            {item.notAfter
                              ? formatDateTime(item.notAfter, locale)
                              : t("dashboard.pendingIssuance")}
                          </span>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          )}
        </article>
        <article className="panel">
          <div className="panel-header">
            <div>
              <h2>{t("admin.recentFailedExecutions")}</h2>
              <span className="panel-subtitle">{t("admin.recentFailedExecutionsDescription")}</span>
            </div>
            <Link className="panel-header-link" href="/executions">
              {t("dashboard.executionHistory")} <ArrowUpRight size={14} />
            </Link>
          </div>
          {dashboard.failedExecutions.length === 0 ? (
            <p className="admin-panel-empty">{t("admin.noFailedExecutions")}</p>
          ) : (
            <Table className="dashboard-table dashboard-execution-table" variant="secondary">
              <Table.ScrollContainer>
                <Table.Content aria-label={t("admin.recentFailedExecutions")} className="min-w-[560px]">
                  <Table.Header>
                    <Table.Column isRowHeader>{t("dashboard.task")}</Table.Column>
                    <Table.Column>{t("admin.owner")}</Table.Column>
                    <Table.Column>{t("admin.time")}</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {dashboard.failedExecutions.map((item) => (
                      <Table.Row key={item.id}>
                        <Table.Cell>
                          <div className="row-title">{item.certificate || executionLabel(item.kind)}</div>
                          <div className="domain-list admin-error-text">
                            {translateErrorCode(item.errorCode, item.error, t) || t("admin.noErrorDetail")}
                          </div>
                        </Table.Cell>
                        <Table.Cell>
                          <span className="muted">{item.ownerEmail || t("admin.unassigned")}</span>
                        </Table.Cell>
                        <Table.Cell>
                          <span className="muted">{formatDateTime(item.startedAt, locale)}</span>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          )}
        </article>
      </section>

      <article className="panel admin-owners-panel">
        <div className="panel-header">
          <div>
            <h2>{t("admin.userDistribution")}</h2>
            <span className="panel-subtitle">{t("admin.userDistributionDescription")}</span>
          </div>
          <Link className="panel-header-link" href="/settings">
            <UsersRound size={14} /> {t("admin.userManagement")}
          </Link>
        </div>
        {dashboard.resourceOwners.length === 0 ? (
          <p className="admin-panel-empty">{t("admin.noUserResources")}</p>
        ) : (
          <Table className="dashboard-table" variant="secondary">
            <Table.ScrollContainer>
              <Table.Content aria-label={t("admin.userDistribution")} className="min-w-[720px]">
                <Table.Header>
                  <Table.Column isRowHeader>{t("admin.owner")}</Table.Column>
                  <Table.Column>{t("admin.certificates")}</Table.Column>
                  <Table.Column>{t("admin.automations")}</Table.Column>
                  <Table.Column>{t("admin.failedThirtyDays")}</Table.Column>
                  <Table.Column>{t("admin.lastActive")}</Table.Column>
                </Table.Header>
                <Table.Body>
                  {dashboard.resourceOwners.map((item) => (
                    <Table.Row key={item.userId}>
                      <Table.Cell>
                        <div className="row-title">{item.email}</div>
                      </Table.Cell>
                      <Table.Cell>{item.certificateCount}</Table.Cell>
                      <Table.Cell>{item.automationCount}</Table.Cell>
                      <Table.Cell>{item.failedExecutions30d}</Table.Cell>
                      <Table.Cell>
                        <span className="muted">{formatDateTime(item.lastActiveAt, locale)}</span>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        )}
      </article>
    </div>
  );
}
