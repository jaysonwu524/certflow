"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, Checkbox, Dropdown, Input, ListBox, Select, TextArea } from "@heroui/react";
import { Ellipsis, KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { StatusTag } from "@/components/status-tag";
import { ResourceEmptyState } from "@/components/resource-empty-state";
import { ModalCancelButton, ResourceModal } from "@/components/resource-modal";
import { ApiError } from "@/lib/api-error";
import { apiRequest } from "@/lib/api-client";

type Resource = "cloud-credentials" | "acme-accounts" | "dns-accounts";

type CloudCredentialRow = {
  id: string;
  name: string;
  provider: string;
  credentialHint: string;
  status: string;
};
type ACMEAccountRow = { id: string; name: string; directoryUrl: string; email: string; status: string };
type DNSAccountRow = {
  id: string;
  name: string;
  provider: string;
  cloudCredentialId: string;
  allowedZones: string[];
  status: string;
};

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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const labels = resourceLabels[resource];
  const modal = searchParams.get("modal");
  const mode = searchParams.get("mode") === "edit" ? "edit" : "view";
  const selectedId = searchParams.get("selected");
  const selected = rows.find((row) => row.id === selectedId);
  const formOpen = modal === "create" || Boolean(selected && mode === "edit");
  const detailOpen = Boolean(selected && modal !== "create" && mode === "view");

  function setModal(next: { modal?: "create"; selected?: string; mode?: "view" | "edit" }) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("modal");
    params.delete("selected");
    params.delete("mode");
    if (next.modal) params.set("modal", next.modal);
    if (next.selected) params.set("selected", next.selected);
    if (next.mode) params.set("mode", next.mode);
    router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
  }

  function closeAll() {
    setError("");
    setDeleteTarget(null);
    setModal({});
  }

  function requestDelete(id: string) {
    const row = rows.find((item) => item.id === id);
    if (row) setDeleteTarget({ id: row.id, name: row.name });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(event.currentTarget);
    const base = { name: String(form.get("name") ?? "") };
    let payload: Record<string, unknown>;

    if (resource === "cloud-credentials") {
      const provider = String(form.get("provider") ?? "aliyun");
      const credentials: Record<string, string> = {};

      // Extract all credentials.* fields
      for (const [key, value] of form.entries()) {
        if (key.startsWith("credentials.")) {
          const credKey = key.replace("credentials.", "");
          credentials[credKey] = String(value);
        }
      }

      payload = {
        ...base,
        provider,
        credentials,
      };
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

    try {
      const method = selected && mode === "edit" ? "PATCH" : "POST";
      const path = selected && mode === "edit" ? `/api/${resource}/${selected.id}` : `/api/${resource}`;
      await apiRequest(path, { method, body: payload });
      setPending(false);
      closeAll();
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : `无法保存${labels.singular}`);
      setPending(false);
    }
  }

  async function deleteResource() {
    if (!deleteTarget) return;
    setPending(true);
    setError("");
    try {
      await apiRequest(`/api/${resource}/${deleteTarget.id}`, { method: "DELETE" });
      setPending(false);
      closeAll();
      router.refresh();
    } catch (requestError) {
      setPending(false);
      setDeleteTarget(null);
      setError(
        requestError instanceof ApiError && requestError.status === 409
          ? "该资源仍被其他配置引用，无法删除。"
          : requestError instanceof Error
            ? requestError.message
            : `无法删除${labels.singular}`,
      );
    }
  }

  return (
    <div className="configuration-layout">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>{labels.singular}</h2>
            <span className="panel-subtitle">{rows.length} 个已配置资源</span>
          </div>
          <Button variant="primary" onPress={() => setModal({ modal: "create" })}>
            <Plus size={16} />
            新建{labels.singular}
          </Button>
        </div>
        <ConfigurationTable
          resource={resource}
          rows={rows}
          empty={labels.empty}
          onSelect={(id) => setModal({ selected: id, mode: "view" })}
          onEdit={(id) => setModal({ selected: id, mode: "edit" })}
          onDelete={requestDelete}
        />
      </section>
      <ResourceModal
        isOpen={formOpen}
        onOpenChange={(open) => !open && closeAll()}
        title={selected ? `编辑${labels.singular}` : `新建${labels.singular}`}
        description={
          selected ? "未填写的敏感字段会维持原值，不会在此处回显。" : "保存后可在当前列表中查看状态。"
        }
        footer={
          <>
            <ModalCancelButton onPress={closeAll} />
            <Button form="configuration-form" type="submit" variant="primary" isDisabled={pending}>
              <KeyRound size={16} />
              {pending ? "正在保存" : "保存"}
            </Button>
          </>
        }
      >
        <form id="configuration-form" className="drawer-form" onSubmit={submit}>
          <div className="field-grid">
            <div className="field field-wide">
              <label htmlFor="name">名称</label>
              <Input
                id="name"
                name="name"
                required
                autoComplete="off"
                defaultValue={selected?.name ?? ""}
                key={`name-${selected?.id ?? "new"}`}
              />
            </div>
            {resource === "cloud-credentials" ? (
              <CloudCredentialFields initial={selected as CloudCredentialRow | undefined} />
            ) : null}
            {resource === "acme-accounts" ? (
              <ACMEAccountFields initial={selected as ACMEAccountRow | undefined} />
            ) : null}
            {resource === "dns-accounts" ? (
              <DNSAccountFields
                cloudCredentials={cloudCredentials}
                initial={selected as DNSAccountRow | undefined}
                key={selected?.id ?? "new"}
              />
            ) : null}
          </div>
          {error ? (
            <div className="form-error" role="alert">
              {error}
            </div>
          ) : null}
        </form>
      </ResourceModal>
      <ResourceModal
        isOpen={detailOpen}
        onOpenChange={(open) => !open && closeAll()}
        title={selected?.name ?? labels.singular}
        description="资源详情"
      >
        {selected ? <ResourceDetails resource={resource} row={selected} /> : null}
        <div className="resource-detail-actions">
          <Button
            variant="secondary"
            onPress={() => selected && setModal({ selected: selected.id, mode: "edit" })}
          >
            <Pencil size={16} />
            编辑
          </Button>
          <Button variant="danger" onPress={() => selected && requestDelete(selected.id)}>
            <Trash2 size={16} />
            删除
          </Button>
        </div>
      </ResourceModal>
      <ResourceModal
        isOpen={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        size="compact"
        title={`删除${labels.singular}`}
        description={`将删除“${deleteTarget?.name ?? ""}”。此操作无法撤销。`}
        footer={
          <>
            <ModalCancelButton onPress={() => setDeleteTarget(null)} />
            <Button variant="danger" onPress={deleteResource} isDisabled={pending}>
              {pending ? "正在删除" : "确认删除"}
            </Button>
          </>
        }
      >
        <p className="confirm-copy">若资源仍被证书、自动化或部署目标引用，系统会阻止删除并保留现有配置。</p>
      </ResourceModal>
    </div>
  );
}

