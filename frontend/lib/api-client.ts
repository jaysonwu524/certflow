import { readApiError } from "@/lib/api-error";

type APIRequestOptions = Omit<RequestInit, "body"> & { body?: unknown };

export async function apiRequest<T>(path: string, options: APIRequestOptions = {}): Promise<T> {
  let response = await fetch(path, {
    ...options,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (response.status === 401 && !path.startsWith("/api/auth/")) {
    const refreshed = await fetch("/api/auth/refresh", { method: "POST" });
    if (refreshed.ok) {
      response = await fetch(path, {
        ...options,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        headers: { "Content-Type": "application/json", ...options.headers },
      });
    }
  }
  if (!response.ok) throw await readApiError(response, "请求未能完成");
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
