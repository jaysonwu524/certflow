import { NextResponse } from "next/server";
import { proxyAPI } from "@/lib/api-proxy";

const resources = new Set(["cloud-credentials", "acme-accounts", "dns-accounts", "deployment-targets"]);

async function resolveResource(params: Promise<{ resource: string; resourceId: string }>) {
  const { resource, resourceId } = await params;
  if (!resources.has(resource)) return null;
  return { resource, resourceId };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ resource: string; resourceId: string }> },
) {
  const target = await resolveResource(params);
  if (!target)
    return NextResponse.json({ code: "not_found", message: "resource not found" }, { status: 404 });
  return proxyAPI(request, `/${target.resource}/${target.resourceId}`);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ resource: string; resourceId: string }> },
) {
  const target = await resolveResource(params);
  if (!target)
    return NextResponse.json({ code: "not_found", message: "resource not found" }, { status: 404 });
  return proxyAPI(request, `/${target.resource}/${target.resourceId}`, {
    method: "PATCH",
    body: await request.text(),
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ resource: string; resourceId: string }> },
) {
  const target = await resolveResource(params);
  if (!target)
    return NextResponse.json({ code: "not_found", message: "resource not found" }, { status: 404 });
  return proxyAPI(request, `/${target.resource}/${target.resourceId}`, { method: "DELETE" });
}
