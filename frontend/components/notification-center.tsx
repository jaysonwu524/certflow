"use client";

import { Badge, Button, ListBox, Popover } from "@heroui/react";
import { Bell, BellRing, CheckCheck, Clock3, FileKey2, ListChecks, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, type TranslationKey } from "@/components/locale-provider";
import { ModalCancelButton, ResourceModal } from "@/components/resource-modal";
import { StatusTag } from "@/components/status-tag";
import { apiRequest } from "@/lib/api-client";

type Notification = {
  id: number;
  topic: "certificate.status" | "execution.status" | "verification.status";
  resourceType: string;
  resourceId: string;
  status: string;
  payload: { kind?: string; certificateId?: string; name?: string; operation?: string; resourceType?: string };
  createdAt: string;
  readAt: string | null;
};

const statusLabels: Record<string, TranslationKey> = {
  pending: "notification.status.pending",
  issuing: "notification.status.issuing",
  renewing: "notification.status.renewing",
  issued: "notification.status.issued",
  succeeded: "notification.status.succeeded",
  failed: "notification.status.failed",
  waiting_user: "notification.status.waiting",
  running: "notification.status.running",
};

function notificationTitle(item: Notification, t: ReturnType<typeof useLocale>["t"]) {
  if (item.topic === "certificate.status") return t("notification.certificateUpdate");
  if (item.topic === "verification.status") {
    const operation = item.resourceType === "cloud_credential"
      ? t("realtime.cloudCredentialVerify")
      : item.resourceType === "acme_account"
        ? t("realtime.acmeVerify")
        : t("realtime.dnsVerify");
    return t("notification.verificationUpdate").replace("{operation}", operation);
  }
  const operation = item.payload.kind === "issue" ? t("realtime.issue") : item.payload.kind === "renew" ? t("realtime.renew") : item.payload.kind === "upload" ? t("realtime.upload") : t("realtime.deploy");
  return t("notification.executionUpdate").replace("{operation}", operation);
}

