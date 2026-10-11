"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, Tag, TagGroup } from "@heroui/react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  FileKey2,
  History,
  Plus,
  ShieldAlert,
  Workflow,
} from "lucide-react";
import { useId } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { useLocale, type TranslationKey } from "@/components/providers/locale-provider";
import { StatusTag } from "@/components/ui/status-tag";
import type { AutomationTask, Certificate, Dashboard, Execution } from "@/lib/api";
import { formatDateTime } from "@/lib/presentation";

type Scope = "all" | "mine";
type AttentionItem = {
  id: string;
  kind: "certificate" | "execution" | "automation" | "resource";
  priority: number;
  title: string;
  detail: string;
  href: string;
  status?: string;
  timestamp?: string | null;
};

type OperationsOverviewProps = {
  isAdmin: boolean;
  scope: Scope;
  summary: Dashboard;
  invalidResources?: number;
  certificates: Certificate[];
  executions: Execution[];
  automations: AutomationTask[];
};

const activeExecutionStatuses = new Set(["queued", "running", "waiting_user"]);
const executionLabels: Record<string, TranslationKey> = {
  issue: "execution.issue",
  renew: "execution.renew",
  upload: "execution.upload",
  deploy: "execution.deploy",
  cleanup: "execution.cleanup",
};

function daysUntil(value: string | null) {
  if (!value) return null;
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
}

function getCertificatePriority(certificate: Certificate) {
  const remaining = daysUntil(certificate.notAfter);
  if (
    certificate.status === "failed" ||
    certificate.status === "expired" ||
    (remaining !== null && remaining < 0)
  )
    return 100;
  if (remaining !== null && remaining <= 7) return 80;
  return 0;
}

function AttentionTag({
  tone,
  children,
}: {
  tone: "danger" | "attention" | "healthy";
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <TagGroup aria-label={String(children)} size="sm">
      <TagGroup.List>
        <Tag id={id} className={`overview-attention-tag overview-attention-tag-${tone}`}>
          {children}
        </Tag>
      </TagGroup.List>
    </TagGroup>
  );
}

function EmptyPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="overview-empty-panel">
      <CheckCircle2 size={19} aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
    </div>
  );
}

