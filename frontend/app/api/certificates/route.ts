import { NextResponse } from "next/server";

const apiBaseUrl = process.env.CERTFLOW_API_URL ?? "http://localhost:8080";

export async function POST(request: Request) {
  const upstream = await fetch(`${apiBaseUrl}/api/v1/certificates`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Request-ID": crypto.randomUUID() },
    body: await request.text(),
    cache: "no-store",
  });

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
  });
}
