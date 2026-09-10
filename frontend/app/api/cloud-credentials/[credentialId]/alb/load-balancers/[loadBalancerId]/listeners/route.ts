import { NextRequest } from "next/server";
import { proxyAPI } from "@/lib/api-proxy";
export async function GET(request: NextRequest, { params }: { params: Promise<{ credentialId: string; loadBalancerId: string }> }) { const { credentialId, loadBalancerId } = await params; const regionId = request.nextUrl.searchParams.get("regionId") ?? ""; return proxyAPI(request, `/cloud-credentials/${credentialId}/alb/load-balancers/${loadBalancerId}/listeners?regionId=${encodeURIComponent(regionId)}`); }
