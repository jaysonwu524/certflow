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
import { useLocale } from "@/components/providers/locale-provider";

type CredentialDraft = {
  name: string;
  description: string;
  provider: string;
  accessKeyId: string;
  accessKeySecret: string;
};

const availableProviders = [{ id: "aliyun", label: "cloud.aliyun" }] as const;

export function CloudCredentialManager({ credentials }: { credentials: CloudCredential[] }) {
  const router = useRouter();
  const { t } = useLocale();
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
      setError(t("cloud.nameRequired"));
      return;
    }
    if (!draft.provider) {
      setError(t("cloud.providerRequired"));
      return;
    }
    if (!isEditing && !isRotating) {
      setError(t("cloud.keysRequired"));
      return;
    }
    if (isRotating && (!draft.accessKeyId || !draft.accessKeySecret)) {
      setError(t("cloud.keysRequired"));
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
      setError(cause instanceof Error ? cause.message : t("cloud.saveFailed"));
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
          ? t("cloud.deleteBlocked")
          : cause instanceof Error
            ? cause.message
            : t("cloud.deleteFailed"),
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
      setError(cause instanceof Error ? cause.message : t("cloud.verifyFailed"));
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
      setError(cause instanceof Error ? cause.message : t("cloud.statusUpdateFailed"));
    }
  }

  return (
    <section className="cloud-credential-section">
      <div className="cloud-credential-actions">
        <div className="resource-operation-bar">
          <Button variant="tertiary" size="sm" onPress={() => router.refresh()}>
            <RefreshCw size={15} />
            {t("common.refresh")}
          </Button>
          <Button variant="primary" size="sm" onPress={openCreate}>
            <Plus size={15} />
            {t("cloud.create")}
          </Button>
        </div>
        <div className="resource-query-bar">
          <div className="resource-search">
            <Search size={15} aria-hidden="true" />
            <Input
              aria-label={t("common.search")}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder={t("cloud.searchPlaceholder")}
            />
          </div>
        </div>
      </div>
      {error && !formTarget && !deleteTarget ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      <Table className="table-pinned-columns">
        <Table.ScrollContainer>
          <Table.Content aria-label={t("cloud.tableLabel")} className="min-w-[820px]">
            <Table.Header>
              <Table.Column isRowHeader>{t("common.name")}</Table.Column>
              <Table.Column>{t("common.description")}</Table.Column>
              <Table.Column>{t("cloud.provider")}</Table.Column>
              <Table.Column>AccessKey ID</Table.Column>
              <Table.Column>{t("cloud.credentialHint")}</Table.Column>
              <Table.Column>{t("common.status")}</Table.Column>
              <Table.Column>{t("common.actions")}</Table.Column>
            </Table.Header>
            <Table.Body>
              {paginatedCredentials.map((credential) => (
                <Table.Row key={credential.id}>
                  <Table.Cell>{credential.name}</Table.Cell>
                  <Table.Cell>{credential.description || "-"}</Table.Cell>
                  <Table.Cell>{providerLabel(credential.provider, t)}</Table.Cell>
                  <Table.Cell>{credential.accessKeyId || t("cloud.notRecorded")}</Table.Cell>
                  <Table.Cell>{credential.credentialHint}</Table.Cell>
                  <Table.Cell>
                    <StatusTag status={credential.status} />
                  </Table.Cell>
                  <Table.Cell>
                    <TableActions
                      actions={[
                        {
                          id: "details",
                          label: t("common.details"),
                          onPress: () => setDetailsTarget(credential),
                        },
                        {
                          id: "verify",
                          label: t("common.verify"),
                          pendingLabel: t("cloud.verifyPending"),
                          onPress: () => void verifyCredential(credential),
                          isDisabled: pending,
                          isPending: verifyingId === credential.id,
                        },
                        {
                          id: "toggle",
                          label: credential.status === "disabled" ? t("common.enable") : t("common.disable"),
                          onPress: () => void toggleCredential(credential),
                          isDisabled: pending,
                        },
                        {
                          id: "edit",
                          label: t("dns.editAction"),
                          onPress: () => {
                            setError("");
                            setFormTarget(credential);
                          },
                        },
                        {
                          id: "delete",
                          label: t("dns.deleteAction"),
                          onPress: () => {
                            setError("");
                            setDeleteTarget(credential);
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
          title={t("cloud.empty")}
          description={t("cloud.emptyDescription")}
          primaryAction={{ label: t("cloud.create"), icon: Plus, onPress: openCreate }}
        />
      ) : null}
      {credentials.length > 0 && visibleCredentials.length === 0 ? (
        <ResourceEmptyState
          icon={Search}
          title={t("cloud.noResults")}
          description={t("cloud.noResultsDescription")}
          primaryAction={{
            label: t("cloud.clearSearch"),
            onPress: () => {
              setQuery("");
              setPage(1);
            },
          }}
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
  const { t } = useLocale();
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
            <Modal.CloseTrigger aria-label={t("dns.close")} />
            <Modal.Header>
              <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
                <KeyRound className="size-5" />
              </Modal.Icon>
              <Modal.Heading>{editing ? t("cloud.edit") : t("cloud.create")}</Modal.Heading>
              <p className="mt-1.5 text-sm leading-5 text-muted">
                {editing ? t("cloud.formEditDescription") : t("cloud.formCreateDescription")}
              </p>
            </Modal.Header>
            <Modal.Body className="p-6">
              <Surface variant="default">
                <form id="cloud-credential-form" className="flex flex-col gap-4" onSubmit={submit}>
                  <TextField className="w-full" name="name" defaultValue={credential?.name ?? ""} isRequired>
                    <Label>{t("common.name")}</Label>
                    <Input placeholder={t("cloud.namePlaceholder")} autoComplete="off" />
                  </TextField>
                  <TextField
                    className="w-full"
                    name="description"
                    defaultValue={credential?.description ?? ""}
                  >
                    <Label>{t("common.description")}</Label>
                    <TextArea placeholder={t("cloud.descriptionPlaceholder")} maxLength={240} rows={3} />
                  </TextField>
                  <div className="cloud-provider-field">
                    <Label>{t("cloud.provider")}</Label>
                    <Select
                      selectedKey={provider || null}
                      isDisabled={editing}
                      isRequired
                      onSelectionChange={(key) => setProvider(String(key))}
                      aria-label={t("cloud.provider")}
                      placeholder={t("cloud.selectProvider")}
                    >
                      <Select.Trigger>
                        <Select.Value />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {availableProviders.map((item) => (
                            <ListBox.Item id={item.id} key={item.id}>
                              {t(item.label)}
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    {editing ? <span className="field-help">{t("cloud.providerImmutable")}</span> : null}
                  </div>
                  {editing ? (
                    <>
                      <TextField
                        className="w-full"
                        value={credential?.accessKeyId || t("cloud.notRecorded")}
                        isReadOnly
                      >
                        <Label>AccessKey ID</Label>
                        <Input />
                      </TextField>
                      <p className="field-help">{t("cloud.secretImmutable")}</p>
                    </>
                  ) : (
                    <>
                      <TextField className="w-full" name="accessKeyId" isRequired>
                        <Label>AccessKey ID</Label>
                        <Input placeholder="LTAI..." autoComplete="off" />
                      </TextField>
                      <TextField className="w-full" name="accessKeySecret" type="password" isRequired>
                        <Label>AccessKey Secret</Label>
                        <Input placeholder={t("cloud.secretPlaceholder")} autoComplete="new-password" />
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
                {t("dns.cancel")}
              </Button>
              <Button form="cloud-credential-form" type="submit" isDisabled={pending}>
                {pending ? t("dns.saving") : t("dns.save")}
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
  const { t } = useLocale();
  return (
    <Modal isOpen={Boolean(credential)} onOpenChange={(open) => !open && onClose()}>
      <Modal.Backdrop>
        <Modal.Container placement="auto">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label={t("dns.close")} />
            <Modal.Header>
              <Modal.Icon className="bg-danger-soft text-danger-soft-foreground">
                <Trash2 className="size-5" />
              </Modal.Icon>
              <Modal.Heading>{t("cloud.deleteTitle")}</Modal.Heading>
              <p className="mt-1.5 text-sm leading-5 text-muted">
                {t("cloud.deleteDescription", { name: credential?.name ?? "" })}
              </p>
            </Modal.Header>
            <Modal.Body className="p-6">
              <p className="text-sm leading-5 text-muted">{t("cloud.deleteHint")}</p>
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

function CredentialDetailsModal({
  credential,
  onClose,
}: {
  credential: CloudCredential | null;
  onClose: () => void;
}) {
  const { locale, t } = useLocale();
  return (
    <Modal isOpen={Boolean(credential)} onOpenChange={(open) => !open && onClose()}>
      <Modal.Backdrop>
        <Modal.Container placement="auto" scroll="inside" size="lg">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label={t("dns.close")} />
            <Modal.Header>
              <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
                <KeyRound className="size-5" />
              </Modal.Icon>
              <Modal.Heading>{credential?.name ?? t("cloud.details")}</Modal.Heading>
              <p className="mt-1.5 text-sm leading-5 text-muted">{t("cloud.detailDescription")}</p>
            </Modal.Header>
            <Modal.Body className="p-6">
              {credential ? (
                <Surface variant="default">
                  <div className="flex flex-col gap-4">
                    <TextField className="w-full" value={credential.name} isReadOnly>
                      <Label>{t("common.name")}</Label>
                      <Input />
                    </TextField>
                    <TextField className="w-full" value={providerLabel(credential.provider, t)} isReadOnly>
                      <Label>{t("cloud.provider")}</Label>
                      <Input />
                    </TextField>
                    <TextField
                      className="w-full"
                      value={credential.accessKeyId || t("cloud.notRecordedRotate")}
                      isReadOnly
                    >
                      <Label>AccessKey ID</Label>
                      <Input />
                    </TextField>
                    <TextField
                      className="w-full"
                      value={credential.description || t("cloud.notProvided")}
                      isReadOnly
                    >
                      <Label>{t("common.description")}</Label>
                      <TextArea rows={3} />
                    </TextField>
                    <TextField className="w-full" value={credential.credentialHint} isReadOnly>
                      <Label>{t("cloud.credentialHint")}</Label>
                      <Input />
                    </TextField>
                    <TextField className="w-full" value={statusLabel(credential.status, t)} isReadOnly>
                      <Label>{t("common.status")}</Label>
                      <Input />
                    </TextField>
                    <TextField
                      className="w-full"
                      value={formatDateTime(credential.lastVerifiedAt, locale)}
                      isReadOnly
                    >
                      <Label>{t("cloud.lastVerified")}</Label>
                      <Input />
                    </TextField>
                    {credential.lastError ? (
                      <TextField className="w-full" value={credential.lastError} isReadOnly>
                        <Label>{t("cloud.lastError")}</Label>
                        <Input />
                      </TextField>
                    ) : null}
                    <TextField className="w-full" value={formatDate(credential.createdAt, locale)} isReadOnly>
                      <Label>{t("common.createdAt")}</Label>
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

function providerLabel(provider: string, t: ReturnType<typeof useLocale>["t"]) {
  return provider === "aliyun" ? t("cloud.aliyun") : provider;
}

function statusLabel(status: string, t: ReturnType<typeof useLocale>["t"]) {
  return (
    {
      active: t("status.active"),
      disabled: t("status.disabled"),
      invalid: t("status.invalid"),
      rotating: t("cloud.status.rotating"),
    }[status] || status
  );
}
