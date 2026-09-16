"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, Input, ListBox, Select, Table, TextArea } from "@heroui/react";
import {
  CheckCircle2,
  CircleAlert,
  Copy,
  ExternalLink,
  FileKey2,
  History,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { ModalCancelButton, ResourceModal } from "@/components/ui/resource-modal";
import { ResourceEmptyState } from "@/components/ui/resource-empty-state";
import { ResourcePagination } from "@/components/ui/resource-pagination";
import { StatusTag } from "@/components/ui/status-tag";
import { TableActions } from "@/components/ui/table-actions";
import { apiRequest } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import type {
  ACMEAccount,
  Certificate,
  CertificateRelations,
  CertificateVersion,
  DNSAccount,
} from "@/lib/api";
import { formatDate } from "@/lib/presentation";
import { useLocale } from "@/components/providers/locale-provider";

type CertificateDetail = Certificate & {
  acmeAccountId: string;
  defaultDnsAccountId: string;
  renewBeforeDays: number;
};
type Challenge = { domain: string; fqdn: string; value: string };
type ManualChallenge = { certificateId: string; status: string; challenges: Challenge[] };
type ManualDNSCheck = { fqdn: string; expected: string; observed: string[]; matched: boolean; error: string };

export function CertificateList({
  certificates,
  acmeAccounts,
  dnsAccounts,
}: {
  certificates: Certificate[];
  acmeAccounts: ACMEAccount[];
  dnsAccounts: DNSAccount[];
}) {
  const router = useRouter();
  const { locale, t } = useLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("selected");
  const selected = certificates.find((certificate) => certificate.id === selectedId);
  const mode = searchParams.get("mode");
  const [detail, setDetail] = useState<{ id: string; value: CertificateDetail } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Certificate | null>(null);
  const [issueTarget, setIssueTarget] = useState<Certificate | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expiryFilter, setExpiryFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const visibleCertificates = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return certificates.filter((certificate) => {
      const matchesQuery =
        !normalized ||
        [
          certificate.name,
          ...certificate.domains,
          certificate.keyAlgorithm,
          certificate.validationMode,
          certificate.status,
          certificate.fingerprint,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalized);
      return (
        matchesQuery &&
        (statusFilter === "all" || certificate.status === statusFilter) &&
        matchesExpiry(certificate, expiryFilter)
      );
    });
  }, [certificates, expiryFilter, query, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(visibleCertificates.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const paginatedCertificates = visibleCertificates.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  function open(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("selected", id);
    params.set("mode", "view");
    router.replace(`${pathname}?${params}`, { scroll: false });
  }

  function openCreate() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("modal", "create");
    router.replace(`${pathname}?${params}`, { scroll: false });
  }

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    void apiRequest<CertificateDetail>(`/api/certificates/${selectedId}`)
      .then((value) => {
        if (active) setDetail({ id: selectedId, value });
      })
      .catch(() => {
        // The list projection remains a valid fallback when the detail request fails.
      });
    return () => {
      active = false;
    };
  }, [selectedId]);

  function close() {
    setError("");
    const params = new URLSearchParams(searchParams.toString());
    params.delete("selected");
    params.delete("mode");
    router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
  }

  return (
    <>
      <section className="certificate-section">
        <div className="certificate-actions">
          <div className="resource-operation-bar">
            <Button variant="tertiary" size="sm" onPress={() => router.refresh()}>
              <RefreshCw size={15} />
              {t("common.refresh")}
            </Button>
            <Button variant="primary" size="sm" onPress={openCreate}>
              <Plus size={15} />
              {t("certificate.create")}
            </Button>
          </div>
          <div className="resource-query-bar certificate-query-controls">
            <div className="resource-search">
              <Search size={15} aria-hidden="true" />
              <Input
                aria-label={t("common.search")}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder={t("certificate.searchPlaceholder")}
              />
            </div>
            <div className="certificate-filter-bar" aria-label={t("certificate.filters")}>
              <Select
                className="certificate-filter-select"
                selectedKey={statusFilter}
                onSelectionChange={(key) => {
                  setStatusFilter(String(key));
                  setPage(1);
                }}
                aria-label={t("certificate.statusFilter")}
              >
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="all">{t("certificate.allStatuses")}</ListBox.Item>
                    <ListBox.Item id="issued">{t("status.issued")}</ListBox.Item>
                    <ListBox.Item id="pending">{t("status.pending")}</ListBox.Item>
                    <ListBox.Item id="issuing">{t("status.issuing")}</ListBox.Item>
                    <ListBox.Item id="failed">{t("status.failed")}</ListBox.Item>
                    <ListBox.Item id="expired">{t("status.expired")}</ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
              <Select
                className="certificate-filter-select"
                selectedKey={expiryFilter}
                onSelectionChange={(key) => {
                  setExpiryFilter(String(key));
                  setPage(1);
                }}
                aria-label={t("certificate.expiryFilter")}
              >
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="all">{t("certificate.allValidity")}</ListBox.Item>
                    <ListBox.Item id="expired">{t("status.expired")}</ListBox.Item>
                    <ListBox.Item id="7">{t("certificate.expiring7")}</ListBox.Item>
                    <ListBox.Item id="30">{t("certificate.expiring30")}</ListBox.Item>
                    <ListBox.Item id="unissued">{t("certificate.unissued")}</ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>
          </div>
        </div>
        {error && !deleteTarget && !selected ? (
          <div className="form-error" role="alert">
            {error}
          </div>
        ) : null}
        <Table className="table-pinned-columns">
          <Table.ScrollContainer>
            <Table.Content aria-label={t("nav.certificates")} className="min-w-[1180px]">
              <Table.Header>
                <Table.Column isRowHeader>{t("common.name")}</Table.Column>
                <Table.Column>{t("certificate.domains")}</Table.Column>
                <Table.Column>{t("certificate.keyAlgorithm")}</Table.Column>
                <Table.Column>{t("certificate.validation")}</Table.Column>
                <Table.Column>{t("common.status")}</Table.Column>
                <Table.Column>{t("certificate.expiresAt")}</Table.Column>
                <Table.Column>{t("certificate.lastIssued")}</Table.Column>
                <Table.Column>{t("common.actions")}</Table.Column>
              </Table.Header>
              <Table.Body>
                {paginatedCertificates.map((certificate) => (
                  <Table.Row key={certificate.id}>
                    <Table.Cell>{certificate.name}</Table.Cell>
                    <Table.Cell>
                      <span className="domain-list" title={certificate.domains.join(", ")}>
                        {certificate.domains.join(", ")}
                      </span>
                    </Table.Cell>
                    <Table.Cell>{certificate.keyAlgorithm}</Table.Cell>
                    <Table.Cell>
                      {certificate.validationMode === "manual"
                        ? t("certificate.validationManualShort")
                        : t("certificate.validationAutoShort")}
                    </Table.Cell>
                    <Table.Cell>
                      <div className="table-status-stack">
                        <StatusTag status={certificate.status} />
                        {certificate.lastError ? (
                          <span className="table-error">{certificate.lastError}</span>
                        ) : null}
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="certificate-expiry">
                        <span>
                          {certificate.notAfter
                            ? formatDate(certificate.notAfter, locale)
                            : t("dashboard.pendingIssuance")}
                        </span>
                        {certificate.notAfter ? (
                          <small className={expiryTone(certificate.notAfter)}>
                            {expiryLabel(certificate.notAfter, t)}
                          </small>
                        ) : null}
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      {certificate.lastIssuedAt
                        ? formatDate(certificate.lastIssuedAt, locale)
                        : t("certificate.noLastIssued")}
                    </Table.Cell>
                    <Table.Cell>
                      <TableActions
                        actions={[
                          { id: "details", label: t("common.details"), onPress: () => open(certificate.id) },
                          ...(certificate.validationMode === "manual"
                            ? [
                                {
                                  id: "manual",
                                  label: t("certificate.manualValidation"),
                                  onPress: () => openManual(certificate.id),
                                },
                              ]
                            : []),
                          {
                            id: "edit",
                            label: t("dns.editAction"),
                            onPress: () => openMode(certificate.id, "edit"),
                          },
                          {
                            id: "issue",
                            label:
                              certificate.status === "failed" ? t("common.retry") : t("certificate.reissue"),
                            onPress: () => {
                              setError("");
                              setIssueTarget(certificate);
                            },
                            isDisabled: isIssuanceInProgress(certificate.status),
                          },
                          {
                            id: "delete",
                            label: t("dns.deleteAction"),
                            onPress: () => {
                              setError("");
                              setDeleteTarget(certificate);
                            },
                            tone: "danger",
                          },
                        ]}
                      />
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
        {visibleCertificates.length > 0 ? (
          <ResourcePagination
            page={currentPage}
            pageCount={pageCount}
            total={visibleCertificates.length}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(nextPageSize) => {
              setPageSize(nextPageSize);
              setPage(1);
            }}
          />
        ) : null}
        {certificates.length === 0 ? (
          <ResourceEmptyState
            icon={FileKey2}
            title={t("certificate.empty")}
            description={t("certificate.emptyDescription")}
            primaryAction={{ label: t("certificate.create"), icon: Plus, onPress: openCreate }}
          />
        ) : null}
        {certificates.length > 0 && visibleCertificates.length === 0 ? (
          <ResourceEmptyState
            icon={Search}
            title={t("certificate.noResults")}
            description={t("certificate.noResultsDescription")}
            primaryAction={{
              label: t("execution.clearFilters"),
              onPress: () => {
                setQuery("");
                setStatusFilter("all");
                setExpiryFilter("all");
                setPage(1);
              },
            }}
            variant="filtered"
          />
        ) : null}
      </section>
      <ResourceModal
        isOpen={Boolean(selected)}
        onOpenChange={(isOpen) => !isOpen && close()}
        title={
          mode === "manual-validation"
            ? "手动 DNS 验证"
            : mode === "edit"
              ? `编辑${selected?.name ?? "证书"}`
              : (selected?.name ?? "证书详情")
        }
        description={
          mode === "manual-validation"
            ? "添加 TXT 记录并确认生效后继续签发"
            : mode === "edit"
              ? "调整证书配置后保存，敏感信息不会回显"
              : "查看证书身份、验证方式和签发状态"
        }
        footer={
          mode === "edit" ? (
            <>
              <ModalCancelButton onPress={close} />
              <Button form="certificate-edit-form" type="submit" variant="primary" isDisabled={pending}>
                {pending ? "正在保存" : "保存修改"}
              </Button>
            </>
          ) : null
        }
      >
        {selected && mode === "edit" ? (
          detail?.id === selected.id ? (
            <CertificateEditPanel
              key={detail.value.id}
              certificate={detail.value}
              acmeAccounts={acmeAccounts}
              dnsAccounts={dnsAccounts}
              onSubmit={saveEdit}
              error={error}
            />
          ) : (
            <div className="empty-state">正在加载证书配置。</div>
          )
        ) : null}
        {selected && mode !== "manual-validation" && mode !== "edit" ? (
          <CertificateOverview
            key={selected.id}
            certificate={detail?.id === selected.id ? detail.value : selected}
          />
        ) : null}
        {selected && mode !== "manual-validation" && selected.validationMode === "manual" ? (
          <div className="resource-detail-actions">
            <Button variant="primary" onPress={() => openManual(selected.id)}>
              <ExternalLink size={16} />
              打开手动验证
            </Button>
          </div>
        ) : null}
        {selected && mode === "view" ? (
          <div className="resource-detail-actions">
            <Button
              variant="primary"
              isDisabled={isIssuanceInProgress(selected.status)}
              onPress={() => {
                setError("");
                setIssueTarget(selected);
              }}
            >
              <RefreshCw size={16} />
              {selected.status === "failed" ? "重试签发" : "立即重新签发"}
            </Button>
            <Button variant="secondary" onPress={() => openMode(selected.id, "edit")}>
              <Pencil size={16} />
              编辑
            </Button>
            <Button
              variant="danger"
              onPress={() => {
                setError("");
                setDeleteTarget(selected);
              }}
            >
              <Trash2 size={16} />
              删除
            </Button>
          </div>
        ) : null}
        {selected && mode === "manual-validation" ? (
          <ManualValidationPanel certificateId={selected.id} />
        ) : null}
      </ResourceModal>
      <ResourceModal
        isOpen={Boolean(issueTarget)}
        onOpenChange={(isOpen) => !isOpen && setIssueTarget(null)}
        size="compact"
        title={issueTarget?.status === "failed" ? "重试签发证书" : "立即重新签发"}
        description={`将以当前配置签发“${issueTarget?.name ?? ""}”的新版本。`}
        footer={
          <>
            <ModalCancelButton onPress={() => setIssueTarget(null)} />
            <Button variant="primary" onPress={issueCertificate} isDisabled={pending}>
              <RefreshCw size={16} />
              {pending ? "正在排队" : "确认签发"}
            </Button>
          </>
        }
      >
        <p className="confirm-copy">
          签发成功后会替换当前证书版本，并触发该证书已启用的上传 SSL 与 ALB 部署自动化。
        </p>
        {error ? (
          <div className="form-error" role="alert">
            {error}
          </div>
        ) : null}
      </ResourceModal>
      <ResourceModal
        isOpen={Boolean(deleteTarget)}
        onOpenChange={(isOpen) => !isOpen && setDeleteTarget(null)}
        size="compact"
        title="删除证书"
        description={`将删除“${deleteTarget?.name ?? ""}”。此操作无法撤销。`}
        footer={
          <>
            <ModalCancelButton onPress={() => setDeleteTarget(null)} />
            <Button variant="danger" onPress={deleteCertificate} isDisabled={pending}>
              {pending ? "正在删除" : "确认删除"}
            </Button>
          </>
        }
      >
        <p className="confirm-copy">如果证书仍被自动化任务或部署目标引用，系统会阻止删除并保留现有配置。</p>
        {error ? (
          <div className="form-error" role="alert">
            {error}
          </div>
        ) : null}
      </ResourceModal>
    </>
  );

  function openManual(id: string) {
    openMode(id, "manual-validation");
  }

  function openMode(id: string, nextMode: "view" | "edit" | "manual-validation") {
    const params = new URLSearchParams(searchParams.toString());
    params.set("selected", id);
    params.set("mode", nextMode);
    setError("");
    router.replace(`${pathname}?${params}`, { scroll: false });
  }

  async function saveEdit(payload: CertificateEditPayload) {
    if (!selected) return;
    setPending(true);
    setError("");
    try {
      await apiRequest(`/api/certificates/${selected.id}`, { method: "PATCH", body: payload });
      setPending(false);
      setIssueTarget(selected);
      close();
      router.refresh();
    } catch (cause) {
      setPending(false);
      setError(cause instanceof Error ? cause.message : "无法保存证书");
    }
  }

  async function deleteCertificate() {
    if (!deleteTarget) return;
    setPending(true);
    setError("");
    try {
      await apiRequest(`/api/certificates/${deleteTarget.id}`, { method: "DELETE" });
      setPending(false);
      setDeleteTarget(null);
      if (selectedId === deleteTarget.id) close();
      router.refresh();
    } catch (cause) {
      setPending(false);
      setError(
        cause instanceof ApiError && cause.status === 409
          ? "该证书仍被自动化或部署配置引用，无法删除。"
          : cause instanceof Error
            ? cause.message
            : "无法删除证书",
      );
    }
  }

  async function issueCertificate() {
    if (!issueTarget) return;
    setPending(true);
    setError("");
    try {
      await apiRequest(`/api/certificates/${issueTarget.id}/issue`, { method: "POST" });
      setIssueTarget(null);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 409
          ? "该证书已有正在进行的签发或续期任务。"
          : cause instanceof Error
            ? cause.message
            : "无法发起签发任务",
      );
    } finally {
      setPending(false);
    }
  }
}

