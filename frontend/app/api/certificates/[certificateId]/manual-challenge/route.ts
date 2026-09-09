import { NextResponse } from "next/server";

const apiBaseUrl = process.env.CERTFLOW_API_URL ?? "http://localhost:8080";

export async function GET(_request: Request, { params }: { params: Promise<{ certificateId: string }> }) {
  const { certificateId } = await params;
  const upstream = await fetch(`${apiBaseUrl}/api/v1/certificates/${certificateId}/manual-challenge`, { cache: "no-store" });
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
  });
}
