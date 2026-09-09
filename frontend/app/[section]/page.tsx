import { PageHeader } from "@/components/page-header";
import { ConfigurationManager } from "@/components/configuration-manager";
import { getACMEAccounts, getCloudCredentials, getDNSAccounts } from "@/lib/api";

const titles: Record<string, { title: string; description: string }> = {
  "cloud-credentials": { title: "云凭证", description: "凭证版本、权限验证与轮换" },
  "acme-accounts": { title: "ACME 账户", description: "注册账户、密钥与外部账户绑定" },
  "dns-accounts": { title: "DNS 账户", description: "Zone 权限与 DNS-01 验证配置" },
};

export default async function ConfigurationPage({ params }: { params: Promise<{ section: string }> }) {
	const { section } = await params;
	const fallback = { title: "配置", description: "CertFlow 配置" };
	const page = titles[section] ?? fallback;
	if (section === "cloud-credentials") {
		const { credentials } = await getCloudCredentials();
		return <><PageHeader title={page.title} description={page.description} /><ConfigurationManager resource="cloud-credentials" rows={credentials} /></>;
	}
	if (section === "acme-accounts") {
		const { accounts } = await getACMEAccounts();
		return <><PageHeader title={page.title} description={page.description} /><ConfigurationManager resource="acme-accounts" rows={accounts} /></>;
	}
	if (section === "dns-accounts") {
		const [{ accounts }, { credentials }] = await Promise.all([getDNSAccounts(), getCloudCredentials()]);
		return <><PageHeader title={page.title} description={page.description} /><ConfigurationManager resource="dns-accounts" rows={accounts} cloudCredentials={credentials} /></>;
	}

	return (
		<>
		  <PageHeader title={fallback.title} description={fallback.description} />
		  <section className="panel"><div className="empty-state">未找到该配置资源。</div></section>
		</>
	);
}
