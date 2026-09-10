import Link from "next/link";
import { ExternalLink, Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/status-tag";
import { getCertificates } from "@/lib/api";
import { formatDate } from "@/lib/presentation";

export default async function CertificatesPage() {
  const { certificates, unavailable } = await getCertificates();

  return (
    <>
      <PageHeader
        title="证书"
        description="管理 SAN、通配符、续期窗口和签发状态"
        actions={<Link className="primary-link" href="/certificates/new"><Plus size={17} /> 新建证书</Link>}
      />
      {unavailable ? <div className="api-warning">CertFlow API 当前不可用。</div> : null}
      <section className="panel">
        {certificates.length === 0 ? (
          <div className="empty-state">创建首张证书后，它将显示在这里。</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>证书</th><th>密钥算法</th><th>状态</th><th>到期时间</th><th>验证</th></tr></thead>
              <tbody>
                {certificates.map((certificate) => (
                  <tr key={certificate.id}>
                    <td><div className="row-title">{certificate.name}</div><div className="domain-list">{certificate.domains.join(", ")}</div></td>
                    <td className="muted">{certificate.keyAlgorithm}<div className="domain-list">{certificate.validationMode === "manual" ? "手动 TXT" : "自动 DNS"}</div></td>
                    <td><StatusTag status={certificate.status} /></td>
                    <td className="muted">{certificate.notAfter ? formatDate(certificate.notAfter) : "待签发"}</td>
					<td>{certificate.validationMode === "manual" ? <Link className="table-action" href={`/certificates/${certificate.id}/manual-validation`}>验证记录 <ExternalLink size={14} /></Link> : "自动 DNS"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
