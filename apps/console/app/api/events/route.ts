import type { NextRequest } from "next/server";
import { proxyAPI } from "@/lib/api-proxy";

export async function GET(request: NextRequest) {
  const after = request.nextUrl.searchParams.get("after");
  const lastEventID = request.headers.get("last-event-id");
  const query = after ? `?after=${encodeURIComponent(after)}` : "";
  return proxyAPI(request, `/events${query}`, {
    headers: lastEventID ? { "Last-Event-ID": lastEventID } : undefined,
  });
}
