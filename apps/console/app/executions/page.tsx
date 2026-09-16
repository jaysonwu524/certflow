import { ExecutionList } from "@/features/automations/components/execution-list";
import { getExecutions } from "@/lib/api";
import { ApiUnavailableWarning } from "@/components/ui/api-unavailable-warning";

export default async function ExecutionsPage() {
  const { executions, unavailable } = await getExecutions();

  return (
    <>
      {unavailable ? <ApiUnavailableWarning /> : null}
      <ExecutionList executions={executions} />
    </>
  );
}
