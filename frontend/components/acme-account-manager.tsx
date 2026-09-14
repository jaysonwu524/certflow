"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
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
import { KeyRound, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { ApiError } from "@/lib/api-error";
import { apiRequest } from "@/lib/api-client";
import { StatusTag } from "@/components/status-tag";
import { ResourceEmptyState } from "@/components/resource-empty-state";
import type { ACMEAccount } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/presentation";
import { ResourcePagination } from "@/components/resource-pagination";
import { TableActions } from "@/components/table-actions";

type ACMEAccountDraft = {
  name: string;
  directoryUrl: string;
  email: string;
  privateKeyAlgorithm: string;
  privateKey: string;
};

const keyAlgorithms = [
  { id: "ecdsa_p256", label: "ECDSA P-256" },
  { id: "ecdsa_p384", label: "ECDSA P-384" },
  { id: "rsa_2048", label: "RSA 2048" },
  { id: "rsa_4096", label: "RSA 4096" },
] as const;

export function ACMEAccountManager({ accounts }: { accounts: ACMEAccount[] }) {
  const router = useRouter();
  const [formTarget, setFormTarget] = useState<ACMEAccount | "create" | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<ACMEAccount | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ACMEAccount | null>(null);
  const [pending, setPending] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const isEditing = formTarget !== null && formTarget !== "create";
  const visibleAccounts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return accounts;
    return accounts.filter((account) =>
      [
        account.name,
        account.email,
        account.directoryUrl,
        account.privateKeyAlgorithm,
        account.status,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [accounts, query]);
  const [pageSize, setPageSize] = useState(10);
  const pageCount = Math.max(1, Math.ceil(visibleAccounts.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const paginatedAccounts = visibleAccounts.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function openCreate() {
    setError("");
    setFormTarget("create");
  }

  function closeForm() {
    setError("");
    setFormTarget(null);
  }

  async function saveAccount(draft: ACMEAccountDraft) {
    if (!formTarget) return;
    if (!draft.name.trim()) {
      setError("请输入 ACME 账户名称");
      return;
    }
    if (!draft.directoryUrl.trim()) {
      setError("请输入 ACME Directory URL");
      return;
    }
    if (!draft.email.trim()) {
      setError("请输入联系邮箱");
      return;
    }
    if (!isEditing && !draft.privateKey.trim()) {
      setError("请输入账户私钥 PEM");
      return;
    }

    setPending(true);
    setError("");
    const payload = {
      name: draft.name.trim(),
      directoryUrl: draft.directoryUrl.trim(),
      email: draft.email.trim(),
      privateKeyAlgorithm: draft.privateKeyAlgorithm,
      ...(draft.privateKey.trim() ? { privateKey: draft.privateKey.trim() } : {}),
    };
    try {
      await apiRequest(isEditing ? `/api/acme-accounts/${formTarget.id}` : "/api/acme-accounts", {
        method: isEditing ? "PATCH" : "POST",
        body: payload,
      });
      setPending(false);
      closeForm();
      router.refresh();
    } catch (cause) {
      setPending(false);
      setError(cause instanceof Error ? cause.message : "无法保存 ACME 账户");
    }
  }

  async function deleteAccount() {
    if (!deleteTarget) return;
    setPending(true);
    setError("");
    try {
      await apiRequest(`/api/acme-accounts/${deleteTarget.id}`, { method: "DELETE" });
      setPending(false);
      setDeleteTarget(null);
      router.refresh();
    } catch (cause) {
      setPending(false);
      setError(
        cause instanceof ApiError && cause.status === 409
          ? "该 ACME 账户仍被证书引用，请先解除关联后再删除。"
          : cause instanceof Error
            ? cause.message
            : "无法删除 ACME 账户",
      );
    }
  }

  async function verifyAccount(account: ACMEAccount) {
    setPending(true);
    setVerifyingId(account.id);
    setError("");
    try {
      await apiRequest(`/api/acme-accounts/${account.id}/verify`, { method: "POST" });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ACME 账户验证失败");
    } finally {
      setPending(false);
      setVerifyingId(null);
    }
  }

  return (
    <section className="acme-account-section">
      <div className="acme-account-actions">
        <div className="resource-operation-bar">
          <Button variant="tertiary" size="sm" onPress={() => router.refresh()}><RefreshCw size={15} />刷新</Button>
          <Button variant="primary" size="sm" onPress={openCreate}>
            <Plus size={15} />
            新建 ACME 账户
          </Button>
        </div>
        <div className="resource-query-bar"><div className="resource-search">
          <Search size={15} aria-hidden="true" />
          <Input aria-label="搜索 ACME 账户" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索名称、邮箱或 Directory" />
        </div></div>
      </div>
      {error && !formTarget && !deleteTarget ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      <Table className="table-pinned-columns">
        <Table.ScrollContainer>
          <Table.Content aria-label="ACME 账户" className="min-w-[980px]">
            <Table.Header>
              <Table.Column isRowHeader>名称</Table.Column>
              <Table.Column>联系邮箱</Table.Column>
              <Table.Column>Directory</Table.Column>
              <Table.Column>密钥算法</Table.Column>
              <Table.Column>状态</Table.Column>
              <Table.Column>最近验证</Table.Column>
              <Table.Column>创建时间</Table.Column>
              <Table.Column>操作</Table.Column>
            </Table.Header>
            <Table.Body>
              {paginatedAccounts.map((account) => (
                <Table.Row key={account.id}>
                  <Table.Cell>{account.name}</Table.Cell>
                  <Table.Cell>{account.email}</Table.Cell>
                  <Table.Cell>{account.directoryUrl}</Table.Cell>
                  <Table.Cell>{algorithmLabel(account.privateKeyAlgorithm)}</Table.Cell>
                  <Table.Cell>
                    <StatusTag status={account.status} />
                  </Table.Cell>
                  <Table.Cell>
                    <span title={account.lastError || undefined}>
                      {account.lastError
                        ? "失败"
                        : account.lastVerifiedAt
                          ? formatDateTime(account.lastVerifiedAt)
                          : "未验证"}
                    </span>
                  </Table.Cell>
                  <Table.Cell>{formatDate(account.createdAt)}</Table.Cell>
                  <Table.Cell>
                    <TableActions
                      actions={[
                        { id: "details", label: "详情", onPress: () => setDetailsTarget(account) },
                        { id: "verify", label: "验证", pendingLabel: "验证中", onPress: () => void verifyAccount(account), isDisabled: pending, isPending: verifyingId === account.id },
                        { id: "edit", label: "编辑", onPress: () => { setError(""); setFormTarget(account); } },
                        { id: "delete", label: "删除", onPress: () => { setError(""); setDeleteTarget(account); }, tone: "danger" },
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
          icon={KeyRound}
          title="尚未配置 ACME 账户"
          description="添加账户后，即可通过 ACME 服务签发和续期证书。"
          primaryAction={{ label: "新建 ACME 账户", icon: Plus, onPress: openCreate }}
        />
      ) : null}
      {accounts.length > 0 && visibleAccounts.length === 0 ? (
        <ResourceEmptyState
          icon={Search}
          title="没有匹配的 ACME 账户"
          description="试试调整名称、邮箱或 Directory URL 关键词。"
          primaryAction={{ label: "清除搜索", onPress: () => { setQuery(""); setPage(1); } }}
          variant="filtered"
        />
      ) : null}

      <ACMEAccountFormModal
        key={formTarget === "create" ? "create" : (formTarget?.id ?? "closed")}
        account={isEditing ? formTarget : undefined}
        isOpen={Boolean(formTarget)}
        pending={pending}
        error={error}
        onClose={closeForm}
        onSubmit={saveAccount}
      />
      <DeleteACMEAccountModal
        account={deleteTarget}
        pending={pending}
        error={error}
        onClose={() => {
          setError("");
          setDeleteTarget(null);
        }}
        onConfirm={deleteAccount}
      />
      <ACMEAccountDetailsModal account={detailsTarget} onClose={() => setDetailsTarget(null)} />
    </section>
  );
}

function ACMEAccountFormModal({
  account,
  isOpen,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  account?: ACMEAccount;
  isOpen: boolean;
  pending: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (draft: ACMEAccountDraft) => void;
}) {
  const editing = Boolean(account);
  const [algorithm, setAlgorithm] = useState(account?.privateKeyAlgorithm ?? "ecdsa_p256");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit({
      name: String(form.get("name") ?? ""),
      directoryUrl: String(form.get("directoryUrl") ?? ""),
      email: String(form.get("email") ?? ""),
      privateKeyAlgorithm: algorithm,
      privateKey: String(form.get("privateKey") ?? ""),
    });
  }

  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Modal.Backdrop>
        <Modal.Container placement="auto" scroll="inside" size="lg">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label="关闭" />
            <Modal.Header>
              <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
                <KeyRound className="size-5" />
              </Modal.Icon>
              <Modal.Heading>{editing ? "编辑 ACME 账户" : "新建 ACME 账户"}</Modal.Heading>
              <p className="mt-1.5 text-sm leading-5 text-muted">
                {editing
                  ? "账户私钥不会回显；填写新的 PEM 可轮换账户密钥。"
                  : "账户私钥会加密保存，之后不会再以明文显示。"}
              </p>
            </Modal.Header>
            <Modal.Body className="p-6">
              <Surface variant="default">
                <form id="acme-account-form" className="flex flex-col gap-4" onSubmit={submit}>
                  <TextField className="w-full" name="name" defaultValue={account?.name ?? ""} isRequired>
                    <Label>名称</Label>
                    <Input placeholder="例如：Let's Encrypt 生产账户" autoComplete="off" />
                  </TextField>
                  <TextField
                    className="w-full"
                    name="directoryUrl"
                    type="url"
                    defaultValue={account?.directoryUrl ?? "https://acme-v02.api.letsencrypt.org/directory"}
                    isRequired
                  >
                    <Label>ACME Directory URL</Label>
                    <Input placeholder="https://acme-v02.api.letsencrypt.org/directory" autoComplete="url" />
                  </TextField>
                  <TextField
                    className="w-full"
                    name="email"
                    type="email"
                    defaultValue={account?.email ?? ""}
                    isRequired
                  >
                    <Label>联系邮箱</Label>
                    <Input placeholder="用于 ACME 账户通知" autoComplete="email" />
                  </TextField>
                  <div className="cloud-provider-field">
                    <Label>账户密钥算法</Label>
                    <Select
                      selectedKey={algorithm}
                      isRequired
                      onSelectionChange={(key) => setAlgorithm(String(key))}
                      aria-label="账户密钥算法"
                    >
                      <Select.Trigger>
                        <Select.Value />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {keyAlgorithms.map((item) => (
                            <ListBox.Item id={item.id} key={item.id}>
                              {item.label}
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>
                  <TextField className="w-full" name="privateKey" type="text" isRequired={!editing}>
                    <Label>账户私钥 PEM{editing ? "（可选）" : ""}</Label>
                    <TextArea
                      placeholder={editing ? "留空表示保留当前账户私钥" : "粘贴 ACME 账户私钥 PEM"}
                      autoComplete="off"
                      rows={7}
                    />
                  </TextField>
                  <p className="field-help">
                    私钥只用于 ACME 账户认证，创建或轮换后不会回显。创建时必须填写
                    PEM；编辑时留空即可保留现有私钥。
                  </p>
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
                取消
              </Button>
              <Button form="acme-account-form" type="submit" isDisabled={pending}>
                {pending ? "正在保存" : "保存"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function DeleteACMEAccountModal({
  account,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  account: ACMEAccount | null;
  pending: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal isOpen={Boolean(account)} onOpenChange={(open) => !open && onClose()}>
      <Modal.Backdrop>
        <Modal.Container placement="auto">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label="关闭" />
            <Modal.Header>
              <Modal.Icon className="bg-danger-soft text-danger-soft-foreground">
                <Trash2 className="size-5" />
              </Modal.Icon>
              <Modal.Heading>删除 ACME 账户</Modal.Heading>
              <p className="mt-1.5 text-sm leading-5 text-muted">
                将删除“{account?.name ?? ""}”。此操作无法撤销。
              </p>
            </Modal.Header>
            <Modal.Body className="p-6">
              <p className="text-sm leading-5 text-muted">
                若账户仍被证书引用，系统会阻止删除，请先解除关联。
              </p>
              {account && (account.certificateCount > 0 || account.automationCount > 0) ? (
                <div className="resource-warning mt-4" role="status">
                  当前关联 {account.certificateCount} 个证书、{account.automationCount} 个自动化任务。
                </div>
              ) : (
                <p className="field-help mt-4">当前没有检测到证书或自动化任务关联。</p>
              )}
              {error ? (
                <div className="form-error mt-4" role="alert">
                  {error}
                </div>
              ) : null}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onPress={onClose}>
                取消
              </Button>
              <Button variant="danger" onPress={onConfirm} isDisabled={pending}>
                {pending ? "正在删除" : "确认删除"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function ACMEAccountDetailsModal({ account, onClose }: { account: ACMEAccount | null; onClose: () => void }) {
  return (
    <Modal isOpen={Boolean(account)} onOpenChange={(open) => !open && onClose()}>
      <Modal.Backdrop>
        <Modal.Container placement="auto" scroll="inside" size="lg">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label="关闭" />
            <Modal.Header>
              <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
                <KeyRound className="size-5" />
              </Modal.Icon>
              <Modal.Heading>{account?.name ?? "ACME 账户详情"}</Modal.Heading>
              <p className="mt-1.5 text-sm leading-5 text-muted">查看账户连接信息和当前状态。</p>
            </Modal.Header>
            <Modal.Body className="p-6">
              {account ? (
                <Surface variant="default">
                  <div className="flex flex-col gap-4">
                    <TextField className="w-full" value={account.name} isReadOnly>
                      <Label>名称</Label>
                      <Input />
                    </TextField>
                    <TextField className="w-full" value={account.directoryUrl} isReadOnly>
                      <Label>ACME Directory URL</Label>
                      <Input />
                    </TextField>
                    <TextField className="w-full" value={account.accountUrl || "未注册"} isReadOnly>
                      <Label>ACME 账户 URL</Label>
                      <Input />
                    </TextField>
                    <TextField className="w-full" value={account.email} isReadOnly>
                      <Label>联系邮箱</Label>
                      <Input />
                    </TextField>
                    <TextField
                      className="w-full"
                      value={algorithmLabel(account.privateKeyAlgorithm)}
                      isReadOnly
                    >
                      <Label>账户密钥算法</Label>
                      <Input />
                    </TextField>
                    <TextField className="w-full" value={statusLabel(account.status)} isReadOnly>
                      <Label>状态</Label>
                      <Input />
                    </TextField>
                    <TextField className="w-full" value={formatDate(account.createdAt)} isReadOnly>
                      <Label>创建时间</Label>
                      <Input />
                    </TextField>
                    <TextField
                      className="w-full"
                      value={account.lastVerifiedAt ? formatDateTime(account.lastVerifiedAt) : "未验证"}
                      isReadOnly
                    >
                      <Label>最近验证</Label>
                      <Input />
                    </TextField>
                    <TextField className="w-full" value={`${account.certificateCount} 个`} isReadOnly>
                      <Label>关联证书</Label>
                      <Input />
                    </TextField>
                    <TextField className="w-full" value={`${account.automationCount} 个`} isReadOnly>
                      <Label>关联自动化任务</Label>
                      <Input />
                    </TextField>
                    {account.lastError ? (
                      <p className="form-error" role="alert">
                        最近验证失败：{account.lastError}
                      </p>
                    ) : null}
                    <p className="field-help">账户私钥已加密保存，不会在详情或 API 中回显。</p>
                  </div>
                </Surface>
              ) : null}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onPress={onClose}>
                关闭
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function statusLabel(status: string) {
  return { active: "正常", disabled: "已禁用", error: "错误" }[status] ?? status;
}

function algorithmLabel(algorithm: string) {
  return keyAlgorithms.find((item) => item.id === algorithm)?.label ?? algorithm;
}
