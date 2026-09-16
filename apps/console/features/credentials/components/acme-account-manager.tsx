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
import type { ACMEAccount } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/presentation";
import { ResourcePagination } from "@/components/ui/resource-pagination";
import { TableActions } from "@/components/ui/table-actions";
import { useLocale } from "@/components/providers/locale-provider";

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
  const { locale, t } = useLocale();
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
      [account.name, account.email, account.directoryUrl, account.privateKeyAlgorithm, account.status]
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
      setError(t("acme.nameRequired"));
      return;
    }
    if (!draft.directoryUrl.trim()) {
      setError(t("acme.directoryRequired"));
      return;
    }
    if (!draft.email.trim()) {
      setError(t("acme.emailRequired"));
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
      setError(cause instanceof Error ? cause.message : t("acme.saveFailed"));
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
          ? t("acme.deleteBlocked")
          : cause instanceof Error
            ? cause.message
            : t("acme.deleteFailed"),
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
      setError(cause instanceof Error ? cause.message : t("acme.verifyFailed"));
    } finally {
      setPending(false);
      setVerifyingId(null);
    }
  }

  return (
    <section className="acme-account-section">
      <div className="acme-account-actions">
        <div className="resource-operation-bar">
          <Button variant="tertiary" size="sm" onPress={() => router.refresh()}>
            <RefreshCw size={15} />
            {t("common.refresh")}
          </Button>
          <Button variant="primary" size="sm" onPress={openCreate}>
            <Plus size={15} />
            {t("acme.create")}
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
              placeholder={t("acme.searchPlaceholder")}
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
          <Table.Content aria-label={t("acme.tableLabel")} className="min-w-[980px]">
            <Table.Header>
              <Table.Column isRowHeader>{t("common.name")}</Table.Column>
              <Table.Column>{t("acme.email")}</Table.Column>
              <Table.Column>Directory</Table.Column>
              <Table.Column>{t("acme.keyAlgorithm")}</Table.Column>
              <Table.Column>{t("common.status")}</Table.Column>
              <Table.Column>{t("acme.lastVerified")}</Table.Column>
              <Table.Column>{t("common.createdAt")}</Table.Column>
              <Table.Column>{t("common.actions")}</Table.Column>
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
                        ? t("status.failed")
                        : account.lastVerifiedAt
                          ? formatDateTime(account.lastVerifiedAt, locale)
                          : t("dns.notVerified")}
                    </span>
                  </Table.Cell>
                  <Table.Cell>{formatDate(account.createdAt, locale)}</Table.Cell>
                  <Table.Cell>
                    <TableActions
                      actions={[
                        {
                          id: "details",
                          label: t("common.details"),
                          onPress: () => setDetailsTarget(account),
                        },
                        {
                          id: "verify",
                          label: t("common.verify"),
                          pendingLabel: t("acme.verifyPending"),
                          onPress: () => void verifyAccount(account),
                          isDisabled: pending,
                          isPending: verifyingId === account.id,
                        },
                        {
                          id: "edit",
                          label: t("dns.editAction"),
                          onPress: () => {
                            setError("");
                            setFormTarget(account);
                          },
                        },
                        {
                          id: "delete",
                          label: t("dns.deleteAction"),
                          onPress: () => {
                            setError("");
                            setDeleteTarget(account);
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
          title={t("acme.empty")}
          description={t("acme.emptyDescription")}
          primaryAction={{ label: t("acme.create"), icon: Plus, onPress: openCreate }}
        />
      ) : null}
      {accounts.length > 0 && visibleAccounts.length === 0 ? (
        <ResourceEmptyState
          icon={Search}
          title={t("acme.noResults")}
          description={t("acme.noResultsDescription")}
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
  const { t } = useLocale();
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
            <Modal.CloseTrigger aria-label={t("dns.close")} />
            <Modal.Header>
              <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
                <KeyRound className="size-5" />
              </Modal.Icon>
              <Modal.Heading>{editing ? t("acme.edit") : t("acme.create")}</Modal.Heading>
              <p className="mt-1.5 text-sm leading-5 text-muted">
                {editing ? t("acme.formEditDescription") : t("acme.formCreateDescription")}
              </p>
            </Modal.Header>
            <Modal.Body className="p-6">
              <Surface variant="default">
                <form id="acme-account-form" className="flex flex-col gap-4" onSubmit={submit}>
                  <TextField className="w-full" name="name" defaultValue={account?.name ?? ""} isRequired>
                    <Label>{t("common.name")}</Label>
                    <Input placeholder={t("acme.namePlaceholder")} autoComplete="off" />
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
                    <Label>{t("acme.email")}</Label>
                    <Input placeholder={t("acme.emailPlaceholder")} autoComplete="email" />
                  </TextField>
                  <div className="cloud-provider-field">
                    <Label>{t("acme.keyAlgorithm")}</Label>
                    <Select
                      selectedKey={algorithm}
                      isRequired
                      onSelectionChange={(key) => setAlgorithm(String(key))}
                      aria-label={t("acme.keyAlgorithm")}
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
                  <TextField className="w-full" name="privateKey" type="text">
                    <Label>{t("acme.privateKey")}</Label>
                    <TextArea
                      placeholder={
                        editing ? t("acme.privateKeyEditPlaceholder") : t("acme.privateKeyCreatePlaceholder")
                      }
                      autoComplete="off"
                      rows={7}
                    />
                  </TextField>
                  <p className="field-help">{t("acme.privateKeyHint")}</p>
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
              <Button form="acme-account-form" type="submit" isDisabled={pending}>
                {pending ? t("dns.saving") : t("dns.save")}
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
              <Modal.Heading>{t("acme.deleteTitle")}</Modal.Heading>
              <p className="mt-1.5 text-sm leading-5 text-muted">
                {t("acme.deleteDescription", { name: account?.name ?? "" })}
              </p>
            </Modal.Header>
            <Modal.Body className="p-6">
              <p className="text-sm leading-5 text-muted">{t("acme.deleteHint")}</p>
              {account && (account.certificateCount > 0 || account.automationCount > 0) ? (
                <div className="resource-warning mt-4" role="status">
                  {t("acme.relationships", {
                    certificates: account.certificateCount,
                    automations: account.automationCount,
                  })}
                </div>
              ) : (
                <p className="field-help mt-4">{t("acme.noRelationships")}</p>
              )}
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

function ACMEAccountDetailsModal({ account, onClose }: { account: ACMEAccount | null; onClose: () => void }) {
  const { locale, t } = useLocale();
  return (
    <Modal isOpen={Boolean(account)} onOpenChange={(open) => !open && onClose()}>
      <Modal.Backdrop>
        <Modal.Container placement="auto" scroll="inside" size="lg">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label={t("dns.close")} />
            <Modal.Header>
              <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
                <KeyRound className="size-5" />
              </Modal.Icon>
              <Modal.Heading>{account?.name ?? t("acme.details")}</Modal.Heading>
              <p className="mt-1.5 text-sm leading-5 text-muted">{t("acme.detailDescription")}</p>
            </Modal.Header>
            <Modal.Body className="p-6">
              {account ? (
                <Surface variant="default">
                  <div className="flex flex-col gap-4">
                    <TextField className="w-full" value={account.name} isReadOnly>
                      <Label>{t("common.name")}</Label>
                      <Input />
                    </TextField>
                    <TextField className="w-full" value={account.directoryUrl} isReadOnly>
                      <Label>ACME Directory URL</Label>
                      <Input />
                    </TextField>
                    <TextField
                      className="w-full"
                      value={account.accountUrl || t("acme.notRegistered")}
                      isReadOnly
                    >
                      <Label>{t("acme.accountUrl")}</Label>
                      <Input />
                    </TextField>
                    <TextField className="w-full" value={account.email} isReadOnly>
                      <Label>{t("acme.email")}</Label>
                      <Input />
                    </TextField>
                    <TextField
                      className="w-full"
                      value={algorithmLabel(account.privateKeyAlgorithm)}
                      isReadOnly
                    >
                      <Label>{t("acme.keyAlgorithm")}</Label>
                      <Input />
                    </TextField>
                    <TextField className="w-full" value={statusLabel(account.status, t)} isReadOnly>
                      <Label>{t("common.status")}</Label>
                      <Input />
                    </TextField>
                    <TextField className="w-full" value={formatDate(account.createdAt, locale)} isReadOnly>
                      <Label>{t("common.createdAt")}</Label>
                      <Input />
                    </TextField>
                    <TextField
                      className="w-full"
                      value={
                        account.lastVerifiedAt
                          ? formatDateTime(account.lastVerifiedAt, locale)
                          : t("dns.notVerified")
                      }
                      isReadOnly
                    >
                      <Label>{t("acme.lastVerified")}</Label>
                      <Input />
                    </TextField>
                    <TextField
                      className="w-full"
                      value={t("common.items", { count: account.certificateCount })}
                      isReadOnly
                    >
                      <Label>{t("acme.certificateCount")}</Label>
                      <Input />
                    </TextField>
                    <TextField
                      className="w-full"
                      value={t("common.items", { count: account.automationCount })}
                      isReadOnly
                    >
                      <Label>{t("acme.automationCount")}</Label>
                      <Input />
                    </TextField>
                    {account.lastError ? (
                      <p className="form-error" role="alert">
                        {t("acme.lastVerificationFailed", { error: account.lastError })}
                      </p>
                    ) : null}
                    <p className="field-help">{t("acme.privateKeyProtected")}</p>
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

function statusLabel(status: string, t: ReturnType<typeof useLocale>["t"]) {
  return (
    { active: t("status.active"), disabled: t("status.disabled"), error: t("acme.status.error") }[status] ||
    status
  );
}

function algorithmLabel(algorithm: string) {
  return keyAlgorithms.find((item) => item.id === algorithm)?.label ?? algorithm;
}
