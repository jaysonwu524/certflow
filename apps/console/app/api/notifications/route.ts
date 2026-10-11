import { proxyAPI } from "@/lib/api-proxy";

export async function GET(request: Request) {
  const search = new URL(request.url).search;
  return proxyAPI(request, `/notifications${search}`);
}
