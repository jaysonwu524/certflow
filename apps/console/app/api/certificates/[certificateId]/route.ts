import { proxyAPI } from "@/lib/api-proxy";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ certificateId: string }> },
) {
  const { certificateId } = await params;
  return proxyAPI(request, `/certificates/${certificateId}`);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ certificateId: string }> },
) {
  const { certificateId } = await params;
  return proxyAPI(request, `/certificates/${certificateId}`, {
    method: "PATCH",
    body: await request.text(),
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ certificateId: string }> },
) {
  const { certificateId } = await params;
  return proxyAPI(request, `/certificates/${certificateId}`, { method: "DELETE" });
}
