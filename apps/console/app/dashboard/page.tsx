import { DashboardAPIWarning } from "@/components/dashboard/dashboard-api-warning";
import { DashboardViewTabs, type DashboardView } from "@/components/dashboard/dashboard-view-tabs";
import { ObservabilityOverview } from "@/components/dashboard/observability-overview";
import { OperationsOverview } from "@/components/dashboard/operations-overview";
import {
  getAdminDashboard,
  getAdminObservability,
  getAutomations,
  getCertificates,
  getCurrentUser,
  getDashboard,
  getExecutions,
} from "@/lib/api";

type DashboardPageProps = { searchParams: Promise<{ scope?: string; view?: string }> };

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const [params, userResult] = await Promise.all([searchParams, getCurrentUser()]);
  const isAdmin = userResult.data?.role === "admin" && !userResult.unavailable;
  const view: DashboardView =
    isAdmin && (params.view === "mine" || params.view === "observability") ? params.view : "system";

  if (isAdmin && view === "observability") {
    const result = await getAdminObservability();
    const content = result.unavailable ? (
      <DashboardAPIWarning />
    ) : (
      <ObservabilityOverview initialSnapshot={result.data} />
    );
    return <DashboardViewTabs view={view}>{content}</DashboardViewTabs>;
  }

  if (isAdmin && view === "system") {
    const [adminResult, certificateResult, executionResult, automationResult] = await Promise.all([
      getAdminDashboard(),
      getCertificates(),
      getExecutions(),
      getAutomations(),
    ]);
    const unavailable =
      adminResult.unavailable ||
      certificateResult.unavailable ||
      executionResult.unavailable ||
      automationResult.unavailable;

    const content = (
      <>
        {unavailable ? <DashboardAPIWarning /> : null}
        <OperationsOverview
          isAdmin
          scope="all"
          summary={{
            activeCertificates: adminResult.data.metrics.certificatesIssued,
            expiringSoon: adminResult.data.metrics.certificatesExpiring30d,
            runningJobs: adminResult.data.metrics.jobsRunning,
            failedExecutions: adminResult.data.metrics.failedExecutions24h,
          }}
          invalidResources={
            adminResult.data.metrics.invalidCloudCredentials +
            adminResult.data.metrics.invalidDNSAccounts +
            adminResult.data.metrics.invalidACMEAccounts
          }
          certificates={certificateResult.certificates}
          executions={executionResult.executions}
          automations={automationResult.data.data}
        />
      </>
    );
    return <DashboardViewTabs view={view}>{content}</DashboardViewTabs>;
  }

  const [dashboardResult, certificateResult, executionResult, automationResult] = await Promise.all([
    getDashboard(),
    getCertificates("mine"),
    getExecutions("mine"),
    getAutomations("mine"),
  ]);
  const unavailable =
    dashboardResult.unavailable ||
    certificateResult.unavailable ||
    executionResult.unavailable ||
    automationResult.unavailable;
  const content = (
    <>
      {unavailable ? <DashboardAPIWarning /> : null}
      <OperationsOverview
        isAdmin={isAdmin}
        scope="mine"
        summary={dashboardResult.data}
        certificates={certificateResult.certificates}
        executions={executionResult.executions}
        automations={automationResult.data.data}
      />
    </>
  );
  return isAdmin ? <DashboardViewTabs view="mine">{content}</DashboardViewTabs> : content;
}
