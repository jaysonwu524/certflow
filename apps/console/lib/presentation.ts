export function formatDate(value: string | null, locale = "zh-CN"): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function formatDateTime(value: string | null, locale = "zh-CN", empty = "尚未开始"): string {
  if (!value) return empty;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
