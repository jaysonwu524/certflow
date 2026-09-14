import { proxyAPI } from "@/lib/api-proxy";

export async function GET(request: Request, { params }: { params: Promise<{ automationId: string }> }) {
  const { automationId } = await params;
  return proxyAPI(request, `/automations/${automationId}`);
}
export async function PATCH(request: Request, { params }: { params: Promise<{ automationId: string }> }) {
  const { automationId } = await params;
  return proxyAPI(request, `/automations/${automationId}`, { method: "PATCH", body: await request.text() });
}
export async function DELETE(request: Request, { params }: { params: Promise<{ automationId: string }> }) {
  const { automationId } = await params;
  return proxyAPI(request, `/automations/${automationId}`, { method: "DELETE" });
}
