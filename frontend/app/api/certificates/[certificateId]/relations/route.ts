import { proxyAPI } from "@/lib/api-proxy";

export async function GET(request: Request, { params }: { params: Promise<{ certificateId: string }> }) {
  const { certificateId } = await params;
  return proxyAPI(request, `/certificates/${certificateId}/relations`);
}