function notificationTime(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function NotificationCenter() {
  const { locale, t } = useLocale();
  const router = useRouter();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<Notification | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await apiRequest<{ data: Notification[] }>("/api/notifications");
      setItems(response.data);
    } catch {
      // A transient failure must not affect the primary Header controls.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    const update = () => void load();
    window.addEventListener("certflow:realtime", update);
    return () => {
      window.clearTimeout(initialLoad);
      window.removeEventListener("certflow:realtime", update);
    };
  }, [load]);

  const unreadCount = useMemo(() => items.filter((item) => !item.readAt).length, [items]);

  async function markRead(ids: number[]) {
    if (ids.length === 0) return;
    setUpdating(true);
    try {
      await apiRequest("/api/notifications/read", { method: "POST", body: { ids } });
      setItems((current) => current.map((item) => (ids.includes(item.id) ? { ...item, readAt: new Date().toISOString() } : item)));
    } finally {
      setUpdating(false);
    }
  }

  async function openNotification(item: Notification) {
    setIsOpen(false);
    setSelected(item);
    if (!item.readAt) void markRead([item.id]);
  }

  function navigateFromDetail() {
    if (!selected) return;
    setSelected(null);
    if (selected.topic === "execution.status") {
      router.push("/executions");
      return;
    }
    if (selected.topic === "verification.status") {
      const path = selected.resourceType === "cloud_credential" ? "/cloud-credentials" : selected.resourceType === "acme_account" ? "/acme-accounts" : "/dns-accounts";
      router.push(path);
      return;
    }
    const certificateID = selected.payload.certificateId ?? selected.resourceId;
    router.push(`/certificates?selected=${encodeURIComponent(certificateID)}&mode=view`);
  }

  return (
    <>
    <Popover isOpen={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger className="notification-popover-trigger">
        <Badge.Anchor className="notification-badge-anchor">
          <Button className="notification-trigger" variant="ghost" isIconOnly aria-label={t("notification.title")}>
            <Bell size={17} aria-hidden="true" />
          </Button>
          {unreadCount > 0 ? (
            <Badge color="danger" placement="top-right" size="sm" variant="primary" className="notification-badge">
              <Badge.Label>{unreadCount > 99 ? "99+" : unreadCount}</Badge.Label>
            </Badge>
          ) : null}
        </Badge.Anchor>
      </Popover.Trigger>
      <Popover.Content placement="bottom end" className="notification-popover">
        <Popover.Dialog>
          <div className="notification-popover-header">
            <div>
              <Popover.Heading>{t("notification.title")}</Popover.Heading>
              <p>{unreadCount ? t("notification.unread").replace("{count}", String(unreadCount)) : t("notification.allRead")}</p>
            </div>
            <Button variant="tertiary" size="sm" isDisabled={unreadCount === 0 || updating} onPress={() => void markRead(items.filter((item) => !item.readAt).map((item) => item.id))}>
              <CheckCheck size={15} />
              {t("notification.markAllRead")}
            </Button>
          </div>
          {loading ? <div className="notification-empty">{t("notification.loading")}</div> : null}
          {!loading && items.length === 0 ? <div className="notification-empty"><BellRing size={18} /><span>{t("notification.empty")}</span></div> : null}
          {!loading && items.length > 0 ? (
            <ListBox aria-label={t("notification.title")} className="notification-list" onAction={(key) => {
              const item = items.find((entry) => entry.id === Number(key));
              if (item) void openNotification(item);
            }}>
              {items.map((item) => {
                const statusKey = statusLabels[item.status];
                return (
                  <ListBox.Item id={String(item.id)} key={item.id} textValue={notificationTitle(item, t)} className={`notification-item ${item.readAt ? "notification-item-read" : "notification-item-unread"}`}>
                    {item.topic === "execution.status" ? <ListChecks size={16} /> : item.topic === "verification.status" ? <ShieldCheck size={16} /> : <FileKey2 size={16} />}
                    <span className="notification-item-content">
                      <strong>{notificationTitle(item, t)}</strong>
                      <span>{statusKey ? t(statusKey) : item.status}</span>
                      <small>{notificationTime(item.createdAt, locale)}</small>
                    </span>
                  </ListBox.Item>
                );
              })}
            </ListBox>
          ) : null}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
    <ResourceModal
      isOpen={Boolean(selected)}
      onOpenChange={(open) => !open && setSelected(null)}
      size="standard"
      title={t("notification.detail")}
      description={selected ? notificationTitle(selected, t) : undefined}
      headerIcon={selected ? (
        selected.topic === "execution.status" ? (
          <ListChecks size={20} />
        ) : selected.topic === "verification.status" ? (
          <ShieldCheck size={20} />
        ) : (
          <FileKey2 size={20} />
        )
      ) : undefined}
      footer={selected ? <>
        <ModalCancelButton onPress={() => setSelected(null)} />
        <Button variant="primary" onPress={navigateFromDetail}>
          {selected.topic === "execution.status" ? <ListChecks size={16} /> : selected.topic === "verification.status" ? <ShieldCheck size={16} /> : <FileKey2 size={16} />}
          {selected.topic === "execution.status" ? t("notification.openExecutions") : selected.topic === "verification.status" ? t("notification.openResource") : t("notification.openCertificate")}
        </Button>
      </> : undefined}
    >
      {selected ? (
        <div className="notification-detail-layout">
          <section className="notification-detail-summary" aria-label={notificationTitle(selected, t)}>
            <div className="notification-detail-summary-main">
              <strong>{notificationTitle(selected, t)}</strong>
              <div className="notification-detail-meta">
                <StatusTag status={selected.status} />
                <span><Clock3 size={14} aria-hidden="true" />{notificationTime(selected.createdAt, locale)}</span>
              </div>
            </div>
          </section>
          <dl className="notification-detail-resource">
            <div>
              <dt>{t("notification.resource")}</dt>
              <dd>
                <span className="notification-detail-resource-name">
                  {selected.topic === "execution.status" ? <ListChecks size={16} aria-hidden="true" /> : selected.topic === "verification.status" ? <ShieldCheck size={16} aria-hidden="true" /> : <FileKey2 size={16} aria-hidden="true" />}
                  {selected.topic === "execution.status" ? t("notification.executionResource") : selected.payload.name || selected.resourceId}
                </span>
                <small>{selected.resourceId}</small>
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
    </ResourceModal>
    </>
  );
}
