import { NextResponse } from "next/server";

const apiBaseUrl = process.env.CERTFLOW_API_URL ?? "http://localhost:8080";

export async function proxyAPI(request: Request, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  headers.set("X-CertFlow-Locale", requestLocale(request));
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (!headers.has("X-Request-ID")) headers.set("X-Request-ID", crypto.randomUUID());

  const upstream = await fetch(`${apiBaseUrl}/api/v1${path}`, { ...init, headers, cache: "no-store" });
  const responseHeaders = new Headers();
  responseHeaders.set("Content-Type", upstream.headers.get("Content-Type") ?? "application/json");
  for (const name of ["Cache-Control", "X-Accel-Buffering"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  for (const value of upstream.headers.getSetCookie()) responseHeaders.append("set-cookie", value);
  return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
}

function requestLocale(request: Request) {
  const requested = request.headers.get("X-CertFlow-Locale") ?? request.headers.get("Accept-Language") ?? "";
  if (requested.toLowerCase().startsWith("zh")) return "zh-CN";
  const localeCookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith("certflow_locale="))
    ?.split("=", 2)[1];
  return localeCookie === "en" ? "en" : "zh-CN";
}
