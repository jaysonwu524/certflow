"use client";

import { toast } from "@heroui/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useLocale } from "@/components/providers/locale-provider";

type RealtimeEvent = {
  id: number;
  topic: "certificate.status" | "execution.status" | "verification.status";
  resourceType: string;
  resourceId: string;
  status: string;
  payload: { kind?: string; certificateId?: string; operation?: string; resourceType?: string };
  createdAt: string;
};

const cursorStorageKey = "certflow.realtime.lastEventId";

function executionLabel(kind: string | undefined, status: string, t: ReturnType<typeof useLocale>["t"]) {
  const operation = kind === "issue" ? t("realtime.issue") : kind === "renew" ? t("realtime.renew") : kind === "upload" ? t("realtime.upload") : t("realtime.deploy");
  if (status === "succeeded") return { message: t("realtime.succeeded").replace("{operation}", operation), variant: "success" as const };
  if (status === "failed") return { message: t("realtime.failed").replace("{operation}", operation), variant: "danger" as const };
  if (status === "waiting_user") return { message: t("realtime.waiting").replace("{operation}", operation), variant: "warning" as const };
  return { message: t("realtime.running").replace("{operation}", operation), variant: "default" as const };
}

function verificationLabel(resourceType: string | undefined, status: string, t: ReturnType<typeof useLocale>["t"]) {
  const operation = resourceType === "cloud_credential"
    ? t("realtime.cloudCredentialVerify")
    : resourceType === "acme_account"
      ? t("realtime.acmeVerify")
      : t("realtime.dnsVerify");
  if (status === "succeeded") return { message: t("realtime.succeeded").replace("{operation}", operation), variant: "success" as const };
  if (status === "failed") return { message: t("realtime.failed").replace("{operation}", operation), variant: "danger" as const };
  return { message: t("realtime.running").replace("{operation}", operation), variant: "default" as const };
}

// One application-level stream keeps list/detail pages in sync without each
// resource view opening an independent long-lived browser connection.
export function RealtimeEvents() {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLocale();
  const refreshTimer = useRef<number | null>(null);

  useEffect(() => {
    if (pathname === "/" || pathname === "/login" || pathname === "/register") return;
    let cursor = "";
    try {
      cursor = window.localStorage.getItem(cursorStorageKey) ?? "";
    } catch {
      // Cursor persistence only improves reconnect replay and is optional.
    }
    const source = new EventSource(`/api/events${cursor ? `?after=${encodeURIComponent(cursor)}` : ""}`);
    const update = (message: MessageEvent<string>) => {
      let event: RealtimeEvent;
      try {
        event = JSON.parse(message.data) as RealtimeEvent;
      } catch {
        return;
      }
      try {
        window.localStorage.setItem(cursorStorageKey, String(event.id));
      } catch {
        // The browser may reject storage in private or embedded contexts.
      }
      window.dispatchEvent(new CustomEvent("certflow:realtime", { detail: event }));
      if (event.topic === "execution.status") {
        const notification = executionLabel(event.payload.kind, event.status, t);
        if (notification.variant === "success") toast.success(notification.message);
        else if (notification.variant === "danger") toast.danger(notification.message);
        else if (notification.variant === "warning") toast.warning(notification.message);
        else toast.info(notification.message);
      }
      if (event.topic === "verification.status") {
        const notification = verificationLabel(event.resourceType, event.status, t);
        if (notification.variant === "success") toast.success(notification.message);
        else if (notification.variant === "danger") toast.danger(notification.message);
        else toast.info(notification.message);
      }
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => {
        router.refresh();
        refreshTimer.current = null;
      }, 350);
    };
    source.addEventListener("update", update as EventListener);
    return () => {
      source.removeEventListener("update", update as EventListener);
      source.close();
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    };
  }, [pathname, router, t]);

  return null;
}
