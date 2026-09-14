import { proxyAPI } from "@/lib/api-proxy";

export async function POST(request: Request, { params }: { params: Promise<{ certificateId: string }> }) {
  const { certificateId } = await params;
  return proxyAPI(request, `/certificates/${certificateId}/issue`, { method: "POST" });
}
