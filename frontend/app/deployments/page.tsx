import { PageHeader } from "@/components/page-header";
import { DeploymentManager } from "@/components/deployment-manager";
import { getCertificateDeployments, getCertificates, getCloudCredentials, getDeploymentTargets } from "@/lib/api";

export default async function DeploymentsPage() {
  const [{ credentials }, { certificates }, targets, deployments] = await Promise.all([getCloudCredentials(), getCertificates(), getDeploymentTargets(), getCertificateDeployments()]);
  return <><PageHeader title="ALB 部署" description="查询地域、ALB 和 HTTPS 监听器，将已签发证书上传到阿里云 SSL 并更新监听器" /><DeploymentManager credentials={credentials} certificates={certificates} initialTargets={targets.data.data} initialDeployments={deployments.data.data} /></>;
}
