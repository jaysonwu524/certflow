export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function readApiError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as ({ code?: string; message?: string } & Record<string, unknown>) | null;
  const { code, message, ...details } = payload ?? {};
  return new ApiError(response.status, code ?? "request_failed", message ?? fallback, details);
}
