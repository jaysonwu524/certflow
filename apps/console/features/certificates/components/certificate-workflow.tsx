"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, Input, ListBox, Select, TextArea } from "@heroui/react";
import { ArrowLeft, ArrowRight, Check, ShieldCheck } from "lucide-react";
import { ResourceModal, ModalCancelButton } from "@/components/ui/resource-modal";
import { apiRequest } from "@/lib/api-client";
import type { ACMEAccount, DNSAccount } from "@/lib/api";
import { useLocale, type TranslationKey } from "@/components/providers/locale-provider";

type ValidationMode = "auto" | "manual";
type CertificateWorkflowProps = { acmeAccounts: ACMEAccount[]; dnsAccounts: DNSAccount[] };

const stepKeys: TranslationKey[] = [
  "certificate.stepIdentity",
  "certificate.stepValidation",
  "certificate.stepRenewal",
];

export function CertificateWorkflow({ acmeAccounts, dnsAccounts }: CertificateWorkflowProps) {
  const router = useRouter();
  const { t } = useLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const open = searchParams.get("modal") === "create";
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [domainsText, setDomainsText] = useState("");
  const [keyAlgorithm, setKeyAlgorithm] = useState("ecdsa_p256");
  const [acmeAccountId, setAcmeAccountId] = useState("");
  const [dnsAccountId, setDnsAccountId] = useState("");
  const [validationMode, setValidationMode] = useState<ValidationMode>("auto");
  const [renewBeforeDays, setRenewBeforeDays] = useState("30");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const domains = useMemo(
    () =>
      domainsText
        .split(/[\n,]/)
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean),
    [domainsText],
  );
  const domainError = useMemo(() => validateDomains(domains, t), [domains, t]);
  const canSubmit = acmeAccounts.length > 0 && (validationMode === "manual" || dnsAccounts.length > 0);

  function close() {
    setStep(0);
    setError("");
    setName("");
    setDomainsText("");
    setAcmeAccountId("");
    setDnsAccountId("");
    const params = new URLSearchParams(searchParams.toString());
    params.delete("modal");
    router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
  }

  function nextStep() {
    setError("");
    if (step === 0) {
      if (!name.trim()) return setError(t("certificate.nameRequired"));
      if (domains.length === 0) return setError(t("certificate.domainRequired"));
      if (domainError) return setError(domainError);
    }
    if (step === 1) {
      if (!acmeAccountId) return setError(t("certificate.acmeRequired"));
      if (validationMode === "auto" && !dnsAccountId) return setError(t("certificate.dnsRequired"));
    }
    setStep((current) => Math.min(current + 1, stepKeys.length - 1));
  }

  async function submit() {
    setError("");
    if (!canSubmit) {
      setError(t("certificate.requirementsMissing"));
      return;
    }
    setPending(true);
    try {
      await apiRequest("/api/certificates", {
        method: "POST",
        body: {
          name: name.trim(),
          acmeAccountId,
          defaultDnsAccountId: validationMode === "auto" ? dnsAccountId : "",
          validationMode,
          domains,
          keyAlgorithm,
          renewBeforeDays: Number(renewBeforeDays),
        },
      });
      close();
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("certificate.createFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <ResourceModal
      isOpen={open}
      onOpenChange={(isOpen) => !isOpen && close()}
      size="wide"
      title={t("certificate.create")}
      description={t("certificate.createDescription")}
      footer={
        <div className="certificate-workflow-footer">
          {step > 0 ? (
            <Button
              variant="secondary"
              onPress={() => {
                setError("");
                setStep((current) => current - 1);
              }}
            >
              <ArrowLeft size={16} />
              {t("certificate.previous")}
            </Button>
          ) : (
            <ModalCancelButton onPress={close} />
          )}
          {step < stepKeys.length - 1 ? (
            <Button variant="primary" onPress={nextStep}>
              {t("certificate.next")}
              <ArrowRight size={16} />
            </Button>
          ) : (
            <Button variant="primary" onPress={submit} isDisabled={pending}>
              <ShieldCheck size={16} />
              {pending ? t("certificate.creating") : t("certificate.createAndQueue")}
            </Button>
          )}
        </div>
      }
    >
      <div className="workflow-steps" aria-label={t("certificate.creationSteps")}>
        {stepKeys.map((key, index) => (
          <div
            className={`workflow-step ${index === step ? "workflow-step-active" : ""} ${index < step ? "workflow-step-complete" : ""}`}
            key={key}
          >
            <span>{index < step ? <Check size={14} /> : index + 1}</span>
            {t(key)}
          </div>
        ))}
      </div>
      {step === 0 ? (
        <IdentityStep
          name={name}
          setName={setName}
          domainsText={domainsText}
          setDomainsText={setDomainsText}
          keyAlgorithm={keyAlgorithm}
          setKeyAlgorithm={setKeyAlgorithm}
          domainError={domainError}
        />
      ) : null}
      {step === 1 ? (
        <ValidationStep
          acmeAccounts={acmeAccounts}
          dnsAccounts={dnsAccounts}
          acmeAccountId={acmeAccountId}
          setAcmeAccountId={setAcmeAccountId}
          dnsAccountId={dnsAccountId}
          setDnsAccountId={setDnsAccountId}
          validationMode={validationMode}
          setValidationMode={setValidationMode}
        />
      ) : null}
      {step === 2 ? (
        <RenewalStep renewBeforeDays={renewBeforeDays} setRenewBeforeDays={setRenewBeforeDays} />
      ) : null}
      {error ? (
        <div className="form-error" role="alert" aria-live="polite">
          {error}
        </div>
      ) : null}
    </ResourceModal>
  );
}

function IdentityStep({
  name,
  setName,
  domainsText,
  setDomainsText,
  keyAlgorithm,
  setKeyAlgorithm,
  domainError,
}: {
  name: string;
  setName: (value: string) => void;
  domainsText: string;
  setDomainsText: (value: string) => void;
  keyAlgorithm: string;
  setKeyAlgorithm: (value: string) => void;
  domainError: string;
}) {
  const { t } = useLocale();
  return (
    <div className="workflow-panel">
      <div className="field-grid">
        <div className="field field-wide">
          <label htmlFor="certificate-name">{t("common.name")}</label>
          <Input
            id="certificate-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="production-web"
          />
        </div>
        <div className="field">
          <label htmlFor="certificate-key-algorithm">{t("certificate.keyAlgorithm")}</label>
          <Select
            selectedKey={keyAlgorithm}
            onSelectionChange={(key) => setKeyAlgorithm(String(key))}
            aria-label={t("certificate.keyAlgorithm")}
          >
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="ecdsa_p256">ECDSA P-256</ListBox.Item>
                <ListBox.Item id="ecdsa_p384">ECDSA P-384</ListBox.Item>
                <ListBox.Item id="rsa_2048">RSA 2048</ListBox.Item>
                <ListBox.Item id="rsa_4096">RSA 4096</ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
        </div>
        <div className="field field-wide">
          <label htmlFor="certificate-domains">{t("certificate.domains")}</label>
          <TextArea
            id="certificate-domains"
            value={domainsText}
            onChange={(event) => setDomainsText(event.target.value)}
            placeholder={"example.com\n*.example.com\n*.api.example.com"}
          />
          <span className="field-help">{t("certificate.domainHint")}</span>
          {domainError ? (
            <span className="field-help zone-error" role="alert">
              {domainError}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ValidationStep({
  acmeAccounts,
  dnsAccounts,
  acmeAccountId,
  setAcmeAccountId,
  dnsAccountId,
  setDnsAccountId,
  validationMode,
  setValidationMode,
}: {
  acmeAccounts: ACMEAccount[];
  dnsAccounts: DNSAccount[];
  acmeAccountId: string;
  setAcmeAccountId: (value: string) => void;
  dnsAccountId: string;
  setDnsAccountId: (value: string) => void;
  validationMode: ValidationMode;
  setValidationMode: (value: ValidationMode) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="workflow-panel">
      <div className="field-grid">
        <div className="field">
          <label htmlFor="certificate-acme">{t("acme.tableLabel")}</label>
          <Select
            selectedKey={acmeAccountId}
            onSelectionChange={(key) => setAcmeAccountId(String(key))}
            aria-label={t("acme.tableLabel")}
          >
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {acmeAccounts.map((account) => (
                  <ListBox.Item id={account.id} key={account.id}>
                    {account.name}
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
          {acmeAccounts.length === 0 ? (
            <span className="field-help zone-error">{t("certificate.noAcme")}</span>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="certificate-dns">{t("dns.tableLabel")}</label>
          <Select
            selectedKey={dnsAccountId}
            onSelectionChange={(key) => setDnsAccountId(String(key))}
            isDisabled={validationMode === "manual"}
            aria-label={t("dns.tableLabel")}
          >
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {dnsAccounts.map((account) => (
                  <ListBox.Item id={account.id} key={account.id}>
                    {account.name}
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
          {validationMode === "manual" ? (
            <span className="field-help">{t("certificate.manualNoDns")}</span>
          ) : dnsAccounts.length === 0 ? (
            <span className="field-help zone-error">{t("certificate.noDns")}</span>
          ) : null}
        </div>
        <div className="field field-wide">
          <label htmlFor="certificate-validation-mode">{t("certificate.validationMode")}</label>
          <Select
            selectedKey={validationMode}
            onSelectionChange={(key) => setValidationMode(String(key) as ValidationMode)}
            aria-label={t("certificate.validationMode")}
          >
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="auto">{t("certificate.validationAuto")}</ListBox.Item>
                <ListBox.Item id="manual">{t("certificate.validationManual")}</ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
          <span className="field-help">{t("certificate.validationHint")}</span>
        </div>
      </div>
    </div>
  );
}

function RenewalStep({
  renewBeforeDays,
  setRenewBeforeDays,
}: {
  renewBeforeDays: string;
  setRenewBeforeDays: (value: string) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="workflow-panel">
      <div className="field-grid">
        <div className="field">
          <label htmlFor="certificate-renew-before">{t("certificate.renewBeforeDays")}</label>
          <Input
            id="certificate-renew-before"
            type="number"
            min={1}
            max={90}
            value={renewBeforeDays}
            onChange={(event) => setRenewBeforeDays(event.target.value)}
          />
        </div>
      </div>
      <div className="workflow-note">{t("certificate.renewalHint")}</div>
    </div>
  );
}

function validateDomains(domains: string[], t: ReturnType<typeof useLocale>["t"]) {
  const unique = new Set<string>();
  const wildcards = new Map<string, string>();
  for (const domain of domains) {
    if (unique.has(domain)) return t("certificate.domainDuplicate", { domain });
    unique.add(domain);
    if (domain.length > 253 || !/^(\*\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain))
      return t("certificate.domainInvalid", { domain });
    if (domain.startsWith("*.")) wildcards.set(domain.slice(2), domain);
  }
  for (const domain of domains) {
    if (domain.startsWith("*.")) continue;
    const [, ...parentLabels] = domain.split(".");
    const wildcard = wildcards.get(parentLabels.join("."));
    if (wildcard) return t("certificate.domainCovered", { domain, wildcard });
  }
  return "";
}
