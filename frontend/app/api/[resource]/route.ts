import { NextResponse } from "next/server";

const apiBaseUrl = process.env.CERTFLOW_API_URL ?? "http://localhost:8080";
const resources = new Set(["cloud-credentials", "acme-accounts", "dns-accounts"]);

export async function GET(_request: Request, { params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;
  if (!resources.has(resource)) return NextResponse.json({ code: "not_found", message: "resource not found" }, { status: 404 });

  const upstream = await fetch(`${apiBaseUrl}/api/v1/${resource}`, { cache: "no-store" });
  return new NextResponse(upstream.body, { status: upstream.status, headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;
  if (!resources.has(resource)) return NextResponse.json({ code: "not_found", message: "resource not found" }, { status: 404 });

  const upstream = await fetch(`${apiBaseUrl}/api/v1/${resource}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Request-ID": crypto.randomUUID() },
    body: await request.text(),
    cache: "no-store",
  });
  return new NextResponse(upstream.body, { status: upstream.status, headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" } });
}
