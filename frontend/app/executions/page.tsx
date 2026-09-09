import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/status-tag";
import { getExecutions } from "@/lib/api";
import { formatDateTime } from "@/lib/presentation";

export default async function ExecutionsPage() {
  const { executions, unavailable } = await getExecutions();

  return (
    <>
      <PageHeader title="执行记录" description="签发、续期、部署和通知任务的运行历史" />
      {unavailable ? <div className="api-warning">CertFlow API 当前不可用。</div> : null}
      <section className="panel">
        {executions.length === 0 ? (
          <div className="empty-state">暂无执行记录</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>任务</th><th>证书</th><th>触发方式</th><th>开始时间</th><th>状态</th></tr></thead>
              <tbody>
                {executions.map((execution) => (
                  <tr key={execution.id}>
                    <td className="row-title">{execution.kind}</td>
                    <td className="muted">{execution.certificate || "-"}</td>
                    <td className="muted">{execution.trigger}</td>
                    <td className="muted">{formatDateTime(execution.startedAt)}</td>
                    <td><StatusTag status={execution.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
