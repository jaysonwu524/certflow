import { proxyAPI } from "@/lib/api-proxy";

export async function GET(request: Request) { return proxyAPI(request, "/automations"); }

export async function POST(request: Request) { return proxyAPI(request, "/automations", { method: "POST", body: await request.text() }); }
