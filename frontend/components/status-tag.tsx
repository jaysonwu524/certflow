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
};

export function StatusTag({ status }: { status: string }) {
  return <span className={`status-tag status-${status}`}>{labels[status] ?? status}</span>;
}
