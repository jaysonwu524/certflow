import { proxyAPI } from "@/lib/api-proxy";

export async function GET(request: Request, { params }: { params: Promise<{ automationId: string }> }) {
  const { automationId } = await params;
  return proxyAPI(request, `/automations/${automationId}/runs`);
}
