import { Tag, TagGroup } from "@heroui/react";
import { useId } from "react";
import { useLocale, type TranslationKey } from "@/components/providers/locale-provider";

const labelKeys: Record<string, TranslationKey> = {
  draft: "status.draft", pending: "status.pending", issuing: "status.issuing", issued: "status.issued", renewing: "status.renewing",
  failed: "status.failed", partial_failed: "status.partial_failed", expiring: "status.expiring", expired: "status.expired", revoked: "status.revoked",
  disabled: "status.disabled", queued: "status.queued", running: "status.running", waiting_user: "status.waiting_user", succeeded: "status.succeeded",
  cancelled: "status.cancelled", active: "status.active", invalid: "status.invalid",
};

export function StatusTag({ status }: { status: string }) {
  const { t } = useLocale();
  const label = t(labelKeys[status] ?? "status.unknown");
  const tagId = useId();

  return (
    <TagGroup aria-label="状态" className="status-tag-group" size="sm" variant="default">
      <TagGroup.List>
        <Tag id={tagId} className={`status-tag status-${status}`}>
          {label}
        </Tag>
      </TagGroup.List>
    </TagGroup>
  );
}
