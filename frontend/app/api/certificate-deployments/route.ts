import { proxyAPI } from "@/lib/api-proxy";
export async function GET(request: Request) { return proxyAPI(request, "/certificate-deployments"); }
export async function POST(request: Request) { return proxyAPI(request, "/certificate-deployments", { method: "POST", body: await request.text() }); }
