import { proxyAPI } from "@/lib/api-proxy";

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxyAPI(request, `/auth/${path.join("/")}`);
}

export async function POST(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxyAPI(request, `/auth/${path.join("/")}`, { method: "POST", body: await request.text() });
}
