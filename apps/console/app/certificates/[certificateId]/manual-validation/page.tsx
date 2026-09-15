import { redirect } from "next/navigation";

/** Backward-compatible deep link; the workflow is rendered in the detail Modal. */
export default async function ManualValidationRedirect({
  params,
}: {
  params: Promise<{ certificateId: string }>;
}) {
  const { certificateId } = await params;
  redirect(`/certificates?selected=${encodeURIComponent(certificateId)}&mode=manual-validation`);
}
