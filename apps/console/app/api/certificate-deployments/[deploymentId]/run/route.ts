import { proxyAPI } from "@/lib/api-proxy";
export async function POST(request: Request, { params }: { params: Promise<{ deploymentId: string }> }) { const { deploymentId } = await params; return proxyAPI(request, `/certificate-deployments/${deploymentId}/run`, { method: "POST" }); }
