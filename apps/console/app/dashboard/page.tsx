import { AdminDashboardOverview } from "@/components/dashboard/admin-dashboard";
import { DashboardAPIWarning } from "@/components/dashboard/dashboard-api-warning";
import { DashboardViewTabs, type DashboardView } from "@/components/dashboard/dashboard-view-tabs";
import { PersonalDashboard } from "@/components/dashboard/personal-dashboard";
import { getAdminDashboard, getAutomations, getCertificates, getCurrentUser, getDashboard, getExecutions } from "@/lib/api";

type DashboardPageProps = { searchParams: Promise<{ view?: string }> };

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const [params, userResult] = await Promise.all([searchParams, getCurrentUser()]);
  const isAdmin = userResult.data?.role === "admin" && !userResult.unavailable;
  const view: DashboardView = isAdmin && params.view === "mine" ? "mine" : "system";

  if (isAdmin && view === "system") {
    const result = await getAdminDashboard();
    return <DashboardViewTabs view={view}>{result.unavailable ? <DashboardAPIWarning /> : <AdminDashboardOverview dashboard={result.data} />}</DashboardViewTabs>;
  }

  const [dashboardResult, certificateResult, executionResult, automationResult] = await Promise.all([
    getDashboard(), getCertificates("mine"), getExecutions("mine"), getAutomations("mine"),
  ]);
  const unavailable = dashboardResult.unavailable || certificateResult.unavailable || executionResult.unavailable || automationResult.unavailable;
  const content = <>{unavailable ? <DashboardAPIWarning /> : null}<PersonalDashboard dashboard={dashboardResult.data} certificates={certificateResult.certificates} executions={executionResult.executions} automations={automationResult.data.data} /></>;
  return isAdmin ? <DashboardViewTabs view={view}>{content}</DashboardViewTabs> : content;
}
