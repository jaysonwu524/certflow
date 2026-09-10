"use client";

import { useEffect, useState } from "react";
import { Button } from "@heroui/react";
import { CloudCog, Play, Plus, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { StatusTag } from "@/components/status-tag";
import type { ALBListener, ALBLoadBalancer, ALBRegion, AutomationTask, Certificate, CloudCredential, DeploymentTarget } from "@/lib/api";

type ActionType = "renew_certificate" | "upload_ssl" | "deploy_alb";
const actionLabels: Record<ActionType, string> = { renew_certificate: "定期续期证书", upload_ssl: "上传 SSL 证书管理", deploy_alb: "更新 ALB" };

export function DeploymentManager({ credentials, certificates, initialTargets, initialAutomations }: { credentials: CloudCredential[]; certificates: Certificate[]; initialTargets: DeploymentTarget[]; initialAutomations: AutomationTask[] }) {
  const router = useRouter();
  const [targets, setTargets] = useState(initialTargets);
  const [automations, setAutomations] = useState(initialAutomations);
  const [credentialId, setCredentialId] = useState(""); const [regionId, setRegionId] = useState(""); const [regions, setRegions] = useState<ALBRegion[]>([]);
  const [loadBalancers, setLoadBalancers] = useState<ALBLoadBalancer[]>([]); const [loadBalancerId, setLoadBalancerId] = useState(""); const [listeners, setListeners] = useState<ALBListener[]>([]); const [listenerId, setListenerId] = useState("");
  const [targetName, setTargetName] = useState(""); const [taskName, setTaskName] = useState(""); const [certificateId, setCertificateId] = useState("");
  const [actionType, setActionType] = useState<ActionType>("renew_certificate"); const [intervalMinutes, setIntervalMinutes] = useState("1440"); const [uploadCredentialID, setUploadCredentialID] = useState(""); const [selectedTargetIDs, setSelectedTargetIDs] = useState<string[]>([]);
  const [error, setError] = useState(""); const [pending, setPending] = useState(false);

  useEffect(() => { if (!credentialId) { setRegions([]); return; } fetch(`/api/cloud-credentials/${credentialId}/alb/regions`).then((r) => r.json()).then((body) => setRegions(body.data ?? [])).catch(() => setError("无法读取阿里云地域")); }, [credentialId]);
  useEffect(() => { setLoadBalancers([]); setListeners([]); setLoadBalancerId(""); setListenerId(""); if (!credentialId || !regionId) return; fetch(`/api/cloud-credentials/${credentialId}/alb/load-balancers?regionId=${encodeURIComponent(regionId)}`).then((r) => r.json()).then((body) => setLoadBalancers(body.data ?? [])).catch(() => setError("无法读取 ALB")); }, [credentialId, regionId]);
  useEffect(() => { setListeners([]); setListenerId(""); if (!credentialId || !regionId || !loadBalancerId) return; fetch(`/api/cloud-credentials/${credentialId}/alb/load-balancers/${loadBalancerId}/listeners?regionId=${encodeURIComponent(regionId)}`).then((r) => r.json()).then((body) => setListeners(body.data ?? [])).catch(() => setError("无法读取监听器")); }, [credentialId, regionId, loadBalancerId]);

  async function createTarget(event: React.FormEvent) {
    event.preventDefault(); setPending(true); setError(""); const listener = listeners.find((item) => item.id === listenerId);
    if (!listener || !["HTTPS", "QUIC"].includes(listener.protocol)) { setError("只能选择 HTTPS 或 QUIC 监听器"); setPending(false); return; }
    const response = await fetch("/api/deployment-targets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: targetName, cloudCredentialId: credentialId, regionId, loadBalancerId, listenerId }) });
    if (!response.ok) { setError(await readError(response, "无法保存 ALB 目标")); setPending(false); return; }
    const target = await response.json(); setTargets((items) => [{ id: target.id, name: targetName, cloudCredentialId: credentialId, regionId, loadBalancerId, listenerId, listenerProtocol: listener.protocol, status: "active", createdAt: new Date().toISOString() }, ...items]); setTargetName(""); setPending(false); router.refresh();
  }

  async function createAutomation(event: React.FormEvent) {
    event.preventDefault(); setPending(true); setError("");
    if (!certificateId) { setError("请选择证书"); setPending(false); return; }
    if (actionType === "upload_ssl" && !uploadCredentialID) { setError("请选择用于上传 SSL 证书的阿里云凭证"); setPending(false); return; }
    if (actionType === "deploy_alb" && selectedTargetIDs.length === 0) { setError("请选择至少一个 ALB 目标"); setPending(false); return; }
    const response = await fetch("/api/automations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: taskName, certificateId, actionType, intervalMinutes: actionType === "renew_certificate" ? Number(intervalMinutes) : 60, cloudCredentialId: actionType === "upload_ssl" ? uploadCredentialID : "", deploymentTargetIds: actionType === "deploy_alb" ? selectedTargetIDs : [], enabled: true }) });
    if (!response.ok) { setError(await readError(response, "无法创建自动化任务")); setPending(false); return; }
    setTaskName(""); setSelectedTargetIDs([]); setUploadCredentialID(""); setPending(false); router.refresh();
  }

  async function runAutomation(id: string) { const response = await fetch(`/api/automations/${id}/run`, { method: "POST" }); if (!response.ok) { setError(await readError(response, "无法立即执行自动化任务")); return; } const body = await response.json().catch(() => ({ status: "queued" })) as { status?: string }; setAutomations((items) => items.map((item) => item.id === id ? { ...item, lastStatus: body.status === "waiting_for_certificate" ? "skipped" : "queued" } : item)); router.refresh(); }

  return <div className="configuration-layout">
    <form className="form-section configuration-form" onSubmit={createAutomation}><h2><RotateCw size={17} /> 新建自动化任务</h2><div className="field-grid">
      <div className="field field-wide"><label htmlFor="automation-name">任务名称</label><input id="automation-name" value={taskName} onChange={(e) => setTaskName(e.target.value)} required placeholder="production-certificate-sync" /></div>
      <div className="field"><label htmlFor="automation-certificate">证书</label><select id="automation-certificate" value={certificateId} onChange={(e) => setCertificateId(e.target.value)} required><option value="">选择证书</option>{certificates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
      <div className="field"><label htmlFor="automation-action">自动化动作</label><select id="automation-action" value={actionType} onChange={(e) => { setActionType(e.target.value as ActionType); setSelectedTargetIDs([]); }}><option value="renew_certificate">定期续期证书</option><option value="upload_ssl">上传 SSL 证书管理</option><option value="deploy_alb">更新 ALB</option></select></div>
      {actionType === "renew_certificate" ? <div className="field"><label htmlFor="automation-interval">检查周期</label><select id="automation-interval" value={intervalMinutes} onChange={(e) => setIntervalMinutes(e.target.value)}><option value="60">每小时</option><option value="360">每 6 小时</option><option value="720">每 12 小时</option><option value="1440">每天</option><option value="10080">每周</option></select><span className="field-help">进入证书续期窗口后才会申请新证书。</span></div> : null}
      {actionType === "upload_ssl" ? <div className="field field-wide"><label htmlFor="upload-credential">阿里云凭证</label><select id="upload-credential" value={uploadCredentialID} onChange={(e) => setUploadCredentialID(e.target.value)} required><option value="">选择用于上传的阿里云凭证</option>{credentials.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.credentialHint})</option>)}</select><span className="field-help">任务创建后立即上传当前版本；每次证书更新后自动上传新版本。</span></div> : null}
      {actionType === "deploy_alb" ? <div className="field field-wide"><span className="field-label">ALB 目标</span><div className="target-picker" role="group" aria-label="选择 ALB 目标">{targets.length === 0 ? <span className="field-help">请先在下方创建 ALB 部署目标。</span> : targets.map((target) => <label className="target-option" key={target.id}><input type="checkbox" checked={selectedTargetIDs.includes(target.id)} onChange={(event) => setSelectedTargetIDs((current) => event.target.checked ? [...current, target.id] : current.filter((id) => id !== target.id))} /><span>{target.name}<small>{target.regionId} · {target.loadBalancerId} · {target.listenerProtocol}</small></span></label>)}</div><span className="field-help">任务创建后立即上传当前版本并更新监听器；每次证书更新后自动重复执行。</span></div> : null}
    </div><div className="form-actions"><Button type="submit" variant="primary" isDisabled={pending}><Plus size={16} /> {pending ? "正在保存" : "保存自动化任务"}</Button></div></form>
    {error ? <div className="form-error">{error}</div> : null}
    <section className="panel"><div className="panel-header"><h2>自动化任务</h2></div>{automations.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>名称</th><th>证书</th><th>动作</th><th>周期</th><th>目标</th><th>最近状态</th><th>操作</th></tr></thead><tbody>{automations.map((item) => <tr key={item.id}><td className="row-title">{item.name}</td><td className="muted">{item.certificateName}</td><td>{actionLabels[item.actionType]}</td><td className="muted">{item.actionType === "renew_certificate" ? formatInterval(item.intervalMinutes) : "证书更新时"}</td><td className="muted">{item.actionType === "deploy_alb" ? item.targetCount : "-"}</td><td><StatusTag status={item.lastStatus} />{item.lastError ? <div className="table-error">{item.lastError}</div> : null}</td><td><Button variant="tertiary" onPress={() => runAutomation(item.id)}><Play size={15} /> 立即执行</Button></td></tr>)}</tbody></table></div> : <div className="empty-state">尚未配置自动化任务。</div>}</section>
    <form className="form-section configuration-form" onSubmit={createTarget}><h2><CloudCog size={17} /> 新建 ALB 部署目标</h2><div className="field-grid"><div className="field field-wide"><label htmlFor="target-name">名称</label><input id="target-name" value={targetName} onChange={(e) => setTargetName(e.target.value)} required placeholder="production-alb" /></div><div className="field"><label htmlFor="target-credential">云凭证</label><select id="target-credential" value={credentialId} onChange={(e) => setCredentialId(e.target.value)} required><option value="">选择阿里云凭证</option>{credentials.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.credentialHint})</option>)}</select></div><div className="field"><label htmlFor="target-region">地域</label><select id="target-region" value={regionId} onChange={(e) => setRegionId(e.target.value)} required disabled={!regions.length}><option value="">先选择地域</option>{regions.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.id})</option>)}</select></div><div className="field"><label htmlFor="target-alb">ALB</label><select id="target-alb" value={loadBalancerId} onChange={(e) => setLoadBalancerId(e.target.value)} required disabled={!loadBalancers.length}><option value="">选择 ALB</option>{loadBalancers.map((item) => <option key={item.id} value={item.id}>{item.name || item.id} · {item.status}</option>)}</select></div><div className="field"><label htmlFor="target-listener">HTTPS 监听器</label><select id="target-listener" value={listenerId} onChange={(e) => setListenerId(e.target.value)} required disabled={!listeners.length}><option value="">选择监听器</option>{listeners.map((item) => <option key={item.id} value={item.id} disabled={!['HTTPS', 'QUIC'].includes(item.protocol)}>{item.protocol}:{item.port} · {item.description || item.id}</option>)}</select><span className="field-help">HTTP 监听器不会出现在可提交的部署目标中。</span></div></div><div className="form-actions"><Button type="submit" variant="primary" isDisabled={pending}><Plus size={16} /> 保存部署目标</Button></div></form>
    <section className="panel"><div className="panel-header"><h2>ALB 部署目标</h2></div>{targets.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>名称</th><th>地域 / ALB</th><th>监听器</th><th>状态</th></tr></thead><tbody>{targets.map((item) => <tr key={item.id}><td className="row-title">{item.name}</td><td className="muted">{item.regionId}<br />{item.loadBalancerId}</td><td className="muted">{item.listenerProtocol} · {item.listenerId}</td><td><StatusTag status={item.status} /></td></tr>)}</tbody></table></div> : <div className="empty-state">尚未配置 ALB 部署目标。</div>}</section>
  </div>;
}

function formatInterval(minutes: number) { if (minutes % 10080 === 0) return `${minutes / 10080} 周`; if (minutes % 1440 === 0) return `${minutes / 1440} 天`; if (minutes % 60 === 0) return `${minutes / 60} 小时`; return `${minutes} 分钟`; }
async function readError(response: Response, fallback: string) { const body = (await response.json().catch(() => null)) as { message?: string } | null; return body?.message ?? fallback; }
