"use client";

import { useEffect, useState } from "react";
import { Button } from "@heroui/react";
import { CloudCog, Play, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { StatusTag } from "@/components/status-tag";
import type { ALBListener, ALBLoadBalancer, ALBRegion, Certificate, CertificateDeployment, CloudCredential, DeploymentTarget } from "@/lib/api";

export function DeploymentManager({ credentials, certificates, initialTargets, initialDeployments }: { credentials: CloudCredential[]; certificates: Certificate[]; initialTargets: DeploymentTarget[]; initialDeployments: CertificateDeployment[] }) {
  const router = useRouter();
  const [targets, setTargets] = useState(initialTargets);
  const [deployments, setDeployments] = useState(initialDeployments);
  const [credentialId, setCredentialId] = useState("");
  const [regionId, setRegionId] = useState("");
  const [regions, setRegions] = useState<ALBRegion[]>([]);
  const [loadBalancers, setLoadBalancers] = useState<ALBLoadBalancer[]>([]);
  const [loadBalancerId, setLoadBalancerId] = useState("");
  const [listeners, setListeners] = useState<ALBListener[]>([]);
  const [listenerId, setListenerId] = useState("");
  const [name, setName] = useState("");
  const [certificateId, setCertificateId] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => { if (!credentialId) { setRegions([]); return; } fetch(`/api/cloud-credentials/${credentialId}/alb/regions`).then((r) => r.json()).then((body) => setRegions(body.data ?? [])).catch(() => setError("无法读取阿里云地域")); }, [credentialId]);
  useEffect(() => { setLoadBalancers([]); setListeners([]); setLoadBalancerId(""); setListenerId(""); if (!credentialId || !regionId) return; fetch(`/api/cloud-credentials/${credentialId}/alb/load-balancers?regionId=${encodeURIComponent(regionId)}`).then((r) => r.json()).then((body) => setLoadBalancers(body.data ?? [])).catch(() => setError("无法读取 ALB")); }, [credentialId, regionId]);
  useEffect(() => { setListeners([]); setListenerId(""); if (!credentialId || !regionId || !loadBalancerId) return; fetch(`/api/cloud-credentials/${credentialId}/alb/load-balancers/${loadBalancerId}/listeners?regionId=${encodeURIComponent(regionId)}`).then((r) => r.json()).then((body) => setListeners(body.data ?? [])).catch(() => setError("无法读取监听器")); }, [credentialId, regionId, loadBalancerId]);

  async function createTarget(event: React.FormEvent) {
    event.preventDefault(); setPending(true); setError("");
    const listener = listeners.find((item) => item.id === listenerId);
    if (!listener || !["HTTPS", "QUIC"].includes(listener.protocol)) { setError("只能选择 HTTPS 或 QUIC 监听器"); setPending(false); return; }
    const response = await fetch("/api/deployment-targets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, cloudCredentialId: credentialId, regionId, loadBalancerId, listenerId }) });
    if (!response.ok) { setError(((await response.json().catch(() => null)) as { message?: string } | null)?.message ?? "无法保存部署目标"); setPending(false); return; }
    const target = await response.json(); setTargets((items) => [{ id: target.id, name, cloudCredentialId: credentialId, regionId, loadBalancerId, listenerId, listenerProtocol: listener.protocol, status: "active", createdAt: new Date().toISOString() }, ...items]); setName(""); setPending(false); router.refresh();
  }

  async function bindCertificate(targetId: string) {
    if (!certificateId) { setError("请先选择证书"); return; }
    const response = await fetch("/api/certificate-deployments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ certificateId, targetId, autoDeploy: true }) });
    if (!response.ok) { setError(((await response.json().catch(() => null)) as { message?: string } | null)?.message ?? "无法绑定证书"); return; }
    router.refresh();
  }

  async function run(id: string) { const response = await fetch(`/api/certificate-deployments/${id}/run`, { method: "POST" }); if (!response.ok) setError("无法排队部署"); else setDeployments((items) => items); }

  return <div className="configuration-layout">
    <form className="form-section configuration-form" onSubmit={createTarget}><h2><CloudCog size={17} /> 新建 ALB 部署目标</h2><div className="field-grid">
      <div className="field field-wide"><label htmlFor="target-name">名称</label><input id="target-name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="production-alb" /></div>
      <div className="field"><label htmlFor="target-credential">云凭证</label><select id="target-credential" value={credentialId} onChange={(e) => setCredentialId(e.target.value)} required><option value="">选择阿里云凭证</option>{credentials.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.credentialHint})</option>)}</select></div>
      <div className="field"><label htmlFor="target-region">地域</label><select id="target-region" value={regionId} onChange={(e) => setRegionId(e.target.value)} required disabled={!regions.length}><option value="">先选择地域</option>{regions.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.id})</option>)}</select></div>
      <div className="field"><label htmlFor="target-alb">ALB</label><select id="target-alb" value={loadBalancerId} onChange={(e) => setLoadBalancerId(e.target.value)} required disabled={!loadBalancers.length}><option value="">选择 ALB</option>{loadBalancers.map((item) => <option key={item.id} value={item.id}>{item.name || item.id} · {item.status}</option>)}</select></div>
      <div className="field"><label htmlFor="target-listener">HTTPS 监听器</label><select id="target-listener" value={listenerId} onChange={(e) => setListenerId(e.target.value)} required disabled={!listeners.length}><option value="">选择监听器</option>{listeners.map((item) => <option key={item.id} value={item.id} disabled={!['HTTPS', 'QUIC'].includes(item.protocol)}>{item.protocol}:{item.port} · {item.description || item.id}</option>)}</select><span className="field-help">HTTP 监听器不会出现在可提交的部署目标中。</span></div>
    </div><div className="form-actions"><Button type="submit" variant="primary" isDisabled={pending}><Plus size={16} /> 保存部署目标</Button></div></form>
    {error ? <div className="form-error">{error}</div> : null}
    <section className="panel"><div className="panel-header"><h2>部署目标</h2></div>{targets.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>名称</th><th>地域 / ALB</th><th>监听器</th><th>状态</th></tr></thead><tbody>{targets.map((item) => <tr key={item.id}><td className="row-title">{item.name}</td><td className="muted">{item.regionId}<br />{item.loadBalancerId}</td><td className="muted">{item.listenerProtocol} · {item.listenerId}</td><td><StatusTag status={item.status} /></td></tr>)}</tbody></table></div> : <div className="empty-state">尚未配置 ALB 部署目标。</div>}</section>
    <section className="panel"><div className="panel-header"><h2>证书部署绑定</h2><div className="field-inline"><select aria-label="选择证书" value={certificateId} onChange={(e) => setCertificateId(e.target.value)}><option value="">选择证书</option>{certificates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div></div>{deployments.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>目标</th><th>自动部署</th><th>上次部署</th><th>操作</th></tr></thead><tbody>{deployments.map((item) => <tr key={item.id}><td className="row-title">{item.targetName}</td><td>{item.autoDeploy ? "已开启" : "已关闭"}</td><td className="muted">{item.lastDeployedAt ? new Date(item.lastDeployedAt).toLocaleString() : item.lastError || "尚未部署"}</td><td><Button variant="tertiary" onPress={() => run(item.id)}><Play size={15} /> 立即部署</Button></td></tr>)}</tbody></table></div> : <div className="empty-state">保存目标后，在此绑定证书。</div>}</section>
  </div>;
}
