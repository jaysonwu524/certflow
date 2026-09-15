import type { Metadata } from "next";
import { MarketingHome } from "@/components/marketing-home";

export const metadata: Metadata = {
  title: "CertFlow - 证书生命周期运营平台",
  description: "集中管理 ACME、DNS 与云平台凭证，自动完成证书签发、续期、云证书上传与 ALB 更新。",
};

export default function Home() {
  return <MarketingHome />;
}
