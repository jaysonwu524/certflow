import { redirect } from "next/navigation";

/** 保留旧链接，统一进入证书列表内的 URL 驱动创建流程。 */
export default function NewCertificatePage() {
  redirect("/certificates?modal=create");
}
