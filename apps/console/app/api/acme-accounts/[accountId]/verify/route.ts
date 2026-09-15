import { proxyAPI } from "@/lib/api-proxy";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await params;
  return proxyAPI(request, `/acme-accounts/${accountId}/verify`, { method: "POST" });
}
