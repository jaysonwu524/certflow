import { NextResponse } from "next/server";
const apiBaseUrl = process.env.CERTFLOW_API_URL ?? "http://localhost:8080";
export async function GET(_request: Request, { params }: { params: Promise<{ credentialId: string }> }) { const { credentialId } = await params; const response = await fetch(`${apiBaseUrl}/api/v1/cloud-credentials/${credentialId}/alb/regions`, { cache: "no-store" }); return new NextResponse(response.body, { status: response.status, headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" } }); }
