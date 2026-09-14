"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Checkbox,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  Surface,
  Table,
  TextArea,
  TextField,
} from "@heroui/react";
import { Cable, CheckCheck, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import type { CloudCredential, DNSAccount } from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { apiRequest } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/presentation";
import { StatusTag } from "@/components/status-tag";
import { useLocale } from "@/components/locale-provider";
import { ResourcePagination } from "@/components/resource-pagination";
import { ResourceEmptyState } from "@/components/resource-empty-state";
import { TableActions } from "@/components/table-actions";

type DNSAccountDraft = {
  name: string;
  description: string;
  cloudCredentialId: string;
  allowedZones: string[];
};

type DNSZoneOption = { name: string };

export function DNSAccountManager({
  accounts,
  cloudCredentials,
  unavailable = false,
}: {
  accounts: DNSAccount[];
  cloudCredentials: CloudCredential[];
  unavailable?: boolean;
}) {
  const router = useRouter();
  const { t } = useLocale();
  const [formTarget, setFormTarget] = useState<DNSAccount | "create" | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<DNSAccount | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DNSAccount | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [verificationTarget, setVerificationTarget] = useState<DNSAccount | null>(null);
  const [page, setPage] = useState(1);

  const credentialNames = new Map(cloudCredentials.map((credential) => [credential.id, credential.name]));
  const credentialByID = new Map(cloudCredentials.map((credential) => [credential.id, credential]));
  const visibleAccounts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return accounts;
    return accounts.filter((account) =>
      [account.name, account.description, account.provider, account.cloudCredentialId, ...account.allowedZones]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [accounts, query]);
  const [pageSize, setPageSize] = useState(10);
  const pageCount = Math.max(1, Math.ceil(visibleAccounts.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const paginatedAccounts = visibleAccounts.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const isEditing = formTarget !== null && formTarget !== "create";

  function openCreate() {
    setError("");
    setFormTarget("create");
  }

  function closeForm() {
    setError("");
    setFormTarget(null);
  }

  async function saveAccount(draft: DNSAccountDraft) {
    if (!formTarget) return;
    if (!draft.name.trim()) {
      setError(t("dns.nameRequired"));
      return;
    }
    if (!draft.cloudCredentialId) {
      setError(t("dns.credentialRequired"));
      return;
    }
    if (draft.allowedZones.length === 0) {
      setError(t("dns.zoneRequired"));
      return;
    }

    setPending(true);
    setError("");
    try {
      await apiRequest(isEditing ? `/api/dns-accounts/${formTarget.id}` : "/api/dns-accounts", {
        method: isEditing ? "PATCH" : "POST",
        body: {
          name: draft.name.trim(),
          description: draft.description.trim(),
          cloudCredentialId: draft.cloudCredentialId,
          allowedZones: draft.allowedZones,
        },
      });
      closeForm();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("dns.saveFailed"));
    } finally {
      setPending(false);
    }
  }

  async function deleteAccount() {
    if (!deleteTarget) return;
    setPending(true);
    setError("");
    try {
      await apiRequest(`/api/dns-accounts/${deleteTarget.id}`, { method: "DELETE" });
      setDeleteTarget(null);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 409
          ? deleteImpactMessage(cause)
          : cause instanceof Error
            ? cause.message
            : t("dns.deleteFailed"),
      );
    } finally {
      setPending(false);
    }
  }

  async function verifyAccount(account: DNSAccount) {
    setPending(true);
    setError("");
    setVerificationTarget(account);
    try {
      await apiRequest(`/api/dns-accounts/${account.id}/verify`, { method: "POST" });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("dns.verifyFailed"));
    } finally {
      setPending(false);
      setVerificationTarget(null);
    }
  }

  async function toggleAccount(account: DNSAccount) {
    const action = account.status === "disabled" ? "enable" : "disable";
    setPending(true);
    setError("");
    try {
      await apiRequest(`/api/dns-accounts/${account.id}/${action}`, { method: "POST" });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("dns.statusUpdateFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="dns-account-section">
      <div className="dns-account-actions">
        <div className="resource-operation-bar">
          <Button variant="tertiary" size="sm" onPress={() => router.refresh()}><RefreshCw size={15} />{t("common.refresh")}</Button>
          <Button variant="primary" size="sm" onPress={openCreate}><Plus size={15} />{t("dns.create")}</Button>
        </div>
        <div className="resource-query-bar"><div className="resource-search">
          <Search size={15} aria-hidden="true" />
          <Input aria-label={t("common.search")} value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={t("dns.searchPlaceholder")} />
        </div></div>
      </div>
      {unavailable ? (
        <div className="api-warning" role="alert">
          <span>{t("common.apiUnavailable")}</span>
          <Button variant="tertiary" size="sm" onPress={() => router.refresh()}>{t("common.retry")}</Button>
        </div>
      ) : null}
      {error && !formTarget && !deleteTarget ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      <Table className="table-pinned-columns">
        <Table.ScrollContainer>
          <Table.Content aria-label={t("dns.tableLabel")} className="min-w-[1160px]">
            <Table.Header>
              <Table.Column isRowHeader>{t("common.name")}</Table.Column>
              <Table.Column>{t("common.description")}</Table.Column>
              <Table.Column>{t("dns.credential")}</Table.Column>
              <Table.Column>{t("dns.allowedZones")}</Table.Column>
              <Table.Column>{t("common.status")}</Table.Column>
              <Table.Column>{t("dns.lastVerified")}</Table.Column>
              <Table.Column>{t("common.createdAt")}</Table.Column>
              <Table.Column>{t("common.actions")}</Table.Column>
            </Table.Header>
            <Table.Body>
              {paginatedAccounts.map((account) => (
                <Table.Row key={account.id}>
                  <Table.Cell>{account.name}</Table.Cell>
                  <Table.Cell>{account.description || "-"}</Table.Cell>
                  <Table.Cell>{credentialNames.get(account.cloudCredentialId) ?? account.cloudCredentialId}</Table.Cell>
                  <Table.Cell>
                    <span className="domain-list" title={account.allowedZones.join(", ")}>
                      {account.allowedZones.join(", ") || t("dns.unconfigured")}
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="table-status-stack">
                      <StatusTag status={account.status} />
                      {account.lastError ? <span className="table-error">{account.lastError}</span> : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell>{account.lastVerifiedAt ? formatDateTime(account.lastVerifiedAt) : t("dns.notVerified")}</Table.Cell>
                  <Table.Cell>{formatDate(account.createdAt)}</Table.Cell>
                  <Table.Cell>
                    <TableActions
                      actions={[
                        { id: "details", label: t("dns.details"), onPress: () => setDetailsTarget(account) },
                        { id: "verify", label: t("common.verify"), pendingLabel: t("dns.verifying"), onPress: () => void verifyAccount(account), isDisabled: pending, isPending: verificationTarget?.id === account.id },
                        { id: "toggle", label: account.status === "disabled" ? t("common.enable") : t("common.disable"), onPress: () => void toggleAccount(account), isDisabled: pending },
                        { id: "edit", label: t("dns.editAction"), onPress: () => { setError(""); setFormTarget(account); } },
                        { id: "delete", label: t("dns.deleteAction"), onPress: () => { setError(""); setDeleteTarget(account); }, tone: "danger" },
                      ]}
                    />
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
      {visibleAccounts.length > 0 ? (
        <ResourcePagination
          page={currentPage}
          pageCount={pageCount}
          total={visibleAccounts.length}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(nextPageSize) => {
            setPageSize(nextPageSize);
            setPage(1);
          }}
        />
      ) : null}
      {accounts.length === 0 ? (
        <ResourceEmptyState
          icon={Cable}
          title={t("dns.empty")}
          description="配置并验证 DNS 账户后，可自动创建 ACME 域名验证记录。"
          primaryAction={{ label: t("dns.create"), icon: Plus, onPress: openCreate }}
        />
      ) : null}
      {accounts.length > 0 && visibleAccounts.length === 0 ? (
        <ResourceEmptyState
          icon={Search}
          title={t("common.noResults")}
          description="试试调整名称、Zone 或云凭证关键词。"
          primaryAction={{ label: "清除搜索", onPress: () => { setQuery(""); setPage(1); } }}
          variant="filtered"
        />
      ) : null}

      <DNSAccountFormModal
        key={formTarget === "create" ? "create" : (formTarget?.id ?? "closed")}
        account={isEditing ? formTarget : undefined}
        cloudCredentials={cloudCredentials}
        isOpen={Boolean(formTarget)}
        pending={pending}
        error={error}
        onClose={closeForm}
        onSubmit={saveAccount}
      />
      <DeleteDNSAccountModal
        account={deleteTarget}
        pending={pending}
        error={error}
        onClose={() => {
          setError("");
          setDeleteTarget(null);
        }}
        onConfirm={deleteAccount}
      />
      <DNSAccountDetailsModal
        account={detailsTarget}
        cloudCredential={detailsTarget ? credentialByID.get(detailsTarget.cloudCredentialId) : undefined}
        onClose={() => setDetailsTarget(null)}
      />
    </section>
  );
}

function DNSAccountFormModal({
  account,
  cloudCredentials,
  isOpen,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  account?: DNSAccount;
  cloudCredentials: CloudCredential[];
  isOpen: boolean;
  pending: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (draft: DNSAccountDraft) => void;
}) {
  const editing = Boolean(account);
  const { t } = useLocale();
  const [credentialId, setCredentialId] = useState(account?.cloudCredentialId ?? "");
  const [zones, setZones] = useState<DNSZoneOption[]>([]);
  const [selectedZones, setSelectedZones] = useState<string[]>(account?.allowedZones ?? []);
  const [loading, setLoading] = useState(Boolean(account?.cloudCredentialId));
  const [zoneError, setZoneError] = useState("");
  const [zoneQuery, setZoneQuery] = useState("");
  const [zonesFetchedAt, setZonesFetchedAt] = useState<string | null>(null);
  const selectableCredentials = cloudCredentials.filter(
    (credential) => credential.status === "active" || credential.id === account?.cloudCredentialId,
  );
  const filteredZones = zones.filter((zone) => zone.name.toLowerCase().includes(zoneQuery.trim().toLowerCase()));
  const hasZoneOverlap = selectedZones.some((zone, index) =>
    selectedZones.some((other, otherIndex) => index !== otherIndex && (zone.endsWith(`.${other}`) || other.endsWith(`.${zone}`))),
  );

  useEffect(() => {
    let cancelled = false;
    if (!credentialId) {
      return;
    }
    fetch(`/api/cloud-credentials/${credentialId}/dns/zones`)
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { data?: DNSZoneOption[]; message?: string } | null;
        if (!response.ok) throw new Error(body?.message ?? t("dns.loadZonesFailed"));
        return body;
      })
      .then((body) => {
        if (!cancelled) {
          const available = body?.data ?? [];
          setZones(available);
          setZonesFetchedAt(new Date().toISOString());
          setSelectedZones((current) => current.filter((zone) => available.some((item) => item.name === zone)));
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setZoneError(cause instanceof Error ? cause.message : t("dns.loadZonesFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [credentialId, t]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit({
      name: String(form.get("name") ?? ""),
      description: String(form.get("description") ?? ""),
      cloudCredentialId: credentialId,
      allowedZones: selectedZones,
    });
  }

  function changeCredential(next: string) {
    setCredentialId(next);
    setZones([]);
    setSelectedZones([]);
    setZoneError("");
    setLoading(Boolean(next));
    setZonesFetchedAt(null);
  }

  function selectAllZones() {
    setSelectedZones((current) => Array.from(new Set([...current, ...filteredZones.map((zone) => zone.name)])));
  }

  function clearVisibleZones() {
    setSelectedZones((current) => current.filter((zone) => !filteredZones.some((item) => item.name === zone)));
  }

  function toggleZone(zone: string, selected: boolean) {
    setSelectedZones((current) => (selected ? [...new Set([...current, zone])] : current.filter((item) => item !== zone)));
  }

  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Modal.Backdrop>
        <Modal.Container placement="auto" scroll="inside" size="lg">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label={t("dns.close")} />
            <Modal.Header>
              <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
                <Cable className="size-5" />
              </Modal.Icon>
            <Modal.Heading>{editing ? t("dns.edit") : t("dns.create")}</Modal.Heading>
            <p className="mt-1.5 text-sm leading-5 text-muted">
                {t("dns.formDescription")}
              </p>
            </Modal.Header>
            <Modal.Body className="p-6">
              <Surface variant="default">
                <form id="dns-account-form" className="flex flex-col gap-4" onSubmit={submit}>
                  <TextField className="w-full" name="name" defaultValue={account?.name ?? ""} isRequired>
                    <Label>{t("common.name")}</Label>
                    <Input placeholder={t("dns.namePlaceholder")} autoComplete="off" />
                  </TextField>
                  <TextField className="w-full" name="description" defaultValue={account?.description ?? ""}>
                    <Label>{t("common.description")}</Label>
                    <TextArea placeholder={t("dns.descriptionPlaceholder")} maxLength={240} rows={3} />
                  </TextField>
                  <div className="cloud-provider-field">
                    <Label>{t("dns.credential")}</Label>
                    <Select
                      selectedKey={credentialId || null}
                      onSelectionChange={(key) => changeCredential(String(key))}
                      isRequired
                      aria-label={t("dns.selectCredential")}
                    >
                      <Select.Trigger>
                        <Select.Value />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {selectableCredentials.map((credential) => (
                            <ListBox.Item id={credential.id} key={credential.id}>
                              {credential.name} ({credential.accessKeyId || credential.credentialHint})
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    {selectableCredentials.length === 0 ? (
                      <span className="field-help zone-error">{t("dns.noCredential")}</span>
                    ) : null}
                  </div>
                  <div className="field field-wide">
                    <span id="dns-allowed-zones-label" className="field-label">
                      {t("dns.allowedZones")}
                    </span>
                    <div className="zone-picker" role="group" aria-labelledby="dns-allowed-zones-label">
                      {loading ? <span className="field-help">{t("dns.loadingZones")}</span> : null}
                      {!loading && !zoneError && !credentialId ? (
                        <span className="field-help">{t("dns.selectCredentialHint")}</span>
                      ) : null}
                      {!loading && !zoneError && credentialId && zones.length === 0 ? (
                        <span className="field-help">{t("dns.noZones")}</span>
                      ) : null}
                      {!loading && zones.length > 0 ? (
                        <div className="zone-picker-toolbar">
                          <TextField className="zone-search" aria-label={t("dns.searchZone")}>
                            <Label className="sr-only">{t("dns.searchZone")}</Label>
                            <Input value={zoneQuery} onChange={(event) => setZoneQuery(event.target.value)} placeholder={t("dns.searchZone")} />
                          </TextField>
                          <Button variant="tertiary" size="sm" onPress={selectAllZones}><CheckCheck size={14} />{t("dns.selectAll")}</Button>
                          <Button variant="tertiary" size="sm" onPress={clearVisibleZones}>{t("dns.clearSelection")}</Button>
                          <Button variant="tertiary" size="sm" onPress={() => changeCredential(credentialId)}><RefreshCw size={14} />{t("common.refresh")}</Button>
                        </div>
                      ) : null}
                      {filteredZones.map((zone) => (
                        <Checkbox
                          className="zone-option"
                          isSelected={selectedZones.includes(zone.name)}
                          key={zone.name}
                          onChange={(selected) => toggleZone(zone.name, selected)}
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
                      <>
                        <span className="field-help">
                          {t("dns.zoneHint")} · {formatMessage(t("dns.selectedCount"), { count: selectedZones.length })}
                          {zonesFetchedAt ? ` · ${formatDateTime(zonesFetchedAt)}` : ""}
                        </span>
                        {hasZoneOverlap ? <span className="field-help zone-warning">{t("dns.zoneOverlap")}</span> : null}
                      </>
                    )}
                  </div>
                  {error ? (
                    <div className="form-error" role="alert">
                      {error}
                    </div>
                  ) : null}
                </form>
              </Surface>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onPress={onClose}>
                {t("dns.cancel")}
              </Button>
              <Button form="dns-account-form" type="submit" isDisabled={pending || loading}>
                {pending ? t("dns.saving") : t("dns.save")}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function DeleteDNSAccountModal({
  account,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  account: DNSAccount | null;
  pending: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useLocale();
  return (
    <Modal isOpen={Boolean(account)} onOpenChange={(open) => !open && onClose()}>
      <Modal.Backdrop>
        <Modal.Container placement="auto">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label={t("dns.close")} />
            <Modal.Header>
              <Modal.Icon className="bg-danger-soft text-danger-soft-foreground">
                <Trash2 className="size-5" />
              </Modal.Icon>
              <Modal.Heading>{t("dns.deleteTitle")}</Modal.Heading>
              <p className="mt-1.5 text-sm leading-5 text-muted">{formatMessage(t("dns.deleteDescription"), { name: account?.name ?? "" })}</p>
            </Modal.Header>
            <Modal.Body className="p-6">
              <p className="text-sm leading-5 text-muted">{t("dns.deleteHint")}</p>
              {error ? (
                <div className="form-error mt-4" role="alert">
                  {error}
                </div>
              ) : null}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onPress={onClose}>
                {t("dns.cancel")}
              </Button>
              <Button variant="danger" onPress={onConfirm} isDisabled={pending}>
                {pending ? t("dns.deleting") : t("dns.confirmDelete")}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function DNSAccountDetailsModal({
  account,
  cloudCredential,
  onClose,
}: {
  account: DNSAccount | null;
  cloudCredential?: CloudCredential;
  onClose: () => void;
}) {
  const { t } = useLocale();
  return (
    <Modal isOpen={Boolean(account)} onOpenChange={(open) => !open && onClose()}>
      <Modal.Backdrop>
        <Modal.Container placement="auto" scroll="inside" size="lg">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label={t("dns.close")} />
            <Modal.Header>
              <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
                <Cable className="size-5" />
              </Modal.Icon>
              <Modal.Heading>{account?.name ?? t("dns.detailTitle")}</Modal.Heading>
              <p className="mt-1.5 text-sm leading-5 text-muted">{t("dns.detailDescription")}</p>
            </Modal.Header>
            <Modal.Body className="p-6">
              {account ? (
                <Surface variant="default">
                  <div className="flex flex-col gap-4">
                    <TextField className="w-full" value={account.name} isReadOnly>
                      <Label>{t("common.name")}</Label>
                      <Input />
                    </TextField>
                    <TextField
                      className="w-full"
                      value={cloudCredential ? `${cloudCredential.name} (${cloudCredential.accessKeyId || cloudCredential.credentialHint})` : account.cloudCredentialId}
                      isReadOnly
                    >
                      <Label>{t("dns.credential")}</Label>
                      <Input />
                    </TextField>
                    <TextField className="w-full" value={account.provider} isReadOnly>
                      <Label>{t("dns.provider")}</Label>
                      <Input />
                    </TextField>
                    <TextField className="w-full" value={account.allowedZones.join(", ") || t("dns.unconfigured")} isReadOnly>
                      <Label>{t("dns.allowedZones")}</Label>
                      <TextArea rows={3} />
                    </TextField>
                    <TextField className="w-full" value={statusLabel(account.status)} isReadOnly>
                      <Label>{t("common.status")}</Label>
                      <Input />
                    </TextField>
                    <TextField
                      className="w-full"
                      value={account.lastVerifiedAt ? formatDateTime(account.lastVerifiedAt) : t("dns.notVerified")}
                      isReadOnly
                    >
                      <Label>{t("dns.lastVerified")}</Label>
                      <Input />
                    </TextField>
                    <TextField className="w-full" value={formatDate(account.createdAt)} isReadOnly>
                      <Label>{t("common.createdAt")}</Label>
                      <Input />
                    </TextField>
                    <TextField className="w-full" value={account.description || "-"} isReadOnly>
                      <Label>{t("common.description")}</Label>
                      <Input />
                    </TextField>
                    <TextField className="w-full" value={account.lastError || "-"} isReadOnly>
                      <Label>{t("dns.lastError")}</Label>
                      <Input />
                    </TextField>
                    <TextField className="w-full" value={account.verifiedCredentialVersionId || "-"} isReadOnly>
                      <Label>已验证凭证版本</Label>
                      <Input />
                    </TextField>
                  </div>
                </Surface>
              ) : null}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onPress={onClose}>
                {t("dns.close")}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function statusLabel(status: string) {
  return { active: "正常", disabled: "已禁用", invalid: "验证失败" }[status] ?? status;
}

function formatMessage(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce((message, [key, value]) => message.replaceAll(`{${key}}`, String(value)), template);
}

function deleteImpactMessage(error: ApiError) {
  const count = typeof error.details.referenceCount === "number" ? error.details.referenceCount : undefined;
  if (count === undefined) return error.message;
  return `${error.message}（当前有 ${count} 项关联引用）`;
}
