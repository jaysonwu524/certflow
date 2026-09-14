"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, Input, ListBox, Select, TextArea } from "@heroui/react";
import { ArrowLeft, ArrowRight, Check, ShieldCheck } from "lucide-react";
import { ResourceModal, ModalCancelButton } from "@/components/resource-modal";
import { apiRequest } from "@/lib/api-client";
import type { ACMEAccount, DNSAccount } from "@/lib/api";

type ValidationMode = "auto" | "manual";
type CertificateWorkflowProps = { acmeAccounts: ACMEAccount[]; dnsAccounts: DNSAccount[] };

const steps = ["证书身份", "签发验证", "续期策略"] as const;

export function CertificateWorkflow({ acmeAccounts, dnsAccounts }: CertificateWorkflowProps) {
  const router = useRouter();
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
  const domainError = useMemo(() => validateDomains(domains), [domains]);
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
      if (!name.trim()) return setError("请输入证书名称");
      if (domains.length === 0) return setError("至少填写一个域名");
      if (domainError) return setError(domainError);
    }
    if (step === 1) {
      if (!acmeAccountId) return setError("请选择 ACME 账户");
      if (validationMode === "auto" && !dnsAccountId) return setError("自动 DNS 模式需要选择 DNS 账户");
    }
    setStep((current) => Math.min(current + 1, steps.length - 1));
  }

  async function submit() {
    setError("");
    if (!canSubmit) {
      setError("创建证书前，需要 ACME 账户；自动模式还需要 DNS 账户。");
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
      setError(requestError instanceof Error ? requestError.message : "无法创建证书配置");
    } finally {
      setPending(false);
    }
  }

  return (
    <ResourceModal
      isOpen={open}
      onOpenChange={(isOpen) => !isOpen && close()}
      size="wide"
      title="新建证书"
      description="创建后会自动排队签发；自动续期、SSL 上传和 ALB 更新在自动化中配置。"
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
              上一步
            </Button>
          ) : (
            <ModalCancelButton onPress={close} />
          )}
          {step < steps.length - 1 ? (
            <Button variant="primary" onPress={nextStep}>
              下一步
              <ArrowRight size={16} />
            </Button>
          ) : (
            <Button variant="primary" onPress={submit} isDisabled={pending}>
              <ShieldCheck size={16} />
              {pending ? "正在创建" : "创建并排队签发"}
            </Button>
          )}
        </div>
      }
    >
      <div className="workflow-steps" aria-label="证书创建步骤">
        {steps.map((label, index) => (
          <div
            className={`workflow-step ${index === step ? "workflow-step-active" : ""} ${index < step ? "workflow-step-complete" : ""}`}
            key={label}
          >
            <span>{index < step ? <Check size={14} /> : index + 1}</span>
            {label}
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
  return (
    <div className="workflow-panel">
      <div className="field-grid">
        <div className="field field-wide">
          <label htmlFor="certificate-name">名称</label>
          <Input
            id="certificate-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="production-web"
          />
        </div>
        <div className="field">
          <label htmlFor="certificate-key-algorithm">密钥算法</label>
          <Select
            selectedKey={keyAlgorithm}
            onSelectionChange={(key) => setKeyAlgorithm(String(key))}
            aria-label="密钥算法"
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
          <label htmlFor="certificate-domains">域名与 SAN</label>
          <TextArea
            id="certificate-domains"
            value={domainsText}
            onChange={(event) => setDomainsText(event.target.value)}
            placeholder={"example.com\n*.example.com\n*.api.example.com"}
          />
          <span className="field-help">
            每行一个域名。通配符只覆盖一层子域；三级域名请明确添加对应的 `*.api.example.com`。
          </span>
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
  return (
    <div className="workflow-panel">
      <div className="field-grid">
        <div className="field">
          <label htmlFor="certificate-acme">ACME 账户</label>
          <Select
            selectedKey={acmeAccountId}
            onSelectionChange={(key) => setAcmeAccountId(String(key))}
            aria-label="ACME 账户"
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
            <span className="field-help zone-error">请先配置 ACME 账户</span>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="certificate-dns">DNS 账户</label>
          <Select
            selectedKey={dnsAccountId}
            onSelectionChange={(key) => setDnsAccountId(String(key))}
            isDisabled={validationMode === "manual"}
            aria-label="DNS 账户"
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
            <span className="field-help">手动 TXT 模式无需 DNS 账户</span>
          ) : dnsAccounts.length === 0 ? (
            <span className="field-help zone-error">请先配置 DNS 账户</span>
          ) : null}
        </div>
        <div className="field field-wide">
          <label htmlFor="certificate-validation-mode">DNS-01 验证方式</label>
          <Select
            selectedKey={validationMode}
            onSelectionChange={(key) => setValidationMode(String(key) as ValidationMode)}
            aria-label="DNS-01 验证方式"
          >
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="auto">自动更新 DNS TXT</ListBox.Item>
                <ListBox.Item id="manual">手动添加 DNS TXT</ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
          <span className="field-help">手动模式会暂停签发并显示 TXT 记录，确认后继续校验。</span>
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
  return (
    <div className="workflow-panel">
      <div className="field-grid">
        <div className="field">
          <label htmlFor="certificate-renew-before">提前续期天数</label>
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
      <div className="workflow-note">
        证书本身不再单独配置自动续期。请在“自动化”中创建定期续期、SSL 上传或 ALB 更新任务。
      </div>
    </div>
  );
}

function validateDomains(domains: string[]) {
  const unique = new Set<string>();
  for (const domain of domains) {
    if (unique.has(domain)) return `域名重复：${domain}`;
    unique.add(domain);
    if (domain.length > 253 || !/^(\*\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain))
      return `域名格式无效：${domain}`;
  }
  return "";
}
