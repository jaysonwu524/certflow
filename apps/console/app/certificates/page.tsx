import { CertificateWorkflow } from "@/features/certificates/components/certificate-workflow";
import { CertificateList } from "@/features/certificates/components/certificate-list";
import { getACMEAccounts, getCertificates, getDNSAccounts } from "@/lib/api";

export default async function CertificatesPage() {
  const [{ certificates, unavailable }, { accounts: acmeAccounts }, { accounts: dnsAccounts }] =
    await Promise.all([getCertificates(), getACMEAccounts(), getDNSAccounts()]);

  return (
    <>
      {unavailable ? <div className="api-warning">CertFlow API 当前不可用。</div> : null}
      <CertificateList certificates={certificates} acmeAccounts={acmeAccounts} dnsAccounts={dnsAccounts} />
      <CertificateWorkflow
        acmeAccounts={acmeAccounts.filter((account) => account.status === "active")}
        dnsAccounts={dnsAccounts.filter((account) => account.status === "active")}
      />
    </>
  );
}
