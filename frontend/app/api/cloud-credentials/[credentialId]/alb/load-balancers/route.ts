import { NextRequest } from "next/server";
import { proxyAPI } from "@/lib/api-proxy";
export async function GET(request: NextRequest, { params }: { params: Promise<{ credentialId: string }> }) { const { credentialId } = await params; const regionId = request.nextUrl.searchParams.get("regionId") ?? ""; return proxyAPI(request, `/cloud-credentials/${credentialId}/alb/load-balancers?regionId=${encodeURIComponent(regionId)}`); }
