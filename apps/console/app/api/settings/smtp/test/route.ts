import { proxyAPI } from "@/lib/api-proxy";

export async function POST(request: Request) { return proxyAPI(request, "/settings/smtp/test", { method: "POST" }); }
