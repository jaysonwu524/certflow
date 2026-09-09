import Link from "next/link";
import { Card } from "@heroui/react";
import { AlertTriangle, ArrowUpRight, Clock3, Plus, Workflow } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/status-tag";
import { getCertificates, getDashboard, getExecutions } from "@/lib/api";
import { formatDateTime } from "@/lib/presentation";

const metricDefinitions = [
  { key: "activeCertificates", label: "有效证书", note: "当前可用版本" },
  { key: "expiringSoon", label: "30 天内到期", note: "需要关注" },
  { key: "runningJobs", label: "执行中的任务", note: "签发与部署" },
  { key: "failedExecutions", label: "近 7 天失败", note: "需要处理" },
] as const;

export default async function DashboardPage() {
  const [dashboardResult, certificateResult, executionResult] = await Promise.all([
    getDashboard(),
    getCertificates(),
    getExecutions(),
  ]);
  const unavailable = dashboardResult.unavailable || certificateResult.unavailable || executionResult.unavailable;
  const executions = executionResult.executions.slice(0, 5);

  return (
    <>
      <PageHeader
        title="概览"
        description="证书生命周期、部署状态与近期任务"
        actions={
          <Link className="primary-link" href="/certificates/new">
            <Plus size={17} /> 新建证书
          </Link>
        }
      />

      {unavailable ? (
        <div className="api-warning"><AlertTriangle size={17} /> 无法连接 CertFlow API。启动 PostgreSQL 与后端后，数据会自动显示。</div>
      ) : null}

      <section className="metric-grid" aria-label="证书状态汇总">
        {metricDefinitions.map((metric) => (
          <Card className="metric-card" key={metric.key}>
            <div className="metric-label">{metric.label}</div>
            <div className="metric-value">{dashboardResult.data[metric.key]}</div>
            <div className="metric-note">{metric.note}</div>
          </Card>
        ))}
      </section>

      <section className="content-grid">
        <article className="panel">
          <div className="panel-header">
            <h2>证书状态</h2>
            <Link href="/certificates">查看全部 <ArrowUpRight size={14} /></Link>
          </div>
          {certificateResult.certificates.length === 0 ? (
            <div className="empty-state">尚未创建证书</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>名称</th><th>状态</th><th>有效期</th></tr></thead>
                <tbody>
                  {certificateResult.certificates.slice(0, 5).map((certificate) => (
                    <tr key={certificate.id}>
                      <td><div className="row-title">{certificate.name}</div><div className="domain-list">{certificate.domains.join(", ")}</div></td>
                      <td><StatusTag status={certificate.status} /></td>
                      <td className="muted">{certificate.notAfter ? formatDateTime(certificate.notAfter) : "待签发"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <article className="panel">
          <div className="panel-header"><h2>最近执行</h2><Link href="/executions">执行记录 <ArrowUpRight size={14} /></Link></div>
          <div className="panel-body">
            {executions.length === 0 ? (
              <div className="empty-state"><Workflow size={21} /> 暂无执行记录</div>
            ) : (
              <div className="activity-list">
                {executions.map((execution) => (
                  <div className="activity-item" key={execution.id}>
                    <div className="activity-title"><span>{execution.certificate || execution.kind}</span><StatusTag status={execution.status} /></div>
                    <div className="activity-meta"><Clock3 size={13} /> {formatDateTime(execution.startedAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </article>
      </section>
    </>
  );
}
