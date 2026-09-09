export type Dashboard = {
  activeCertificates: number;
  expiringSoon: number;
  runningJobs: number;
  failedExecutions: number;
};

export type Certificate = {
  id: string;
  name: string;
  domains: string[];
  status: string;
  keyAlgorithm: string;
  validationMode: string;
  renewEnabled: boolean;
  notAfter: string | null;
  fingerprint: string;
  lastIssuedAt: string | null;
  lastError: string;
  createdAt: string;
};

export type Execution = {
  id: string;
  kind: string;
  status: string;
  trigger: string;
  certificate: string;
  target: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string;
};

export type CloudCredential = {
  id: string;
  name: string;
  provider: string;
  credentialHint: string;
  status: string;
  lastVerifiedAt: string | null;
  createdAt: string;
};

export type ACMEAccount = {
  id: string;
  name: string;
  directoryUrl: string;
  email: string;
  status: string;
  createdAt: string;
};

export type DNSAccount = {
  id: string;
  name: string;
  provider: string;
  cloudCredentialId: string;
  allowedZones: string[];
  status: string;
  lastVerifiedAt: string | null;
  createdAt: string;
};

export type DeploymentTarget = {
  id: string;
  name: string;
  cloudCredentialId: string;
  regionId: string;
  loadBalancerId: string;
  listenerId: string;
  listenerProtocol: string;
  status: string;
  createdAt: string;
};

export type CertificateDeployment = {
  id: string;
  certificateId: string;
  targetId: string;
  targetName: string;
  autoDeploy: boolean;
  enabled: boolean;
  lastDeployedAt: string | null;
  lastError: string;
};

export type ALBRegion = { id: string; name: string };
export type ALBLoadBalancer = { id: string; name: string; status: string; dnsName: string };
export type ALBListener = { id: string; port: number; protocol: string; description: string; status: string };

const apiBaseUrl = process.env.CERTFLOW_API_URL ?? "http://localhost:8080";

async function apiGet<T>(path: string, fallback: T): Promise<{ data: T; unavailable: boolean }> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/v1${path}`, { cache: "no-store" });
    if (!response.ok) {
      return { data: fallback, unavailable: true };
    }
    return { data: (await response.json()) as T, unavailable: false };
  } catch {
    return { data: fallback, unavailable: true };
  }
}

export function getDashboard() {
  return apiGet<Dashboard>("/dashboard", {
    activeCertificates: 0,
    expiringSoon: 0,
    runningJobs: 0,
    failedExecutions: 0,
  });
}

export async function getCertificates() {
  const response = await apiGet<{ data: Certificate[] }>("/certificates", { data: [] });
  return { certificates: response.data.data, unavailable: response.unavailable };
}

export async function getExecutions() {
  const response = await apiGet<{ data: Execution[] }>("/executions", { data: [] });
  return { executions: response.data.data, unavailable: response.unavailable };
}

export async function getCloudCredentials() {
  const response = await apiGet<{ data: CloudCredential[] }>("/cloud-credentials", { data: [] });
  return { credentials: response.data.data, unavailable: response.unavailable };
}

export async function getACMEAccounts() {
  const response = await apiGet<{ data: ACMEAccount[] }>("/acme-accounts", { data: [] });
  return { accounts: response.data.data, unavailable: response.unavailable };
}

export async function getDNSAccounts() {
  const response = await apiGet<{ data: DNSAccount[] }>("/dns-accounts", { data: [] });
  return { accounts: response.data.data, unavailable: response.unavailable };
}

export function getDeploymentTargets() {
  return apiGet<{ data: DeploymentTarget[] }>("/deployment-targets", { data: [] });
}

export function getCertificateDeployments() {
  return apiGet<{ data: CertificateDeployment[] }>("/certificate-deployments", { data: [] });
}
