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
import { StatusTag } from "@/components/ui/status-tag";
import { ResourceEmptyState } from "@/components/ui/resource-empty-state";
import type { CloudCredential } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/presentation";
import { ResourcePagination } from "@/components/ui/resource-pagination";
import { TableActions } from "@/components/ui/table-actions";

type CredentialDraft = {
  name: string;
  description: string;
  provider: string;
  accessKeyId: string;
  accessKeySecret: string;
};

const availableProviders = [{ id: "aliyun", label: "阿里云" }] as const;

export function CloudCredentialManager({ credentials }: { credentials: CloudCredential[] }) {
  const router = useRouter();
  const [formTarget, setFormTarget] = useState<CloudCredential | "create" | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<CloudCredential | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CloudCredential | null>(null);
  const [pending, setPending] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const isEditing = formTarget !== null && formTarget !== "create";
  const visibleCredentials = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return credentials;
    return credentials.filter((credential) =>
      [
        credential.name,
        credential.description,
        credential.provider,
        credential.accessKeyId,
        credential.credentialHint,
        credential.status,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [credentials, query]);
  const [pageSize, setPageSize] = useState(10);
  const pageCount = Math.max(1, Math.ceil(visibleCredentials.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const paginatedCredentials = visibleCredentials.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function openCreate() {
    setError("");
    setFormTarget("create");
  }

  function closeForm() {
    setError("");
    setFormTarget(null);
  }

  async function saveCredential(draft: CredentialDraft) {
    if (!formTarget) return;
    const isRotating = Boolean(draft.accessKeyId || draft.accessKeySecret);
    if (!draft.name.trim()) {
      setError("请输入云凭证名称");
      return;
    }
    if (!draft.provider) {
      setError("请选择云平台");
      return;
    }
    if (!isEditing && !isRotating) {
      setError("请输入 AccessKey ID 和 AccessKey Secret");
      return;
    }
    if (isRotating && (!draft.accessKeyId || !draft.accessKeySecret)) {
      setError("更新访问密钥时，必须同时填写 AccessKey ID 和 AccessKey Secret");
      return;
    }

    setPending(true);
    setError("");
    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      provider: draft.provider,
      credentials: isRotating
        ? { access_key_id: draft.accessKeyId, access_key_secret: draft.accessKeySecret }
        : {},
    };
    try {
      await apiRequest(isEditing ? `/api/cloud-credentials/${formTarget.id}` : "/api/cloud-credentials", {
        method: isEditing ? "PATCH" : "POST",
        body: payload,
      });
      setPending(false);
      closeForm();
      router.refresh();
    } catch (cause) {
      setPending(false);
      setError(cause instanceof Error ? cause.message : "无法保存云凭证");
    }
  }

  async function deleteCredential() {
    if (!deleteTarget) return;
    setPending(true);
    setError("");
    try {
      await apiRequest(`/api/cloud-credentials/${deleteTarget.id}`, { method: "DELETE" });
      setPending(false);
      setDeleteTarget(null);
      router.refresh();
    } catch (cause) {
      setPending(false);
      setError(
        cause instanceof ApiError && cause.status === 409
          ? "该云凭证仍被 DNS 账户、自动化或部署目标引用，无法删除。"
          : cause instanceof Error
            ? cause.message
            : "无法删除云凭证",
      );
    }
  }

  async function verifyCredential(credential: CloudCredential) {
    setPending(true);
    setVerifyingId(credential.id);
    setError("");
    try {
      await apiRequest(`/api/cloud-credentials/${credential.id}/verify`, { method: "POST" });
      router.refresh();
    } catch (cause) {
      setPending(false);
      setError(cause instanceof Error ? cause.message : "凭证验证失败");
    } finally {
      setPending(false);
      setVerifyingId(null);
    }
  }

  async function toggleCredential(credential: CloudCredential) {
    const nextStatus = credential.status === "disabled" ? "enable" : "disable";
    setPending(true);
    setError("");
    try {
      await apiRequest(`/api/cloud-credentials/${credential.id}/${nextStatus}`, { method: "POST" });
      setPending(false);
      router.refresh();
    } catch (cause) {
      setPending(false);
      setError(cause instanceof Error ? cause.message : "无法更新凭证状态");
    }
  }

  return (
    <section className="cloud-credential-section">
      <div className="cloud-credential-actions">
        <div className="resource-operation-bar">
          <Button variant="tertiary" size="sm" onPress={() => router.refresh()}><RefreshCw size={15} />刷新</Button>
          <Button variant="primary" size="sm" onPress={openCreate}><Plus size={15} />新建云凭证</Button>
        </div>
        <div className="resource-query-bar"><div className="resource-search">
          <Search size={15} aria-hidden="true" />
          <Input aria-label="搜索云凭证" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索名称、描述或 AccessKey ID" />
        </div></div>
      </div>
      {error && !formTarget && !deleteTarget ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      <Table className="table-pinned-columns">
        <Table.ScrollContainer>
          <Table.Content aria-label="云凭证" className="min-w-[820px]">
            <Table.Header>
              <Table.Column isRowHeader>名称</Table.Column>
              <Table.Column>描述</Table.Column>
              <Table.Column>云平台</Table.Column>
              <Table.Column>AccessKey ID</Table.Column>
              <Table.Column>凭证摘要</Table.Column>
              <Table.Column>状态</Table.Column>
              <Table.Column>操作</Table.Column>
            </Table.Header>
            <Table.Body>
              {paginatedCredentials.map((credential) => (
                <Table.Row key={credential.id}>
                  <Table.Cell>{credential.name}</Table.Cell>
                  <Table.Cell>{credential.description || "-"}</Table.Cell>
                  <Table.Cell>{providerLabel(credential.provider)}</Table.Cell>
                  <Table.Cell>{credential.accessKeyId || "未记录"}</Table.Cell>
                  <Table.Cell>{credential.credentialHint}</Table.Cell>
                  <Table.Cell>
                    <StatusTag status={credential.status} />
                  </Table.Cell>
                  <Table.Cell>
                    <TableActions
                      actions={[
                        { id: "details", label: "详情", onPress: () => setDetailsTarget(credential) },
                        { id: "verify", label: "验证", pendingLabel: "验证中", onPress: () => void verifyCredential(credential), isDisabled: pending, isPending: verifyingId === credential.id },
                        { id: "toggle", label: credential.status === "disabled" ? "启用" : "禁用", onPress: () => void toggleCredential(credential), isDisabled: pending },
                        { id: "edit", label: "编辑", onPress: () => { setError(""); setFormTarget(credential); } },
                        { id: "delete", label: "删除", onPress: () => { setError(""); setDeleteTarget(credential); }, tone: "danger" },
                      ]}
                    />
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
      {visibleCredentials.length > 0 ? (
        <ResourcePagination
          page={currentPage}
          pageCount={pageCount}
          total={visibleCredentials.length}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(nextPageSize) => {
            setPageSize(nextPageSize);
            setPage(1);
          }}
        />
      ) : null}
      {credentials.length === 0 ? (
        <ResourceEmptyState
          icon={KeyRound}
          title="尚未配置云凭证"
          description="添加并验证云凭证后，才能管理 DNS、SSL 证书和 ALB 资源。"
          primaryAction={{ label: "新建云凭证", icon: Plus, onPress: openCreate }}
        />
      ) : null}
      {credentials.length > 0 && visibleCredentials.length === 0 ? (
        <ResourceEmptyState
          icon={Search}
          title="没有匹配的云凭证"
          description="试试调整名称、描述或 AccessKey ID 关键词。"
          primaryAction={{ label: "清除搜索", onPress: () => { setQuery(""); setPage(1); } }}
          variant="filtered"
        />
      ) : null}

      <CloudCredentialFormModal
        key={formTarget === "create" ? "create" : (formTarget?.id ?? "closed")}
        credential={isEditing ? formTarget : undefined}
        isOpen={Boolean(formTarget)}
        pending={pending}
        error={error}
        onClose={closeForm}
        onSubmit={saveCredential}
      />
      <DeleteCredentialModal
        credential={deleteTarget}
        pending={pending}
        error={error}
        onClose={() => {
          setError("");
          setDeleteTarget(null);
        }}
        onConfirm={deleteCredential}
      />
      <CredentialDetailsModal credential={detailsTarget} onClose={() => setDetailsTarget(null)} />
    </section>
  );
}

function CloudCredentialFormModal({
  credential,
  isOpen,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  credential?: CloudCredential;
  isOpen: boolean;
  pending: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (draft: CredentialDraft) => void;
}) {
  const editing = Boolean(credential);
  const [provider, setProvider] = useState(credential?.provider ?? "");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit({
      name: String(form.get("name") ?? ""),
      description: String(form.get("description") ?? ""),
      provider,
      accessKeyId: String(form.get("accessKeyId") ?? "").trim(),
      accessKeySecret: String(form.get("accessKeySecret") ?? "").trim(),
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
              <Modal.Heading>{editing ? "编辑云凭证" : "新建云凭证"}</Modal.Heading>
              <p className="mt-1.5 text-sm leading-5 text-muted">
                {editing
                  ? "AccessKey 创建后不可修改；如需更换，请先删除所有关联资源，再删除并重新创建凭证。"
                  : "凭证会在保存前加密，之后不会再以明文显示。"}
              </p>
            </Modal.Header>
            <Modal.Body className="p-6">
              <Surface variant="default">
                <form id="cloud-credential-form" className="flex flex-col gap-4" onSubmit={submit}>
                  <TextField className="w-full" name="name" defaultValue={credential?.name ?? ""} isRequired>
                    <Label>名称</Label>
                    <Input placeholder="例如：生产环境阿里云" autoComplete="off" />
                  </TextField>
                  <TextField
                    className="w-full"
                    name="description"
                    defaultValue={credential?.description ?? ""}
                  >
                    <Label>描述</Label>
                    <TextArea placeholder="可选，例如：用于生产环境 DNS 与 ALB" maxLength={240} rows={3} />
                  </TextField>
                  <div className="cloud-provider-field">
                    <Label>云平台</Label>
                    <Select
                      selectedKey={provider || null}
                      isDisabled={editing}
                      isRequired
                      onSelectionChange={(key) => setProvider(String(key))}
                      aria-label="云平台"
                      placeholder="选择云平台"
                    >
                      <Select.Trigger>
                        <Select.Value />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {availableProviders.map((item) => (
                            <ListBox.Item id={item.id} key={item.id}>
                              {item.label}
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    {editing ? <span className="field-help">创建后不可修改云平台类型。</span> : null}
                  </div>
                  {editing ? (
                    <>
                      <TextField className="w-full" value={credential?.accessKeyId || "未记录"} isReadOnly>
                        <Label>AccessKey ID</Label>
                        <Input />
                      </TextField>
                      <p className="field-help">AccessKey Secret 不回显，也不能在编辑时修改。</p>
                    </>
                  ) : (
                    <>
                      <TextField className="w-full" name="accessKeyId" isRequired>
                        <Label>AccessKey ID</Label>
                        <Input placeholder="LTAI..." autoComplete="off" />
                      </TextField>
                      <TextField className="w-full" name="accessKeySecret" type="password" isRequired>
                        <Label>AccessKey Secret</Label>
                        <Input placeholder="输入 AccessKey Secret" autoComplete="new-password" />
                      </TextField>
                    </>
                  )}
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
              <Button form="cloud-credential-form" type="submit" isDisabled={pending}>
                {pending ? "正在保存" : "保存"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function DeleteCredentialModal({
  credential,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  credential: CloudCredential | null;
  pending: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal isOpen={Boolean(credential)} onOpenChange={(open) => !open && onClose()}>
      <Modal.Backdrop>
        <Modal.Container placement="auto">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label="关闭" />
            <Modal.Header>
              <Modal.Icon className="bg-danger-soft text-danger-soft-foreground">
                <Trash2 className="size-5" />
              </Modal.Icon>
              <Modal.Heading>删除云凭证</Modal.Heading>
              <p className="mt-1.5 text-sm leading-5 text-muted">
                将删除“{credential?.name ?? ""}”。此操作无法撤销。
              </p>
            </Modal.Header>
            <Modal.Body className="p-6">
              <p className="text-sm leading-5 text-muted">
                若该凭证仍被 DNS 账户、自动化或部署目标引用，系统会阻止删除。
              </p>
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

function CredentialDetailsModal({
  credential,
  onClose,
}: {
  credential: CloudCredential | null;
  onClose: () => void;
}) {
  return (
    <Modal isOpen={Boolean(credential)} onOpenChange={(open) => !open && onClose()}>
      <Modal.Backdrop>
        <Modal.Container placement="auto" scroll="inside" size="lg">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label="关闭" />
            <Modal.Header>
              <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
                <KeyRound className="size-5" />
              </Modal.Icon>
              <Modal.Heading>{credential?.name ?? "云凭证详情"}</Modal.Heading>
              <p className="mt-1.5 text-sm leading-5 text-muted">查看云平台、凭证摘要和当前状态。</p>
            </Modal.Header>
            <Modal.Body className="p-6">
              {credential ? (
                <Surface variant="default">
                  <div className="flex flex-col gap-4">
                    <TextField className="w-full" value={credential.name} isReadOnly>
                      <Label>名称</Label>
                      <Input />
                    </TextField>
                    <TextField className="w-full" value={providerLabel(credential.provider)} isReadOnly>
                      <Label>云平台</Label>
                      <Input />
                    </TextField>
                    <TextField
                      className="w-full"
                      value={credential.accessKeyId || "未记录（请轮换凭证）"}
                      isReadOnly
                    >
                      <Label>AccessKey ID</Label>
                      <Input />
                    </TextField>
                    <TextField className="w-full" value={credential.description || "未填写"} isReadOnly>
                      <Label>描述</Label>
                      <TextArea rows={3} />
                    </TextField>
                    <TextField className="w-full" value={credential.credentialHint} isReadOnly>
                      <Label>凭证摘要</Label>
                      <Input />
                    </TextField>
                    <TextField className="w-full" value={statusLabel(credential.status)} isReadOnly>
                      <Label>状态</Label>
                      <Input />
                    </TextField>
                    <TextField
                      className="w-full"
                      value={formatDateTime(credential.lastVerifiedAt)}
                      isReadOnly
                    >
                      <Label>最近验证</Label>
                      <Input />
                    </TextField>
                    {credential.lastError ? (
                      <TextField className="w-full" value={credential.lastError} isReadOnly>
                        <Label>最近错误</Label>
                        <Input />
                      </TextField>
                    ) : null}
                    <TextField className="w-full" value={formatDate(credential.createdAt)} isReadOnly>
                      <Label>创建时间</Label>
                      <Input />
                    </TextField>
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

function providerLabel(provider: string) {
  return provider === "aliyun" ? "阿里云" : provider;
}

function statusLabel(status: string) {
  return (
    {
      active: "正常",
      disabled: "已禁用",
      invalid: "验证失败",
      rotating: "处理中",
    }[status] ?? status
  );
}
