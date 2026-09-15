import { NextResponse } from "next/server";
import { proxyAPI } from "@/lib/api-proxy";

const actions = new Set(["verify", "enable", "disable"]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ credentialId: string; action: string }> },
) {
  const { credentialId, action } = await params;
  if (!actions.has(action)) {
    return NextResponse.json({ code: "not_found", message: "action not found" }, { status: 404 });
  }
  return proxyAPI(request, `/cloud-credentials/${credentialId}/${action}`, { method: "POST" });
}
