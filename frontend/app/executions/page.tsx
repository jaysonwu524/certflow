import { ExecutionList } from "@/components/execution-list";
import { getExecutions } from "@/lib/api";

export default async function ExecutionsPage() {
  const { executions, unavailable } = await getExecutions();

  return (
    <>
      {unavailable ? <div className="api-warning">CertFlow API 当前不可用。</div> : null}
      <ExecutionList executions={executions} />
    </>
  );
}
