import { NextResponse } from "next/server";
import { proxyAPI } from "@/lib/api-proxy";
const resources = new Set(["cloud-credentials", "acme-accounts", "dns-accounts", "deployment-targets"]);

export async function GET(request: Request, { params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;
  if (!resources.has(resource)) return NextResponse.json({ code: "not_found", message: "resource not found" }, { status: 404 });

  return proxyAPI(request, `/${resource}`);
}

export async function POST(request: Request, { params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;
  if (!resources.has(resource)) return NextResponse.json({ code: "not_found", message: "resource not found" }, { status: 404 });

  return proxyAPI(request, `/${resource}`, { method: "POST", body: await request.text() });
}
