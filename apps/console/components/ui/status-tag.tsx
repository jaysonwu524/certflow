import { Tag, TagGroup } from "@heroui/react";
import { useId } from "react";

const labels: Record<string, string> = {
  draft: "草稿",
  pending: "待签发",
  issuing: "签发中",
  issued: "已签发",
  renewing: "续期中",
  failed: "失败",
  expiring: "即将到期",
  expired: "已过期",
  revoked: "已撤销",
  disabled: "已禁用",
  queued: "排队中",
  running: "执行中",
  waiting_user: "等待确认",
  succeeded: "成功",
  cancelled: "已取消",
  active: "正常",
  invalid: "验证失败",
};

export function StatusTag({ status }: { status: string }) {
  const label = labels[status] ?? status;
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