function CloudCredentialFields({ initial }: { initial?: CloudCredentialRow }) {
  const [provider, setProvider] = useState(initial?.provider ?? "aliyun");

  // Provider configuration
  const providerConfig: Record<string, { label: string; fields: Array<{ key: string; label: string; type: string; placeholder?: string; help?: string }> }> = {
    aliyun: {
      label: "阿里云 (Alibaba Cloud)",
      fields: [
        { key: "access_key_id", label: "AccessKey ID", type: "text", placeholder: "LTAI...", help: "阿里云访问密钥ID" },
        { key: "access_key_secret", label: "AccessKey Secret", type: "password", help: "阿里云访问密钥密文" },
      ],
    },
    aws: {
      label: "AWS (Amazon Web Services)",
      fields: [
        { key: "access_key_id", label: "Access Key ID", type: "text", placeholder: "AKIA...", help: "AWS访问密钥ID" },
        { key: "secret_access_key", label: "Secret Access Key", type: "password", help: "AWS秘密访问密钥" },
      ],
    },
    tencentcloud: {
      label: "腾讯云 (Tencent Cloud)",
      fields: [
        { key: "secret_id", label: "SecretId", type: "text", placeholder: "AKID...", help: "腾讯云密钥ID" },
        { key: "secret_key", label: "SecretKey", type: "password", help: "腾讯云密钥Key" },
      ],
    },
    huaweicloud: {
      label: "华为云 (Huawei Cloud)",
      fields: [
        { key: "access_key", label: "Access Key", type: "text", help: "华为云访问密钥" },
        { key: "secret_key", label: "Secret Key", type: "password", help: "华为云秘密密钥" },
      ],
    },
  };

  const currentConfig = providerConfig[provider];

  return (
    <>
      <div className="field field-wide">
        <label htmlFor="provider">云平台</label>
        <Select
          id="provider"
          name="provider"
          isDisabled={Boolean(initial)}
          defaultSelectedKey={provider}
          onSelectionChange={(key) => setProvider(String(key))}
        >
          <Select.Trigger>
            <Select.Value />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {Object.entries(providerConfig).map(([key, config]) => (
                <ListBox.Item key={key} id={key}>
                  {config.label}
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        {initial && (
          <span className="field-help">编辑时不可修改云平台类型</span>
        )}
      </div>

      {currentConfig.fields.map((field) => (
        <div key={field.key} className="field">
          <label htmlFor={field.key}>{field.label}</label>
          <Input
            id={field.key}
            name={`credentials.${field.key}`}
            type={field.type}
            placeholder={field.placeholder}
            required={!initial}
            autoComplete={field.type === "password" ? "new-password" : "off"}
          />
          {field.help && <span className="field-help">{field.help}</span>}
        </div>
      ))}
    </>
  );
}

function ACMEAccountFields({ initial }: { initial?: ACMEAccountRow }) {
  return (
    <>
      <div className="field field-wide">
        <label htmlFor="directoryUrl">ACME Directory URL</label>
        <Input
          id="directoryUrl"
          name="directoryUrl"
          type="url"
          defaultValue={initial?.directoryUrl ?? "https://acme-v02.api.letsencrypt.org/directory"}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="email">联系邮箱</label>
        <Input id="email" name="email" type="email" defaultValue={initial?.email ?? ""} required />
      </div>
      <div className="field">
        <label htmlFor="privateKeyAlgorithm">账户密钥算法</label>
        <Select id="privateKeyAlgorithm" name="privateKeyAlgorithm" defaultSelectedKey="ecdsa_p256">
          <Select.Trigger>
            <Select.Value />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="ecdsa_p256">ECDSA P-256</ListBox.Item>
              <ListBox.Item id="ecdsa_p384">ECDSA P-384</ListBox.Item>
              <ListBox.Item id="rsa_2048">RSA 2048</ListBox.Item>
              <ListBox.Item id="rsa_4096">RSA 4096</ListBox.Item>
            </ListBox>
          </Select.Popover>
        </Select>
      </div>
      <div className="field field-wide">
        <label htmlFor="privateKey">账户私钥 PEM（可选）</label>
        <TextArea id="privateKey" name="privateKey" autoComplete="off" />
        <span className="field-help">
          留空将按所选算法自动生成；仅在导入已有 ACME 账户时填写。私钥只会加密保存，创建后不再回显。
        </span>
      </div>
    </>
  );
}

function DNSAccountFields({
  cloudCredentials,
  initial,
}: {
  cloudCredentials: CloudCredentialRow[];
  initial?: DNSAccountRow;
}) {
  const [credentialId, setCredentialId] = useState(initial?.cloudCredentialId ?? "");
  const [zones, setZones] = useState<DNSZoneOption[]>([]);
  const [selectedZones, setSelectedZones] = useState<string[]>(initial?.allowedZones ?? []);
  const [loading, setLoading] = useState(Boolean(initial?.cloudCredentialId));
  const [zoneError, setZoneError] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!credentialId) return;

    fetch(`/api/cloud-credentials/${credentialId}/dns/zones`)
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as {
          data?: DNSZoneOption[];
          message?: string;
        } | null;
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

    return () => {
      cancelled = true;
    };
  }, [credentialId]);

  function toggleZone(zone: string, checked: boolean) {
    setSelectedZones((current) => (checked ? [...current, zone] : current.filter((item) => item !== zone)));
  }

  function handleCredentialChange(nextCredentialId: string) {
    setCredentialId(nextCredentialId);
    setZones([]);
    setSelectedZones([]);
    setZoneError("");
    setLoading(Boolean(nextCredentialId));
  }

  return (
    <>
      <div className="field field-wide">
        <label htmlFor="cloudCredentialId">云凭证</label>
        <Select
          id="cloudCredentialId"
          name="cloudCredentialId"
          selectedKey={credentialId || null}
          onSelectionChange={(key) => handleCredentialChange(String(key))}
          placeholder="选择已配置的阿里云凭证"
        >
          <Select.Trigger>
            <Select.Value />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {cloudCredentials.map((credential) => (
                <ListBox.Item id={credential.id} key={credential.id}>
                  {credential.name} ({credential.credentialHint})
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>
      <div className="field field-wide">
        <span id="allowedZonesLabel" className="field-label">
          允许管理的 Zone
        </span>
        <div className="zone-picker" role="group" aria-labelledby="allowedZonesLabel">
          {loading ? <span className="field-help">正在从阿里云获取 Zone...</span> : null}
          {!loading && !zoneError && !credentialId ? (
            <span className="field-help">先选择云凭证，再加载该凭证可管理的 Zone。</span>
          ) : null}
          {!loading && !zoneError && credentialId && zones.length === 0 ? (
            <span className="field-help">没有可选 Zone。请确认该凭证有 DNS 域名读取权限。</span>
          ) : null}
          {zones.map((zone) => (
            <Checkbox
              className="zone-option"
              isSelected={selectedZones.includes(zone.name)}
              key={zone.name}
              name="allowedZones"
              value={zone.name}
              onChange={(isSelected) => toggleZone(zone.name, isSelected)}
            >
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <span>{zone.name}</span>
              </Checkbox.Content>
            </Checkbox>
          ))}
        </div>
        {zoneError ? (
          <span className="field-help zone-error" role="alert">
            {zoneError}
          </span>
        ) : (
          <span className="field-help">
            从阿里云获取后多选 Zone。DNS-01 仅会在选中的 Zone 中创建 challenge TXT 记录。
          </span>
        )}
      </div>
    </>
  );
}

type DNSZoneOption = { name: string };

function ResourceDetails({
  resource,
  row,
}: {
  resource: Resource;
  row: CloudCredentialRow | ACMEAccountRow | DNSAccountRow;
}) {
  const details =
    resource === "cloud-credentials"
      ? [
          ["提供商", (row as CloudCredentialRow).provider],
          ["凭证摘要", (row as CloudCredentialRow).credentialHint],
          ["状态", (row as CloudCredentialRow).status],
        ]
      : resource === "acme-accounts"
        ? [
            ["联系邮箱", (row as ACMEAccountRow).email],
            ["Directory", (row as ACMEAccountRow).directoryUrl],
            ["状态", (row as ACMEAccountRow).status],
          ]
        : [
            ["提供商", (row as DNSAccountRow).provider],
            ["已授权 Zone", (row as DNSAccountRow).allowedZones.join(", ")],
            ["状态", (row as DNSAccountRow).status],
          ];

  return (
    <dl className="resource-details">
      {details.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ConfigurationTable({
  resource,
  rows,
  empty,
  onSelect,
  onEdit,
  onDelete,
}: {
  resource: Resource;
  rows: ConfigurationManagerProps["rows"];
  empty: string;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (rows.length === 0) return <ResourceEmptyState icon={KeyRound} title={empty} size="compact" />;

  if (resource === "cloud-credentials") {
    return (
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>提供商</th>
              <th>凭证摘要</th>
              <th>状态</th>
              <th aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {(rows as CloudCredentialRow[]).map((row) => (
              <tr key={row.id} className="interactive-row" onClick={() => onSelect(row.id)}>
                <td className="row-title">{row.name}</td>
                <td className="muted">{row.provider}</td>
                <td className="muted">{row.credentialHint}</td>
                <td>
                  <StatusTag status={row.status} />
                </td>
                <ResourceRowActions row={row} onEdit={onEdit} onDelete={onDelete} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (resource === "acme-accounts") {
    return (
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>联系邮箱</th>
              <th>Directory</th>
              <th>状态</th>
              <th aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {(rows as ACMEAccountRow[]).map((row) => (
              <tr key={row.id} className="interactive-row" onClick={() => onSelect(row.id)}>
                <td className="row-title">{row.name}</td>
                <td className="muted">{row.email}</td>
                <td className="domain-list">{row.directoryUrl}</td>
                <td>
                  <StatusTag status={row.status} />
                </td>
                <ResourceRowActions row={row} onEdit={onEdit} onDelete={onDelete} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>Zone</th>
            <th>提供商</th>
            <th>状态</th>
            <th aria-label="操作" />
          </tr>
        </thead>
        <tbody>
          {(rows as DNSAccountRow[]).map((row) => (
            <tr key={row.id} className="interactive-row" onClick={() => onSelect(row.id)}>
              <td className="row-title">{row.name}</td>
              <td className="domain-list">{row.allowedZones.join(", ")}</td>
              <td className="muted">{row.provider}</td>
              <td>
                <StatusTag status={row.status} />
              </td>
              <ResourceRowActions row={row} onEdit={onEdit} onDelete={onDelete} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResourceRowActions({
  row,
  onEdit,
  onDelete,
}: {
  row: { id: string; name: string };
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <td className="row-actions" onClick={(event) => event.stopPropagation()}>
      <Dropdown>
        <Dropdown.Trigger className="table-menu-trigger" aria-label={`操作 ${row.name}`}>
          <Ellipsis size={18} />
        </Dropdown.Trigger>
        <Dropdown.Popover placement="bottom end">
          <Dropdown.Menu
            onAction={(key) => {
              if (key === "edit") onEdit(row.id);
              if (key === "delete") onDelete(row.id);
            }}
          >
            <Dropdown.Item id="edit">
              <Pencil size={16} />
              编辑
            </Dropdown.Item>
            <Dropdown.Item id="delete" className="danger-menu-item">
              <Trash2 size={16} />
              删除
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </td>
  );
}