type CertificateEditPayload = {
  name: string;
  acmeAccountId: string;
  defaultDnsAccountId: string;
  validationMode: string;
  domains: string[];
  keyAlgorithm: string;
  renewBeforeDays: number;
};

function CertificateEditPanel({
  certificate,
  acmeAccounts,
  dnsAccounts,
  onSubmit,
  error,
}: {
  certificate: CertificateDetail;
  acmeAccounts: ACMEAccount[];
  dnsAccounts: DNSAccount[];
  onSubmit: (payload: CertificateEditPayload) => void;
  error: string;
}) {
  const [name, setName] = useState(certificate.name);
  const [domainsText, setDomainsText] = useState(certificate.domains.join("\n"));
  const [keyAlgorithm, setKeyAlgorithm] = useState(certificate.keyAlgorithm);
  const [acmeAccountId, setAcmeAccountId] = useState(certificate.acmeAccountId);
  const [dnsAccountId, setDnsAccountId] = useState(certificate.defaultDnsAccountId);
  const [validationMode, setValidationMode] = useState(certificate.validationMode);
  const [renewBeforeDays, setRenewBeforeDays] = useState(String(certificate.renewBeforeDays || 30));
  const [validationError, setValidationError] = useState("");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const domains = domainsText
      .split(/[\n,]/)
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean);
    if (!name.trim()) return setValidationError("请输入证书名称");
    if (domains.length === 0) return setValidationError("至少填写一个域名");
    const domainError = validateDomains(domains);
    if (domainError) return setValidationError(domainError);
    if (!acmeAccountId) return setValidationError("请选择 ACME 账户");
    if (validationMode === "auto" && !dnsAccountId)
      return setValidationError("自动 DNS 模式需要选择 DNS 账户");
    setValidationError("");
    onSubmit({
      name: name.trim(),
      domains,
      keyAlgorithm,
      acmeAccountId,
      defaultDnsAccountId: validationMode === "auto" ? dnsAccountId : "",
      validationMode,
      renewBeforeDays: Number(renewBeforeDays) || 30,
    });
  }

  return (
    <form id="certificate-edit-form" className="drawer-form" onSubmit={submit}>
      <div className="field-grid">
        <div className="field field-wide">
          <label htmlFor="certificate-edit-name">名称</label>
          <Input
            id="certificate-edit-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </div>
        <div className="field field-wide">
          <label htmlFor="certificate-edit-domains">域名与 SAN</label>
          <TextArea
            id="certificate-edit-domains"
            value={domainsText}
            onChange={(event) => setDomainsText(event.target.value)}
            required
          />
          <span className="field-help">
            每行一个域名。通配符只覆盖一层子域，三级域名需要单独添加对应通配符。
          </span>
        </div>
        <div className="field">
          <label>密钥算法</label>
          <Select
            selectedKey={keyAlgorithm}
            onSelectionChange={(key) => setKeyAlgorithm(String(key))}
            aria-label="密钥算法"
          >
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
        <div className="field">
          <label>提前续期天数</label>
          <Input
            type="number"
            min={1}
            max={90}
            value={renewBeforeDays}
            onChange={(event) => setRenewBeforeDays(event.target.value)}
          />
        </div>
        <div className="field">
          <label>ACME 账户</label>
          <Select
            selectedKey={acmeAccountId || null}
            onSelectionChange={(key) => setAcmeAccountId(String(key))}
            aria-label="ACME 账户"
          >
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {acmeAccounts.map((account) => (
                  <ListBox.Item id={account.id} key={account.id}>
                    {account.name}
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>
        <div className="field">
          <label>DNS 账户</label>
          <Select
            selectedKey={dnsAccountId || null}
            isDisabled={validationMode === "manual"}
            onSelectionChange={(key) => setDnsAccountId(String(key))}
            aria-label="DNS 账户"
          >
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {dnsAccounts.map((account) => (
                  <ListBox.Item id={account.id} key={account.id}>
                    {account.name}
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>
        <div className="field field-wide">
          <label>DNS-01 验证方式</label>
          <Select
            selectedKey={validationMode}
            onSelectionChange={(key) => setValidationMode(String(key))}
            aria-label="DNS-01 验证方式"
          >
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="auto">自动更新 DNS TXT</ListBox.Item>
                <ListBox.Item id="manual">手动添加 DNS TXT</ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
        </div>
      </div>
      {validationError || error ? (
        <div className="form-error" role="alert">
          {validationError || error}
        </div>
      ) : null}
    </form>
  );
}

function ManualValidationPanel({ certificateId }: { certificateId: string }) {
  const [challenge, setChallenge] = useState<ManualChallenge | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [checkingDNS, setCheckingDNS] = useState(false);
  const [checks, setChecks] = useState<ManualDNSCheck[] | null>(null);

  useEffect(() => {
    void apiRequest<ManualChallenge>(`/api/certificates/${certificateId}/manual-challenge`)
      .then(setChallenge)
      .catch((cause: Error) => setError(cause.message));
  }, [certificateId]);

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
  }

  async function copyAll() {
    if (!challenge) return;
    await copy(challenge.challenges.map((item) => `${item.fqdn}\tTXT\t${item.value}`).join("\n"));
  }

  async function continueValidation() {
    setPending(true);
    setError("");
    try {
      await apiRequest(`/api/certificates/${certificateId}/manual-challenge/continue`, { method: "POST" });
      setChallenge((current) => (current ? { ...current, status: "approved" } : current));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法继续验证");
    } finally {
      setPending(false);
    }
  }

  async function checkDNS() {
    setCheckingDNS(true);
    setError("");
    try {
      const response = await apiRequest<{ data: ManualDNSCheck[] }>(
        `/api/certificates/${certificateId}/manual-challenge/check`,
      );
      setChecks(response.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法检查 DNS 解析");
    } finally {
      setCheckingDNS(false);
    }
  }

  if (error)
    return (
      <div className="form-error" role="alert">
        {error}
      </div>
    );
  if (!challenge) return <div className="empty-state">正在加载验证记录。</div>;
  return (
    <div className="manual-validation">
      <div className="manual-validation-header">
        <div>
          <h2>待验证记录</h2>
          <p>状态：{challenge.status === "waiting_user" ? "等待 DNS 生效" : "已提交验证"}</p>
        </div>
        <Button variant="secondary" onPress={copyAll}>
          <Copy size={16} />
          复制全部 TXT
        </Button>
      </div>
      <Table className="table-pinned-columns">
        <Table.ScrollContainer>
          <Table.Content aria-label="手动 DNS TXT 验证记录" className="min-w-[720px]">
            <Table.Header>
              <Table.Column isRowHeader>域名</Table.Column>
              <Table.Column>记录名</Table.Column>
              <Table.Column>TXT 值</Table.Column>
              <Table.Column>操作</Table.Column>
            </Table.Header>
            <Table.Body>
              {challenge.challenges.map((item) => (
                <Table.Row key={`${item.fqdn}-${item.value}`}>
                  <Table.Cell>{item.domain}</Table.Cell>
                  <Table.Cell>
                    <code className="dns-value">{item.fqdn}</code>
                  </Table.Cell>
                  <Table.Cell>
                    <code className="dns-value">{item.value}</code>
                  </Table.Cell>
                  <Table.Cell>
                    <TableActions
                      actions={[{ id: "copy", label: "复制", onPress: () => copy(item.value) }]}
                    />
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
      <div className="manual-validation-check">
        <Button variant="secondary" isDisabled={checkingDNS} onPress={checkDNS}>
          <CircleAlert size={16} />
          {checkingDNS ? "正在检查" : "检查 DNS 解析"}
        </Button>
        {checks ? (
          <div className="manual-dns-check-results">
            {checks.map((item) => (
              <div
                className={item.matched ? "manual-dns-check-ok" : "manual-dns-check-pending"}
                key={`${item.fqdn}-${item.expected}`}
              >
                <strong>{item.fqdn}</strong>
                <span>
                  {item.matched
                    ? "已解析到预期 TXT 值"
                    : item.error
                      ? "暂时无法查询到 TXT 记录"
                      : "尚未解析到预期 TXT 值"}
                </span>
              </div>
            ))}
            <p>
              该检查使用 CertFlow 所在服务器的 DNS resolver；公网递归 DNS 与 ACME
              的实际验证结果可能存在传播延迟。
            </p>
          </div>
        ) : null}
      </div>
      {challenge.status === "waiting_user" ? (
        <div className="form-actions">
          <Button variant="primary" isDisabled={pending} onPress={continueValidation}>
            <CheckCircle2 size={17} />
            {pending ? "正在提交" : "TXT 已生效，继续验证"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function CertificateOverview({ certificate }: { certificate: Certificate }) {
  const { locale, t } = useLocale();
  const [versions, setVersions] = useState<CertificateVersion[] | null>(null);
  const [relations, setRelations] = useState<CertificateRelations | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.all([
      apiRequest<{ data: CertificateVersion[] }>(`/api/certificates/${certificate.id}/versions`),
      apiRequest<CertificateRelations>(`/api/certificates/${certificate.id}/relations`),
    ])
      .then(([versionResponse, relationResponse]) => {
        if (!active) return;
        setVersions(versionResponse.data);
        setRelations(relationResponse);
      })
      .catch((cause: Error) => {
        if (active) setLoadError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [certificate.id]);

  return (
    <div className="certificate-detail">
      <dl className="resource-details">
        <div>
          <dt>状态</dt>
          <dd>
            <StatusTag status={certificate.status} />
          </dd>
        </div>
        <div>
          <dt>密钥算法</dt>
          <dd>{certificate.keyAlgorithm}</dd>
        </div>
        <div>
          <dt>验证方式</dt>
          <dd>{certificate.validationMode === "manual" ? "手动 DNS TXT" : "自动 DNS"}</dd>
        </div>
        <div>
          <dt>到期时间</dt>
          <dd>
            {certificate.notAfter ? (
              <>
                <span>{formatDate(certificate.notAfter, locale)}</span>
                <small className={expiryTone(certificate.notAfter)}>
                  {expiryLabel(certificate.notAfter, t)}
                </small>
              </>
            ) : (
              "待签发"
            )}
          </dd>
        </div>
        <div className="certificate-detail-wide">
          <dt>SAN 与通配符域名</dt>
          <dd>
            <ul className="certificate-domain-list">
              {certificate.domains.map((domain) => (
                <li key={domain}>
                  <code>{domain}</code>
                  <span>{domain.startsWith("*.") ? "覆盖一层子域" : "精确域名"}</span>
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div className="certificate-detail-wide">
          <dt>SHA-256 指纹</dt>
          <dd className="dns-value">{certificate.fingerprint || "签发后生成"}</dd>
        </div>
        <div>
          <dt>最近签发</dt>
          <dd>{certificate.lastIssuedAt ? formatDate(certificate.lastIssuedAt) : "暂无"}</dd>
        </div>
        <div>
          <dt>创建时间</dt>
          <dd>{formatDate(certificate.createdAt)}</dd>
        </div>
      </dl>
      {certificate.lastError ? (
        <div className="form-error" role="alert">
          {certificate.lastError}
        </div>
      ) : null}
      {loadError ? (
        <div className="form-error" role="alert">
          无法加载版本与关联资源：{loadError}
        </div>
      ) : null}
      <CertificateVersionHistory versions={versions} />
      <CertificateRelationSummary relations={relations} />
    </div>
  );
}

function CertificateVersionHistory({ versions }: { versions: CertificateVersion[] | null }) {
  return (
    <section className="certificate-subsection" aria-labelledby="certificate-version-heading">
      <div className="certificate-subsection-heading">
        <History size={17} aria-hidden="true" />
        <div>
          <h2 id="certificate-version-heading">版本历史</h2>
          <p>仅展示版本元数据，私钥与证书内容不会在页面回显。</p>
        </div>
      </div>
      {versions === null ? (
        <div className="certificate-inline-loading">正在加载版本历史。</div>
      ) : versions.length === 0 ? (
        <div className="certificate-inline-empty">尚无已签发版本。</div>
      ) : (
        <Table>
          <Table.ScrollContainer>
            <Table.Content aria-label="证书版本历史" className="min-w-[680px]">
              <Table.Header>
                <Table.Column isRowHeader>版本</Table.Column>
                <Table.Column>有效期</Table.Column>
                <Table.Column>签发时间</Table.Column>
                <Table.Column>状态</Table.Column>
              </Table.Header>
              <Table.Body>
                {versions.map((version) => (
                  <Table.Row key={version.id}>
                    <Table.Cell>
                      <div className="version-cell">
                        <strong>{version.isCurrent ? "当前版本" : "历史版本"}</strong>
                        <code>{version.serialNumber || version.fingerprint || version.id}</code>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      {formatDate(version.notBefore)} 至 {formatDate(version.notAfter)}
                    </Table.Cell>
                    <Table.Cell>{formatDate(version.issuedAt)}</Table.Cell>
                    <Table.Cell>
                      {version.revokedAt ? (
                        <StatusTag status="revoked" />
                      ) : version.isCurrent ? (
                        <StatusTag status="issued" />
                      ) : (
                        <span className="muted">已归档</span>
                      )}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      )}
    </section>
  );
}

function CertificateRelationSummary({ relations }: { relations: CertificateRelations | null }) {
  return (
    <section className="certificate-subsection" aria-labelledby="certificate-relations-heading">
      <div className="certificate-subsection-heading">
        <div>
          <h2 id="certificate-relations-heading">关联资源</h2>
          <p>证书重新签发成功后，已启用的自动化会按其配置继续执行。</p>
        </div>
      </div>
      {relations === null ? (
        <div className="certificate-inline-loading">正在加载关联资源。</div>
      ) : (
        <div className="certificate-relations-grid">
          <RelationCard title="ACME 账户" resource={relations.acmeAccount} empty="未找到关联账户" />
          <RelationCard title="DNS 账户" resource={relations.dnsAccount} empty="手动验证或未配置 DNS 账户" />
          <RelationCard
            title="自动化任务"
            count={relations.automations.length}
            detail={
              relations.automations.length
                ? relations.automations
                    .map((item) => `${item.name}（${automationActionLabel(item.actionType)}）`)
                    .join("、")
                : "尚未配置"
            }
          />
          <RelationCard
            title="部署目标"
            count={relations.deployments.length}
            detail={
              relations.deployments.length
                ? relations.deployments.map((item) => item.targetName).join("、")
                : "尚未配置"
            }
          />
        </div>
      )}
    </section>
  );
}

function RelationCard({
  title,
  resource,
  empty,
  count,
  detail,
}: {
  title: string;
  resource?: { name: string; status: string } | null;
  empty?: string;
  count?: number;
  detail?: string;
}) {
  return (
    <div className="certificate-relation-card">
      <span>{title}</span>
      <strong>{resource ? resource.name : count === undefined ? empty : `${count} 个`}</strong>
      <small>{resource ? resource.status : detail}</small>
    </div>
  );
}

function automationActionLabel(action: CertificateRelations["automations"][number]["actionType"]) {
  return action === "renew_certificate" ? "定期续期" : action === "upload_ssl" ? "上传 SSL" : "更新 ALB";
}

function isIssuanceInProgress(status: string) {
  return ["pending", "issuing", "renewing"].includes(status);
}

function matchesExpiry(certificate: Certificate, filter: string) {
  if (filter === "all") return true;
  if (!certificate.notAfter) return filter === "unissued";
  const remaining = Math.ceil((new Date(certificate.notAfter).getTime() - Date.now()) / 86_400_000);
  if (filter === "expired") return remaining < 0;
  if (filter === "7") return remaining >= 0 && remaining <= 7;
  if (filter === "30") return remaining >= 0 && remaining <= 30;
  return false;
}

function expiryLabel(value: string, t: ReturnType<typeof useLocale>["t"]) {
  const remaining = Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
  if (remaining < 0) return t("certificate.expiredDays", { days: Math.abs(remaining) });
  if (remaining === 0) return t("certificate.expiresToday");
  return t("certificate.daysRemaining", { days: remaining });
}

function expiryTone(value: string) {
  const remaining = Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
  if (remaining < 0) return "certificate-expiry-danger";
  if (remaining <= 7) return "certificate-expiry-warning";
  return "certificate-expiry-neutral";
}

function validateDomains(domains: string[]) {
  const unique = new Set<string>();
  const wildcards = new Map<string, string>();
  for (const domain of domains) {
    if (unique.has(domain)) return `域名重复：${domain}`;
    unique.add(domain);
    if (
      domain.length > 253 ||
      !/^(\*\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)
    ) {
      return `域名格式无效：${domain}`;
    }
    if (domain.startsWith("*.")) wildcards.set(domain.slice(2), domain);
  }
  for (const domain of domains) {
    if (domain.startsWith("*.")) continue;
    const [, ...parentLabels] = domain.split(".");
    const wildcard = wildcards.get(parentLabels.join("."));
    if (wildcard) return `域名 ${domain} 已被 ${wildcard} 覆盖，请移除精确域名`;
  }
  return "";
}
