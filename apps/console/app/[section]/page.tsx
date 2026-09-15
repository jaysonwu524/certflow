import { PageHeader } from "@/components/layout/page-header";
import { CloudCredentialManager } from "@/features/credentials/components/cloud-credential-manager";
import { ACMEAccountManager } from "@/features/credentials/components/acme-account-manager";
import { DNSAccountManager } from "@/features/credentials/components/dns-account-manager";
import { getACMEAccounts, getCloudCredentials, getDNSAccounts } from "@/lib/api";
import { CircleSlash } from "lucide-react";

export default async function ConfigurationPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const fallback = { title: "配置", description: "CertFlow 配置" };
  if (section === "cloud-credentials") {
    const { credentials } = await getCloudCredentials();
    return <CloudCredentialManager credentials={credentials} />;
  }
  if (section === "acme-accounts") {
    const { accounts } = await getACMEAccounts();
    return <ACMEAccountManager accounts={accounts} />;
  }
  if (section === "dns-accounts") {
    const [{ accounts, unavailable: accountsUnavailable }, { credentials, unavailable: credentialsUnavailable }] = await Promise.all([
      getDNSAccounts(),
      getCloudCredentials(),
    ]);
    return <DNSAccountManager accounts={accounts} cloudCredentials={credentials} unavailable={accountsUnavailable || credentialsUnavailable} />;
  }

  return (
    <>
      <PageHeader title={fallback.title} description={fallback.description} />
      <section className="panel">
        <div className="resource-empty-state resource-empty-state-empty" role="status">
          <span className="resource-empty-state-icon" aria-hidden="true">
            <CircleSlash size={34} strokeWidth={1.45} />
          </span>
          <div className="resource-empty-state-content">
            <div className="resource-empty-state-copy">
              <strong>未找到该配置资源</strong>
              <p>请从侧边栏选择一个可用的资源管理页面。</p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