export function OperationsOverview({
  isAdmin,
  scope,
  summary,
  invalidResources = 0,
  certificates,
  executions,
  automations,
}: OperationsOverviewProps) {
  const { locale, t } = useLocale();
  const router = useRouter();
  const isGlobal = isAdmin && scope === "all";
  const activeExecutions = executions.filter((item) => activeExecutionStatuses.has(item.status)).slice(0, 4);
  const recentExecutions = [...executions]
    .sort((left, right) => new Date(right.startedAt ?? 0).getTime() - new Date(left.startedAt ?? 0).getTime())
    .slice(0, 6);
  const upcomingCertificates = certificates
    .filter((item) => {
      const remaining = daysUntil(item.notAfter);
      return remaining !== null && remaining <= 30;
    })
    .sort((left, right) => (daysUntil(left.notAfter) ?? Infinity) - (daysUntil(right.notAfter) ?? Infinity))
    .slice(0, 5);
  const automationAttention = automations
    .filter((item) => item.enabled && item.lastStatus === "failed")
    .slice(0, 4);

  const attentionItems: AttentionItem[] = [
    ...certificates
      .filter((item) => getCertificatePriority(item) > 0)
      .map((item) => {
        const remaining = daysUntil(item.notAfter);
        const priority = getCertificatePriority(item);
        return {
          id: `certificate-${item.id}`,
          kind: "certificate" as const,
          priority,
          title: item.name,
          detail:
            priority === 100
              ? item.lastError || t("overview.certificateFailure")
              : t("overview.expiresIn", { days: Math.max(remaining ?? 0, 0) }),
          href: `/certificates?selected=${item.id}`,
          status: item.status,
          timestamp: item.notAfter,
        };
      }),
    ...executions
      .filter((item) => item.status === "failed")
      .map((item) => ({
        id: `execution-${item.id}`,
        kind: "execution" as const,
        priority: 90,
        title: item.certificate || executionLabel(item.kind, t),
        detail: item.error || t("overview.executionFailure"),
        href: "/executions",
        status: item.status,
        timestamp: item.startedAt,
      })),
    ...automationAttention.map((item) => ({
      id: `automation-${item.id}`,
      kind: "automation" as const,
      priority: 70,
      title: item.name,
      detail: item.lastError || t("overview.automationFailure"),
      href: `/deployments?automation=${item.id}`,
      status: item.lastStatus,
      timestamp: item.lastRunAt,
    })),
    ...(invalidResources > 0
      ? [
          {
            id: "invalid-resources",
            kind: "resource" as const,
            priority: 95,
            title: t("overview.invalidResources", { count: invalidResources }),
            detail: t("overview.invalidResourcesDescription"),
            href: "/cloud-credentials",
          },
        ]
      : []),
  ]
    .sort((left, right) => right.priority - left.priority)
    .slice(0, 5);

  const actionCount = attentionItems.length;
  const metrics = [
    {
      label: t("overview.attention"),
      value: actionCount,
      note: t("overview.attentionNote"),
      href: "#priority",
    },
    {
      label: t("overview.running"),
      value: summary.runningJobs,
      note: t("overview.runningNote"),
      href: "#live",
    },
    {
      label: t("overview.expiringSevenDays"),
      value: certificates.filter((item) => (daysUntil(item.notAfter) ?? Infinity) <= 7).length,
      note: t("overview.expiringNote"),
      href: "#expiry",
    },
    {
      label: t("overview.managed"),
      value: summary.activeCertificates,
      note: t("overview.managedNote"),
      href: "/certificates",
    },
  ];

  return (
    <div className="operations-overview">
      <PageHeader
        title={t("overview.title")}
        description={isGlobal ? t("overview.globalDescription") : t("overview.personalDescription")}
        actions={
          <>
            <Button size="sm" variant="primary" onPress={() => router.push("/certificates?modal=create")}>
              <Plus size={16} />
              {t("overview.createCertificate")}
            </Button>
          </>
        }
      />

      {certificates.length === 0 ? (
        <Card className="overview-onboarding">
          <Card.Content>
            <div className="overview-onboarding-icon">
              <FileKey2 size={22} />
            </div>
            <div>
              <h2>{t("overview.firstCertificateTitle")}</h2>
              <p>{t("overview.firstCertificateDescription")}</p>
            </div>
            <Button variant="primary" onPress={() => router.push("/certificates?modal=create")}>
              <Plus size={16} />
              {t("overview.createCertificate")}
            </Button>
          </Card.Content>
        </Card>
      ) : null}

      <section className="overview-metrics" aria-label={t("overview.metricsLabel")}>
        {metrics.map((metric) => (
          <Link className="overview-metric" href={metric.href} key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.note}</small>
          </Link>
        ))}
      </section>

      <section className="overview-primary-grid">
        <Card className="overview-panel overview-priority-panel" id="priority">
          <Card.Header className="overview-panel-header">
            <div>
              <Card.Title>{t("overview.priorityTitle")}</Card.Title>
              <Card.Description>{t("overview.priorityDescription")}</Card.Description>
            </div>
            {actionCount > 0 ? (
              <AttentionTag tone="danger">{t("overview.actionCount", { count: actionCount })}</AttentionTag>
            ) : null}
          </Card.Header>
          <Card.Content className="overview-panel-content">
            {attentionItems.length === 0 ? (
              <EmptyPanel
                title={t("overview.allClearTitle")}
                description={t("overview.allClearDescription")}
              />
            ) : (
              <div className="overview-action-list">
                {attentionItems.map((item) => (
                  <Link
                    href={item.href}
                    key={item.id}
                    className={`overview-action-row overview-action-${item.kind}`}
                  >
                    <span className="overview-action-icon" aria-hidden="true">
                      {item.kind === "certificate" ? (
                        <FileKey2 size={17} />
                      ) : item.kind === "execution" ? (
                        <AlertTriangle size={17} />
                      ) : item.kind === "automation" ? (
                        <Workflow size={17} />
                      ) : (
                        <ShieldAlert size={17} />
                      )}
                    </span>
                    <span className="overview-action-copy">
                      <strong>{item.title}</strong>
                      <span>{item.detail}</span>
                    </span>
                    {item.status ? (
                      <StatusTag status={item.status} />
                    ) : (
                      <AttentionTag tone="danger">{t("overview.needsAction")}</AttentionTag>
                    )}
                    <ArrowUpRight className="overview-row-arrow" size={16} aria-hidden="true" />
                  </Link>
                ))}
              </div>
            )}
          </Card.Content>
        </Card>

        <Card className="overview-panel overview-live-panel" id="live">
          <Card.Header className="overview-panel-header">
            <div>
              <Card.Title>{t("overview.liveTitle")}</Card.Title>
              <Card.Description>{t("overview.liveDescription")}</Card.Description>
            </div>
            <Link href="/executions" className="overview-panel-link">
              {t("overview.viewExecutions")} <ArrowUpRight size={14} />
            </Link>
          </Card.Header>
          <Card.Content className="overview-panel-content">
            {activeExecutions.length === 0 ? (
              <EmptyPanel title={t("overview.noLiveTitle")} description={t("overview.noLiveDescription")} />
            ) : (
              <div className="overview-live-list">
                {activeExecutions.map((item) => (
                  <Link href="/executions" key={item.id} className="overview-live-row">
                    <span className="overview-live-icon">
                      <Activity size={16} />
                    </span>
                    <span>
                      <strong>{item.certificate || executionLabel(item.kind, t)}</strong>
                      <small>{executionLabel(item.kind, t)}</small>
                    </span>
                    <StatusTag status={item.status} />
                  </Link>
                ))}
              </div>
            )}
          </Card.Content>
        </Card>
      </section>

      <section className="overview-secondary-grid">
        <Card className="overview-panel" id="expiry">
          <Card.Header className="overview-panel-header">
            <div>
              <Card.Title>{t("overview.expiryTitle")}</Card.Title>
              <Card.Description>{t("overview.expiryDescription")}</Card.Description>
            </div>
            <Link href="/certificates" className="overview-panel-link">
              {t("overview.viewCertificates")} <ArrowUpRight size={14} />
            </Link>
          </Card.Header>
          <Card.Content className="overview-panel-content">
            {upcomingCertificates.length === 0 ? (
              <EmptyPanel
                title={t("overview.noExpiryTitle")}
                description={t("overview.noExpiryDescription")}
              />
            ) : (
              <div className="overview-expiry-list">
                {upcomingCertificates.map((item) => {
                  const remaining = daysUntil(item.notAfter) ?? 0;
                  return (
                    <Link
                      href={`/certificates?selected=${item.id}`}
                      key={item.id}
                      className="overview-expiry-row"
                    >
                      <span>
                        <strong>{item.name}</strong>
                        <small>{item.domains.join(", ")}</small>
                      </span>
                      <span
                        className={
                          remaining <= 7 ? "overview-expiry-value is-urgent" : "overview-expiry-value"
                        }
                      >
                        {remaining <= 0
                          ? t("overview.expired")
                          : t("overview.expiresIn", { days: remaining })}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </Card.Content>
        </Card>

        <Card className="overview-panel">
          <Card.Header className="overview-panel-header">
            <div>
              <Card.Title>{t("overview.automationTitle")}</Card.Title>
              <Card.Description>{t("overview.automationDescription")}</Card.Description>
            </div>
            <Link href="/automations" className="overview-panel-link">
              {t("overview.viewAutomations")} <ArrowUpRight size={14} />
            </Link>
          </Card.Header>
          <Card.Content className="overview-panel-content">
            {automationAttention.length === 0 ? (
              <EmptyPanel
                title={t("overview.noAutomationTitle")}
                description={t("overview.noAutomationDescription")}
              />
            ) : (
              <div className="overview-automation-list">
                {automationAttention.map((item) => (
                  <Link
                    href={`/deployments?automation=${item.id}`}
                    key={item.id}
                    className="overview-automation-row"
                  >
                    <span className="overview-live-icon">
                      <Workflow size={16} />
                    </span>
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.lastError || item.certificateName}</small>
                    </span>
                    <StatusTag status={item.lastStatus} />
                  </Link>
                ))}
              </div>
            )}
          </Card.Content>
        </Card>
      </section>

      <Card className="overview-panel overview-activity-panel">
        <Card.Header className="overview-panel-header">
          <div>
            <Card.Title>{t("overview.activityTitle")}</Card.Title>
            <Card.Description>{t("overview.activityDescription")}</Card.Description>
          </div>
          <Link href="/executions" className="overview-panel-link">
            {t("overview.viewAll")} <ArrowUpRight size={14} />
          </Link>
        </Card.Header>
        <Card.Content className="overview-panel-content">
          {recentExecutions.length === 0 ? (
            <EmptyPanel
              title={t("overview.noActivityTitle")}
              description={t("overview.noActivityDescription")}
            />
          ) : (
            <div className="overview-activity-list">
              {recentExecutions.map((item) => (
                <Link href="/executions" key={item.id} className="overview-activity-row">
                  <span className="overview-live-icon">
                    <History size={16} />
                  </span>
                  <span className="overview-activity-copy">
                    <strong>{item.certificate || executionLabel(item.kind, t)}</strong>
                    <small>
                      {executionLabel(item.kind, t)}
                      {item.target ? ` · ${item.target}` : ""}
                    </small>
                  </span>
                  <StatusTag status={item.status} />
                  <time>{formatDateTime(item.startedAt, locale, t("overview.notStarted"))}</time>
                </Link>
              ))}
            </div>
          )}
        </Card.Content>
      </Card>
    </div>
  );
}

function executionLabel(kind: string, t: ReturnType<typeof useLocale>["t"]) {
  return t(executionLabels[kind] ?? "dashboard.task");
}
