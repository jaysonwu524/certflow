import { proxyAPI } from "@/lib/api-proxy";

export async function GET(request: Request) {
  return proxyAPI(request, "/notifications");
}
