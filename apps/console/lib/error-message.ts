import type { TranslationKey } from "@/components/providers/locale-provider";

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;

// Workflow rows persist a stable code and an original diagnostic. Prefer the
// localized code, but keep provider diagnostics when CertFlow has no mapping.
const errorCodeKeys: Record<string, TranslationKey> = {
  worker_lease_expired: "error.workerLeaseExpired",
  certificate_issue_failed: "error.certificateIssueFailed",
  certificate_renew_failed: "error.certificateRenewFailed",
  automation_run_in_progress: "error.automationRunInProgress",
  cloud_credential_invalid: "error.cloudCredentialInvalid",
  cloud_credential_unavailable: "error.cloudCredentialUnavailable",
  dns_provider_unavailable: "error.dnsProviderUnavailable",
  aliyun_unavailable: "error.aliyunUnavailable",
  aliyun_name_duplicate: "error.aliyunNameDuplicate",
};

export function translateErrorCode(code: string, fallback: string, t: Translate) {
  return errorCodeKeys[code] ? t(errorCodeKeys[code]) : fallback;
}
