import Link from "next/link";
import { Card, Table } from "@heroui/react";
import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { DashboardEmptyState } from "@/components/dashboard-empty-state";
import { DashboardCharts } from "@/components/dashboard-charts";
import { StatusTag } from "@/components/status-tag";
import { getAutomations, getCertificates, getDashboard, getExecutions } from "@/lib/api";
import { formatDateTime } from "@/lib/presentation";

const metricDefinitions = [
  { key: "activeCertificates", label: "有效证书", note: "当前可用版本", tone: "healthy" },
  { key: "expiringSoon", label: "30 天内到期", note: "需要关注", tone: "attention" },
  { key: "runningJobs", label: "执行中的任务", note: "签发与部署", tone: "active" },
  { key: "failedExecutions", label: "近 7 天失败", note: "需要处理", tone: "danger" },
] as const;

const executionLabels: Record<string, string> = {
  issue: "签发证书",
  renew: "续期证书",
  upload: "上传 SSL 证书管理",
  deploy: "更新 ALB",
  cleanup: "清理任务",
};

export default async function DashboardPage() {
  const [dashboardResult, certificateResult, executionResult, automationResult] = await Promise.all([
    getDashboard(),
    getCertificates(),
    getExecutions(),
    getAutomations(),
  ]);
  const unavailable =
    dashboardResult.unavailable || certificateResult.unavailable || executionResult.unavailable || automationResult.unavailable;
  const executions = executionResult.executions.slice(0, 5);

  return (
    <div className="dashboard-layout">
      {unavailable ? (
        <div className="api-warning">
          <AlertTriangle size={17} /> 无法连接 CertFlow API。启动 PostgreSQL 与后端后，数据会自动显示。
        </div>
      ) : null}

      <section className="metric-grid" aria-label="证书状态汇总">
        {metricDefinitions.map((metric) => (
          <Card className={`metric-card metric-card-${metric.tone}`} key={metric.key}>
            <div className="metric-label">{metric.label}</div>
            <div className="metric-value">{dashboardResult.data[metric.key]}</div>
            <div className="metric-note">{metric.note}</div>
          </Card>
        ))}
      </section>

      <DashboardCharts
        certificates={certificateResult.certificates}
        executions={executionResult.executions}
        automations={automationResult.data.data}
      />

      <section className="content-grid">
        <article className="panel dashboard-certificate-panel">
          <div className="panel-header">
            <div>
              <h2>证书状态</h2>
              <span className="panel-subtitle">最近创建的证书</span>
            </div>
            <Link className="panel-header-link" href="/certificates">
              查看全部 <ArrowUpRight size={14} />
            </Link>
          </div>
          {certificateResult.certificates.length === 0 ? (
            <DashboardEmptyState
              kind="certificates"
              title="尚未创建证书"
              description="创建首张证书后，状态与有效期会显示在这里。"
            />
          ) : (
            <Table className="dashboard-table" variant="secondary">
              <Table.ScrollContainer>
                <Table.Content aria-label="证书状态" className="min-w-[620px]">
                  <Table.Header>
                    <Table.Column isRowHeader>名称</Table.Column>
                    <Table.Column>状态</Table.Column>
                    <Table.Column>有效期</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {certificateResult.certificates.slice(0, 5).map((certificate) => (
                      <Table.Row key={certificate.id}>
                        <Table.Cell>
                          <div className="row-title">{certificate.name}</div>
                          <div className="domain-list">{certificate.domains.join(", ")}</div>
                        </Table.Cell>
                        <Table.Cell>
                          <StatusTag status={certificate.status} />
                        </Table.Cell>
                        <Table.Cell>
                          <span className="muted">
                            {certificate.notAfter ? formatDateTime(certificate.notAfter) : "待签发"}
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
              <h2>最近执行</h2>
              <span className="panel-subtitle">最近 5 条任务记录</span>
            </div>
            <Link className="panel-header-link" href="/executions">
              执行记录 <ArrowUpRight size={14} />
            </Link>
          </div>
          {executions.length === 0 ? (
            <div className="panel-body">
              <DashboardEmptyState
                kind="executions"
                title="暂无执行记录"
                description="签发、续期或部署任务运行后，将在这里展示结果。"
              />
            </div>
          ) : (
            <Table className="dashboard-table dashboard-execution-table" variant="secondary">
              <Table.ScrollContainer>
                <Table.Content aria-label="最近执行" className="min-w-[480px]">
                  <Table.Header>
                    <Table.Column isRowHeader>任务</Table.Column>
                    <Table.Column>状态</Table.Column>
                    <Table.Column>开始时间</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {executions.map((execution) => (
                      <Table.Row key={execution.id}>
                        <Table.Cell>
                          <div className="row-title">{execution.certificate || executionLabels[execution.kind] || execution.kind}</div>
                          <div className="domain-list">{executionLabels[execution.kind] || execution.kind}</div>
                        </Table.Cell>
                        <Table.Cell><StatusTag status={execution.status} /></Table.Cell>
                        <Table.Cell><span className="muted">{formatDateTime(execution.startedAt)}</span></Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          )}
        </article>
      </section>
    </div>
  );
}
