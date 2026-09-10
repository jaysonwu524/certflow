"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@heroui/react";
import { KeyRound, Plus } from "lucide-react";
import { StatusTag } from "@/components/status-tag";

type Resource = "cloud-credentials" | "acme-accounts" | "dns-accounts";

type CloudCredentialRow = { id: string; name: string; provider: string; credentialHint: string; status: string };
type ACMEAccountRow = { id: string; name: string; directoryUrl: string; email: string; status: string };
type DNSAccountRow = { id: string; name: string; provider: string; cloudCredentialId: string; allowedZones: string[]; status: string };

type ConfigurationManagerProps = {
  resource: Resource;
  rows: CloudCredentialRow[] | ACMEAccountRow[] | DNSAccountRow[];
  cloudCredentials?: CloudCredentialRow[];
};

const resourceLabels: Record<Resource, { singular: string; empty: string }> = {
  "cloud-credentials": { singular: "云凭证", empty: "尚未配置云凭证" },
  "acme-accounts": { singular: "ACME 账户", empty: "尚未配置 ACME 账户" },
  "dns-accounts": { singular: "DNS 账户", empty: "尚未配置 DNS 账户" },
};

export function ConfigurationManager({ resource, rows, cloudCredentials = [] }: ConfigurationManagerProps) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const labels = resourceLabels[resource];

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(event.currentTarget);
    const base = { name: String(form.get("name") ?? "") };
    let payload: Record<string, unknown>;

    if (resource === "cloud-credentials") {
      payload = { ...base, accessKeyId: form.get("accessKeyId"), accessKeySecret: form.get("accessKeySecret") };
    } else if (resource === "acme-accounts") {
      payload = {
        ...base,
        directoryUrl: form.get("directoryUrl"),
        email: form.get("email"),
        privateKey: form.get("privateKey"),
        privateKeyAlgorithm: form.get("privateKeyAlgorithm"),
      };
    } else {
      const selectedZones = form.getAll("allowedZones").map(String).filter(Boolean);
      if (selectedZones.length === 0) {
        setError("请选择至少一个可管理的 Zone");
        setPending(false);
        return;
      }
      payload = {
        ...base,
        cloudCredentialId: form.get("cloudCredentialId"),
        allowedZones: selectedZones,
      };
    }

    const response = await fetch(`/api/${resource}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? `无法创建${labels.singular}`);
      setPending(false);
      return;
    }

    setPending(false);
    setShowForm(false);
    router.refresh();
  }

  return (
    <div className="configuration-layout">
      <section className="panel">
        <div className="panel-header">
          <h2>{labels.singular}列表</h2>
          <Button variant="primary" onPress={() => setShowForm((visible) => !visible)}>
            <Plus size={16} /> {showForm ? "收起表单" : `新建${labels.singular}`}
          </Button>
        </div>
        <ConfigurationTable resource={resource} rows={rows} empty={labels.empty} />
      </section>

      {showForm ? (
        <form className="form-section configuration-form" onSubmit={submit}>
          <h2>新建{labels.singular}</h2>
          <div className="field-grid">
            <div className="field field-wide">
              <label htmlFor="name">名称</label>
              <input id="name" name="name" required autoComplete="off" />
            </div>
            {resource === "cloud-credentials" ? <CloudCredentialFields /> : null}
            {resource === "acme-accounts" ? <ACMEAccountFields /> : null}
            {resource === "dns-accounts" ? <DNSAccountFields cloudCredentials={cloudCredentials} /> : null}
          </div>
          {error ? <div className="form-error">{error}</div> : null}
          <div className="form-actions">
            <Button type="button" variant="secondary" onPress={() => setShowForm(false)}>取消</Button>
            <Button type="submit" variant="primary" isDisabled={pending}><KeyRound size={16} /> {pending ? "正在保存" : "保存"}</Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function CloudCredentialFields() {
  return (
    <>
      <div className="field"><label htmlFor="accessKeyId">AccessKey ID</label><input id="accessKeyId" name="accessKeyId" required autoComplete="off" /></div>
      <div className="field"><label htmlFor="accessKeySecret">AccessKey Secret</label><input id="accessKeySecret" name="accessKeySecret" type="password" required autoComplete="new-password" /></div>
    </>
  );
}

function ACMEAccountFields() {
  return (
    <>
      <div className="field field-wide"><label htmlFor="directoryUrl">ACME Directory URL</label><input id="directoryUrl" name="directoryUrl" type="url" defaultValue="https://acme-v02.api.letsencrypt.org/directory" required /></div>
      <div className="field"><label htmlFor="email">联系邮箱</label><input id="email" name="email" type="email" required /></div>
      <div className="field"><label htmlFor="privateKeyAlgorithm">账户密钥算法</label><select id="privateKeyAlgorithm" name="privateKeyAlgorithm" defaultValue="ecdsa_p256"><option value="ecdsa_p256">ECDSA P-256</option><option value="ecdsa_p384">ECDSA P-384</option><option value="rsa_2048">RSA 2048</option><option value="rsa_4096">RSA 4096</option></select></div>
      <div className="field field-wide"><label htmlFor="privateKey">账户私钥 PEM（可选）</label><textarea id="privateKey" name="privateKey" autoComplete="off" /><span className="field-help">留空将按所选算法自动生成；仅在导入已有 ACME 账户时填写。私钥只会加密保存，创建后不再回显。</span></div>
    </>
  );
}

function DNSAccountFields({ cloudCredentials }: { cloudCredentials: CloudCredentialRow[] }) {
  const [credentialId, setCredentialId] = useState("");
  const [zones, setZones] = useState<DNSZoneOption[]>([]);
  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [zoneError, setZoneError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setZones([]);
    setSelectedZones([]);
    setZoneError("");
    if (!credentialId) return;

    setLoading(true);
    fetch(`/api/cloud-credentials/${credentialId}/dns/zones`)
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { data?: DNSZoneOption[]; message?: string } | null;
        if (!response.ok) throw new Error(body?.message ?? "无法获取可管理的 Zone");
        return body;
      })
      .then((body) => {
        if (!cancelled) setZones(body?.data ?? []);
      })
      .catch((error: unknown) => {
        if (!cancelled) setZoneError(error instanceof Error ? error.message : "无法获取可管理的 Zone");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [credentialId]);

  function toggleZone(zone: string, checked: boolean) {
    setSelectedZones((current) => checked ? [...current, zone] : current.filter((item) => item !== zone));
  }

  return (
    <>
      <div className="field field-wide"><label htmlFor="cloudCredentialId">云凭证</label><select id="cloudCredentialId" name="cloudCredentialId" required value={credentialId} onChange={(event) => setCredentialId(event.target.value)}><option value="" disabled>选择已配置的阿里云凭证</option>{cloudCredentials.map((credential) => <option key={credential.id} value={credential.id}>{credential.name} ({credential.credentialHint})</option>)}</select></div>
      <div className="field field-wide"><span id="allowedZonesLabel" className="field-label">允许管理的 Zone</span><div className="zone-picker" role="group" aria-labelledby="allowedZonesLabel">{loading ? <span className="field-help">正在从阿里云获取 Zone...</span> : null}{!loading && !zoneError && !credentialId ? <span className="field-help">先选择云凭证，再加载该凭证可管理的 Zone。</span> : null}{!loading && !zoneError && credentialId && zones.length === 0 ? <span className="field-help">没有可选 Zone。请确认该凭证有 DNS 域名读取权限。</span> : null}{zones.map((zone) => <label className="zone-option" key={zone.name}><input type="checkbox" name="allowedZones" value={zone.name} checked={selectedZones.includes(zone.name)} onChange={(event) => toggleZone(zone.name, event.target.checked)} /><span>{zone.name}</span></label>)}</div>{zoneError ? <span className="field-help zone-error" role="alert">{zoneError}</span> : <span className="field-help">从阿里云获取后多选 Zone。DNS-01 仅会在选中的 Zone 中创建 challenge TXT 记录。</span>}</div>
    </>
  );
}

type DNSZoneOption = { name: string };

function ConfigurationTable({ resource, rows, empty }: { resource: Resource; rows: ConfigurationManagerProps["rows"]; empty: string }) {
  if (rows.length === 0) return <div className="empty-state">{empty}</div>;

  if (resource === "cloud-credentials") {
    return <div className="table-wrap"><table className="data-table"><thead><tr><th>名称</th><th>提供商</th><th>凭证摘要</th><th>状态</th></tr></thead><tbody>{(rows as CloudCredentialRow[]).map((row) => <tr key={row.id}><td className="row-title">{row.name}</td><td className="muted">{row.provider}</td><td className="muted">{row.credentialHint}</td><td><StatusTag status={row.status} /></td></tr>)}</tbody></table></div>;
  }
  if (resource === "acme-accounts") {
    return <div className="table-wrap"><table className="data-table"><thead><tr><th>名称</th><th>联系邮箱</th><th>Directory</th><th>状态</th></tr></thead><tbody>{(rows as ACMEAccountRow[]).map((row) => <tr key={row.id}><td className="row-title">{row.name}</td><td className="muted">{row.email}</td><td className="domain-list">{row.directoryUrl}</td><td><StatusTag status={row.status} /></td></tr>)}</tbody></table></div>;
  }
  return <div className="table-wrap"><table className="data-table"><thead><tr><th>名称</th><th>Zone</th><th>提供商</th><th>状态</th></tr></thead><tbody>{(rows as DNSAccountRow[]).map((row) => <tr key={row.id}><td className="row-title">{row.name}</td><td className="domain-list">{row.allowedZones.join(", ")}</td><td className="muted">{row.provider}</td><td><StatusTag status={row.status} /></td></tr>)}</tbody></table></div>;
}
