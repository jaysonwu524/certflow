import { proxyAPI } from "@/lib/api-proxy";

export async function POST(request: Request) {
  return proxyAPI(request, "/profile/sessions/revoke-others", { method: "POST" });
}
