import { proxyAPI } from "@/lib/api-proxy";

export async function GET(request: Request) {
  return proxyAPI(request, "/profile/webhook");
}

export async function PUT(request: Request) {
  return proxyAPI(request, "/profile/webhook", { method: "PUT", body: await request.text() });
}
