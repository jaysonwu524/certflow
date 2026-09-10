import { PageHeader } from "@/components/page-header";
import { DeploymentManager } from "@/components/deployment-manager";
import { getAutomations, getCertificates, getCloudCredentials, getDeploymentTargets } from "@/lib/api";

export default async function DeploymentsPage() {
  const [{ credentials }, { certificates }, targets, automations] = await Promise.all([getCloudCredentials(), getCertificates(), getDeploymentTargets(), getAutomations()]);
  return <><PageHeader title="自动化" description="配置证书续期、阿里云 SSL 同步和 ALB 更新任务" /><DeploymentManager credentials={credentials} certificates={certificates} initialTargets={targets.data.data} initialAutomations={automations.data.data} /></>;
}
