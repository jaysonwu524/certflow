"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@heroui/react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";

type AccountOption = { id: string; name: string };

export default function NewCertificatePage() {
  const router = useRouter();
	const [error, setError] = useState("");
	const [pending, setPending] = useState(false);
	const [acmeAccounts, setACMEAccounts] = useState<AccountOption[]>([]);
	const [dnsAccounts, setDNSAccounts] = useState<AccountOption[]>([]);
	const [accountsReady, setAccountsReady] = useState(false);
	const [validationMode, setValidationMode] = useState<"auto" | "manual">("auto");

	useEffect(() => {
		Promise.all([
			fetch("/api/acme-accounts").then((response) => response.ok ? response.json() : { data: [] }),
			fetch("/api/dns-accounts").then((response) => response.ok ? response.json() : { data: [] }),
		]).then(([acme, dns]) => {
			setACMEAccounts(acme.data ?? []);
			setDNSAccounts(dns.data ?? []);
			setAccountsReady(true);
		}).catch(() => setAccountsReady(true));
	}, []);

	const canSubmit = acmeAccounts.length > 0 && (validationMode === "manual" || dnsAccounts.length > 0);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(event.currentTarget);
    const domains = String(form.get("domains") ?? "")
      .split(/[\n,]/)
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean);

    const response = await fetch("/api/certificates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
		name: form.get("name"),
		acmeAccountId: form.get("acmeAccountId"),
		defaultDnsAccountId: form.get("defaultDnsAccountId"),
		validationMode,
		domains,
        keyAlgorithm: form.get("keyAlgorithm"),
        renewBeforeDays: Number(form.get("renewBeforeDays")),
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? "无法创建证书配置");
      setPending(false);
      return;
    }

    router.push("/certificates");
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="新建证书"
		description="选择自动 DNS 或手动 TXT 验证方式，创建 DNS-01 证书签发任务"
        actions={<Link className="secondary-link" href="/certificates"><ArrowLeft size={16} /> 返回证书</Link>}
      />
      <form className="form-layout" onSubmit={submit}>
		<section className="form-section">
		  <h2>验证方式</h2>
		  <div className="field-grid">
			<div className="field">
			  <label htmlFor="validationMode">DNS-01 验证</label>
			  <select id="validationMode" name="validationMode" value={validationMode} onChange={(event) => setValidationMode(event.target.value as "auto" | "manual")}>
				<option value="auto">自动更新 DNS TXT</option>
				<option value="manual">手动添加 DNS TXT</option>
			  </select>
			  <span className="field-help">手动模式会暂停签发并显示 TXT 记录；确认写入后再继续校验。</span>
			</div>
		  </div>
		</section>

		<section className="form-section">
		  <h2>签发账户</h2>
		  <div className="field-grid">
			<div className="field"><label htmlFor="acmeAccountId">ACME 账户</label><select id="acmeAccountId" name="acmeAccountId" required defaultValue="" disabled={!accountsReady || acmeAccounts.length === 0}><option value="" disabled>{acmeAccounts.length === 0 ? "请先配置 ACME 账户" : "选择 ACME 账户"}</option>{acmeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></div>
			<div className="field"><label htmlFor="defaultDnsAccountId">DNS 账户</label><select id="defaultDnsAccountId" name="defaultDnsAccountId" required={validationMode === "auto"} defaultValue="" disabled={validationMode === "manual" || !accountsReady || dnsAccounts.length === 0}><option value="" disabled>{validationMode === "manual" ? "手动模式无需 DNS 账户" : dnsAccounts.length === 0 ? "请先配置 DNS 账户" : "选择 DNS 账户"}</option>{dnsAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></div>
		  </div>
		</section>

		<section className="form-section">
		  <h2>证书标识</h2>
          <div className="field-grid">
            <div className="field">
              <label htmlFor="name">名称</label>
              <input id="name" name="name" required placeholder="production-web" />
            </div>
            <div className="field">
              <label htmlFor="keyAlgorithm">密钥算法</label>
              <select id="keyAlgorithm" name="keyAlgorithm" defaultValue="ecdsa_p256">
                <option value="ecdsa_p256">ECDSA P-256</option>
                <option value="ecdsa_p384">ECDSA P-384</option>
                <option value="rsa_2048">RSA 2048</option>
                <option value="rsa_4096">RSA 4096</option>
              </select>
            </div>
            <div className="field field-wide">
              <label htmlFor="domains">域名与 SAN</label>
              <textarea id="domains" name="domains" required placeholder={"example.com\n*.example.com\n*.api.example.com"} />
              <span className="field-help">每行一个域名。`*.example.com` 仅覆盖一层子域；更深层需单独添加 `*.api.example.com`。</span>
            </div>
          </div>
        </section>

        <section className="form-section">
          <h2>续期窗口</h2>
          <div className="field-grid">
            <div className="field">
              <label htmlFor="renewBeforeDays">提前续期天数</label>
              <input id="renewBeforeDays" name="renewBeforeDays" type="number" min="1" max="90" defaultValue="30" required />
            </div>
			<span className="field-help">是否自动续期、上传 SSL 或更新 ALB，请在“自动化”中创建对应任务。</span>
          </div>
        </section>

		{!canSubmit && accountsReady ? <div className="form-error">创建证书前，需要 ACME 账户；自动模式还需要 DNS 账户。</div> : null}
		{error ? <div className="form-error">{error}</div> : null}
        <div className="form-actions">
          <Link className="secondary-link" href="/certificates">取消</Link>
		  <Button type="submit" variant="primary" isDisabled={pending || !canSubmit}>
			<ShieldCheck size={17} /> {pending ? "正在创建" : "创建并排队签发"}
          </Button>
        </div>
      </form>
    </>
  );
}
