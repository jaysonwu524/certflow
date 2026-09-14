import { proxyAPI } from "@/lib/api-proxy";

export async function POST(request: Request) {
  return proxyAPI(request, "/notifications/read", { method: "POST", body: await request.text() });
}
