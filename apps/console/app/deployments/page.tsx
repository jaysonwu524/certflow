import { DeploymentManager } from "@/features/automations/components/deployment-manager";
import { getAutomations, getCertificates, getCloudCredentials, getDeploymentTargets } from "@/lib/api";

export default async function DeploymentsPage() {
  const [{ credentials }, { certificates }, targets, automations] = await Promise.all([getCloudCredentials(), getCertificates(), getDeploymentTargets(), getAutomations()]);
  return <DeploymentManager credentials={credentials} certificates={certificates} initialTargets={targets.data.data} initialAutomations={automations.data.data} />;
}
