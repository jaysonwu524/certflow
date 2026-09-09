"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@heroui/react";
import { ArrowLeft, CheckCircle2, Copy } from "lucide-react";
import { PageHeader } from "@/components/page-header";

type Challenge = { domain: string; fqdn: string; value: string };
type ManualChallenge = { certificateId: string; status: string; challenges: Challenge[] };

export default function ManualValidationPage({ params }: { params: Promise<{ certificateId: string }> }) {
  const [certificateId, setCertificateId] = useState("");
  const [challenge, setChallenge] = useState<ManualChallenge | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => { params.then(({ certificateId: id }) => setCertificateId(id)); }, [params]);
  useEffect(() => {
    if (!certificateId) return;
    fetch(`/api/certificates/${certificateId}/manual-challenge`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? "未找到待验证的 TXT 记录");
        return response.json() as Promise<ManualChallenge>;
      })
      .then(setChallenge)
      .catch((cause: Error) => setError(cause.message));
  }, [certificateId]);

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
  }

  async function continueValidation() {
    setPending(true);
    setError("");
    const response = await fetch(`/api/certificates/${certificateId}/manual-challenge/continue`, { method: "POST" });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { message?: string } | null;
      setError(body?.message ?? "无法继续验证");
      setPending(false);
      return;
    }
    setChallenge((current) => current ? { ...current, status: "approved" } : current);
    setPending(false);
  }

  return (
    <>
      <PageHeader title="手动 DNS 验证" description="为每条记录创建 TXT 值，生效后确认继续签发。CertFlow 不会修改或删除这些手动记录。" actions={<Link className="secondary-link" href="/certificates"><ArrowLeft size={16} /> 返回证书</Link>} />
      {error ? <div className="form-error">{error}</div> : null}
      {challenge ? <section className="panel manual-validation">
        <div className="manual-validation-header"><div><h2>待验证记录</h2><p>状态：{challenge.status === "waiting_user" ? "等待 DNS 生效" : "已提交验证"}</p></div></div>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>域名</th><th>记录名</th><th>TXT 值</th><th aria-label="复制" /></tr></thead><tbody>{challenge.challenges.map((item) => <tr key={`${item.fqdn}-${item.value}`}><td>{item.domain}</td><td className="dns-value">{item.fqdn}</td><td className="dns-value">{item.value}</td><td><Button isIconOnly aria-label={`复制 ${item.fqdn} TXT 值`} variant="tertiary" onPress={() => copy(item.value)}><Copy size={16} /></Button></td></tr>)}</tbody></table></div>
        {challenge.status === "waiting_user" ? <div className="form-actions"><Button variant="primary" isDisabled={pending} onPress={continueValidation}><CheckCircle2 size={17} /> {pending ? "正在提交" : "TXT 已生效，继续验证"}</Button></div> : null}
      </section> : !error ? <div className="empty-state">正在加载验证记录。</div> : null}
    </>
  );
}
