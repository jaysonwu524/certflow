import { proxyAPI } from "@/lib/api-proxy";

export async function POST(request: Request) {
  return proxyAPI(request, "/certificates", { method: "POST", body: await request.text() });
}
