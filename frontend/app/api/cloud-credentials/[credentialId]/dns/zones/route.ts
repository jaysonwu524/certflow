import { proxyAPI } from "@/lib/api-proxy";

export async function GET(request: Request, { params }: { params: Promise<{ credentialId: string }> }) {
  const { credentialId } = await params;
  return proxyAPI(request, `/cloud-credentials/${credentialId}/dns/zones`);
}
