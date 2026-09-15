import { proxyAPI } from "@/lib/api-proxy";

export async function GET(request: Request) { return proxyAPI(request, "/settings/smtp"); }
export async function PUT(request: Request) { return proxyAPI(request, "/settings/smtp", { method: "PUT", body: await request.text() }); }
