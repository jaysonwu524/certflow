import { NextResponse } from "next/server";
import { proxyAPI } from "@/lib/api-proxy";

const actions = new Set(["verify", "enable", "disable"]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string; action: string }> },
) {
  const { accountId, action } = await params;
  if (!actions.has(action)) {
    return NextResponse.json({ code: "not_found", message: "action not found" }, { status: 404 });
  }
  return proxyAPI(request, `/dns-accounts/${accountId}/${action}`, { method: "POST" });
}
