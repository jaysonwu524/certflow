"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Checkbox, Input, ListBox, Select, Table, Tabs } from "@heroui/react";
import { CloudCog, Play, Plus, RefreshCw, RotateCw, Search, Trash2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { StatusTag } from "@/components/status-tag";
import { ModalCancelButton, ResourceModal } from "@/components/resource-modal";
import { ResourcePagination } from "@/components/resource-pagination";
import { ResourceEmptyState } from "@/components/resource-empty-state";
import { TableActions } from "@/components/table-actions";
import { formatDateTime } from "@/lib/presentation";
import type {
  ALBListener,
  ALBLoadBalancer,
  ALBRegion,
  AutomationRun,
  AutomationTask,
  Certificate,
  CloudCredential,
  DeploymentTarget,
} from "@/lib/api";

type ActionType = "renew_certificate" | "upload_ssl" | "deploy_alb";
const actionLabels: Record<ActionType, string> = {
  renew_certificate: "定期续期证书",
  upload_ssl: "上传 SSL 证书管理",
  deploy_alb: "更新 ALB",
};

export function DeploymentManager({
  credentials,
  certificates,
  initialTargets,
  initialAutomations,
}: {
  credentials: CloudCredential[];
  certificates: Certificate[];
  initialTargets: DeploymentTarget[];
  initialAutomations: AutomationTask[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [targets, setTargets] = useState(initialTargets);
  const [automations, setAutomations] = useState(initialAutomations);
  const [automationOpen, setAutomationOpen] = useState(false);
  const [editingAutomationId, setEditingAutomationId] = useState("");
  const [targetOpen, setTargetOpen] = useState(false);
  const [editingTargetId, setEditingTargetId] = useState("");
  const [credentialId, setCredentialId] = useState("");
  const [regionId, setRegionId] = useState("");
  const [regions, setRegions] = useState<ALBRegion[]>([]);
  const [loadBalancers, setLoadBalancers] = useState<ALBLoadBalancer[]>([]);
  const [loadBalancerId, setLoadBalancerId] = useState("");
  const [listeners, setListeners] = useState<ALBListener[]>([]);
  const [listenerId, setListenerId] = useState("");
  const [targetName, setTargetName] = useState("");
  const [taskName, setTaskName] = useState("");
  const [certificateId, setCertificateId] = useState("");
  const [actionType, setActionType] = useState<ActionType>("renew_certificate");
  const [intervalMinutes, setIntervalMinutes] = useState("1440");
  const [uploadCredentialID, setUploadCredentialID] = useState("");
  const [selectedTargetIDs, setSelectedTargetIDs] = useState<string[]>([]);
  const [taskEnabled, setTaskEnabled] = useState(true);
  const [automationRuns, setAutomationRuns] = useState<AutomationRun[]>([]);
  const [loadedRunsAutomationID, setLoadedRunsAutomationID] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{
    kind: "automation" | "target";
    id: string;
    name: string;
  } | null>(null);
  const [runConfirmation, setRunConfirmation] = useState<AutomationTask | null>(null);
  const [automationQuery, setAutomationQuery] = useState("");
  const [automationPage, setAutomationPage] = useState(1);
  const [automationPageSize, setAutomationPageSize] = useState(10);
  const [targetQuery, setTargetQuery] = useState("");
  const [targetPage, setTargetPage] = useState(1);
  const [targetPageSize, setTargetPageSize] = useState(10);
  const [activeTab, setActiveTab] = useState<"automations" | "targets">("automations");

  const automationDetail = automations.find((item) => item.id === searchParams.get("automation")) ?? null;
  const targetDetail = targets.find((item) => item.id === searchParams.get("target")) ?? null;
  const visibleAutomations = useMemo(() => {
    const query = automationQuery.trim().toLowerCase();
    if (!query) return automations;
    return automations.filter((item) => [item.name, item.certificateName, actionLabels[item.actionType], item.lastStatus].join(" ").toLowerCase().includes(query));
  }, [automationQuery, automations]);
  const automationPageCount = Math.max(1, Math.ceil(visibleAutomations.length / automationPageSize));
  const currentAutomationPage = Math.min(automationPage, automationPageCount);
  const paginatedAutomations = visibleAutomations.slice((currentAutomationPage - 1) * automationPageSize, currentAutomationPage * automationPageSize);
  const visibleTargets = useMemo(() => {
    const query = targetQuery.trim().toLowerCase();
    if (!query) return targets;
    return targets.filter((item) => [item.name, item.regionId, item.loadBalancerId, item.listenerId, item.listenerProtocol, item.status].join(" ").toLowerCase().includes(query));
  }, [targetQuery, targets]);
  const targetPageCount = Math.max(1, Math.ceil(visibleTargets.length / targetPageSize));
  const currentTargetPage = Math.min(targetPage, targetPageCount);
  const paginatedTargets = visibleTargets.slice((currentTargetPage - 1) * targetPageSize, currentTargetPage * targetPageSize);

  function openAutomation(item: AutomationTask) {
    setAutomationRuns([]);
    setLoadedRunsAutomationID("");
    const params = new URLSearchParams(searchParams.toString());
    params.set("automation", item.id);
    router.replace(`${pathname}?${params}`, { scroll: false });
  }

  function closeAutomationDetail() {
    setAutomationRuns([]);
    setLoadedRunsAutomationID("");
    const params = new URLSearchParams(searchParams.toString());
    params.delete("automation");
    router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
  }

  function openTarget(item: DeploymentTarget) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("target", item.id);
    router.replace(`${pathname}?${params}`, { scroll: false });
  }

  function closeTargetDetail() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("target");
    router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
  }

  function editTarget(item: DeploymentTarget) {
    setEditingTargetId(item.id);
    setTargetName(item.name);
    handleCredentialChange(item.cloudCredentialId);
    setRegionId(item.regionId);
    setLoadBalancerId(item.loadBalancerId);
    setListenerId(item.listenerId);
    closeTargetDetail();
    setTargetOpen(true);
  }

  function editAutomation(item: AutomationTask) {
    setEditingAutomationId(item.id);
    setTaskName(item.name);
    setCertificateId(item.certificateId);
    setActionType(item.actionType);
    setIntervalMinutes(String(item.intervalMinutes));
    setUploadCredentialID(item.cloudCredentialId ?? "");
    setSelectedTargetIDs(item.targetIds ?? []);
    setTaskEnabled(item.enabled);
    closeAutomationDetail();
    setAutomationOpen(true);
  }

  function openNewAutomation() {
    setEditingAutomationId("");
    setTaskName("");
    setCertificateId("");
    setActionType("renew_certificate");
    setIntervalMinutes("1440");
    setUploadCredentialID("");
    setSelectedTargetIDs([]);
    setTaskEnabled(true);
    setError("");
    setAutomationOpen(true);
  }

  function closeAutomationEditor() {
    setAutomationOpen(false);
    setEditingAutomationId("");
    setError("");
  }

  function openNewTarget() {
    setEditingTargetId("");
    setTargetName("");
    handleCredentialChange("");
    setError("");
    setTargetOpen(true);
  }

  function closeTargetEditor() {
    setTargetOpen(false);
    setEditingTargetId("");
    setError("");
  }

  useEffect(() => {
    if (!credentialId) return;
    const controller = new AbortController();

    void fetch(`/api/cloud-credentials/${credentialId}/alb/regions`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("无法读取阿里云地域"))))
      .then((body) => {
        if (!controller.signal.aborted) setRegions(body.data ?? []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("无法读取阿里云地域");
      });

    return () => controller.abort();
  }, [credentialId]);

  useEffect(() => {
    if (!credentialId || !regionId) return;
    const controller = new AbortController();
    const url = `/api/cloud-credentials/${credentialId}/alb/load-balancers?regionId=${encodeURIComponent(regionId)}`;

    void fetch(url, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("无法读取 ALB"))))
      .then((body) => {
        if (!controller.signal.aborted) setLoadBalancers(body.data ?? []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("无法读取 ALB");
      });

    return () => controller.abort();
  }, [credentialId, regionId]);

  useEffect(() => {
    if (!credentialId || !regionId || !loadBalancerId) return;
    const controller = new AbortController();
    const url = `/api/cloud-credentials/${credentialId}/alb/load-balancers/${loadBalancerId}/listeners?regionId=${encodeURIComponent(regionId)}`;

    void fetch(url, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("无法读取监听器"))))
      .then((body) => {
        if (!controller.signal.aborted) setListeners(body.data ?? []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("无法读取监听器");
      });

    return () => controller.abort();
  }, [credentialId, regionId, loadBalancerId]);

  useEffect(() => {
    if (!automationDetail) return;
    const controller = new AbortController();
    const automationID = automationDetail.id;
    void fetch(`/api/automations/${automationID}/runs`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("无法读取运行记录"))))
      .then((body) => {
        if (!controller.signal.aborted) {
          setAutomationRuns(body.data ?? []);
          setLoadedRunsAutomationID(automationID);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setAutomationRuns([]);
          setLoadedRunsAutomationID(automationID);
        }
      });
    return () => controller.abort();
  }, [automationDetail]);

  function handleCredentialChange(nextCredentialId: string) {
    setCredentialId(nextCredentialId);
    setRegionId("");
    setRegions([]);
    setLoadBalancers([]);
    setLoadBalancerId("");
    setListeners([]);
    setListenerId("");
    setError("");
  }

  function handleRegionChange(nextRegionId: string) {
    setRegionId(nextRegionId);
    setLoadBalancers([]);
    setLoadBalancerId("");
    setListeners([]);
    setListenerId("");
    setError("");
  }

  function handleLoadBalancerChange(nextLoadBalancerId: string) {
    setLoadBalancerId(nextLoadBalancerId);
    setListeners([]);
    setListenerId("");
    setError("");
  }

  async function createTarget(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    if (!targetName.trim() || !credentialId || !regionId || !loadBalancerId || !listenerId) {
      setError("请完整填写 ALB 部署目标配置");
      setPending(false);
      return;
    }
    const listener = listeners.find((item) => item.id === listenerId);
    if (!listener || !["HTTPS", "QUIC"].includes(listener.protocol)) {
      setError("只能选择 HTTPS 或 QUIC 监听器");
      setPending(false);
      return;
    }
    const response = await fetch(
      editingTargetId ? `/api/deployment-targets/${editingTargetId}` : "/api/deployment-targets",
      {
        method: editingTargetId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: targetName.trim(),
          cloudCredentialId: credentialId,
          regionId,
          loadBalancerId,
          listenerId,
        }),
      },
    );
    if (!response.ok) {
      setError(await readError(response, "无法保存 ALB 目标"));
      setPending(false);
      return;
    }
    const target = {
      id: editingTargetId || crypto.randomUUID(),
      name: targetName.trim(),
      cloudCredentialId: credentialId,
      regionId,
      loadBalancerId,
      listenerId,
      listenerProtocol: listener.protocol,
      status: "active",
      createdAt: new Date().toISOString(),
    };
    setTargets((items) =>
      editingTargetId
        ? items.map((item) => (item.id === editingTargetId ? { ...item, ...target } : item))
        : [target, ...items],
    );
    closeTargetEditor();
    setPending(false);
    router.refresh();
  }
  async function createAutomation(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    if (!taskName.trim()) {
      setError("请输入任务名称");
      setPending(false);
      return;
    }
    if (!certificateId) {
      setError("请选择证书");
      setPending(false);
      return;
    }
    if (actionType === "upload_ssl" && !uploadCredentialID) {
      setError("请选择用于上传 SSL 证书的阿里云凭证");
      setPending(false);
      return;
    }
    if (actionType === "deploy_alb" && selectedTargetIDs.length === 0) {
      setError("请选择至少一个 ALB 目标");
      setPending(false);
      return;
    }
    const response = await fetch(
      editingAutomationId ? `/api/automations/${editingAutomationId}` : "/api/automations",
      {
        method: editingAutomationId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: taskName.trim(),
          certificateId,
          actionType,
          intervalMinutes: actionType === "renew_certificate" ? Number(intervalMinutes) : 60,
          cloudCredentialId: actionType === "upload_ssl" ? uploadCredentialID : "",
          deploymentTargetIds: actionType === "deploy_alb" ? selectedTargetIDs : [],
          enabled: taskEnabled,
        }),
      },
    );
    if (!response.ok) {
      setError(await readError(response, "无法创建自动化任务"));
      setPending(false);
      return;
    }
    closeAutomationEditor();
    setPending(false);
    router.refresh();
  }
  async function runAutomation(id: string) {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/automations/${id}/run`, { method: "POST" });
      if (!response.ok) {
        setError(await readError(response, "无法立即执行自动化任务"));
        return false;
      }
      const body = (await response.json().catch(() => ({ status: "queued" }))) as { status?: string; runId?: string };
      setAutomations((items) =>
        items.map((item) =>
          item.id === id
            ? { ...item, lastStatus: body.status === "waiting_for_certificate" ? "skipped" : "queued" }
            : item,
        ),
      );
      router.refresh();
      return true;
    } catch {
      setError("无法立即执行自动化任务");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function toggleAutomation(item: AutomationTask) {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/automations/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: item.name,
          certificateId: item.certificateId,
          actionType: item.actionType,
          intervalMinutes: item.intervalMinutes,
          cloudCredentialId: item.cloudCredentialId,
          deploymentTargetIds: item.targetIds,
          enabled: !item.enabled,
        }),
      });
      if (!response.ok) {
        setError(await readError(response, "无法更新任务状态"));
        return;
      }
      setAutomations((items) => items.map((current) => (current.id === item.id ? { ...current, enabled: !current.enabled } : current)));
      router.refresh();
    } catch {
      setError("无法更新任务状态");
    } finally {
      setPending(false);
    }
  }

  async function confirmRun() {
    if (!runConfirmation) return;
    if (await runAutomation(runConfirmation.id)) setRunConfirmation(null);
  }

  async function deleteResource() {
    if (!confirmDelete) return;
    setPending(true);
    setError("");
    const path =
      confirmDelete.kind === "automation"
        ? `/api/automations/${confirmDelete.id}`
        : `/api/deployment-targets/${confirmDelete.id}`;
    const response = await fetch(path, { method: "DELETE" });
    if (!response.ok) {
      setError(await readError(response, "无法删除资源"));
      setPending(false);
      return;
    }
    if (confirmDelete.kind === "automation") {
      setAutomations((items) => items.filter((item) => item.id !== confirmDelete.id));
      closeAutomationDetail();
    } else {
      setTargets((items) => items.filter((item) => item.id !== confirmDelete.id));
      closeTargetDetail();
    }
    setConfirmDelete(null);
    setPending(false);
    router.refresh();
  }

  return (
    <div className="configuration-layout">
      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      <Tabs className="workspace-tabs" selectedKey={activeTab} onSelectionChange={(key) => setActiveTab(String(key) as "automations" | "targets")}>
        <div className="automation-actions">
          <div className="resource-operation-bar">
            <Button variant="tertiary" size="sm" onPress={() => router.refresh()}><RefreshCw size={15} />刷新</Button>
            <Button className="automation-create-button" size="sm" variant="primary" onPress={activeTab === "automations" ? openNewAutomation : openNewTarget}>
              {activeTab === "automations" ? <Plus size={15} /> : <CloudCog size={15} />}
              {activeTab === "automations" ? "新建任务" : "新建目标"}
            </Button>
          </div>
          <div className="resource-query-bar automation-query-controls">
            <div className="resource-search">
              <Search size={15} aria-hidden="true" />
              <Input
                aria-label={activeTab === "automations" ? "搜索自动化任务" : "搜索 ALB 部署目标"}
                value={activeTab === "automations" ? automationQuery : targetQuery}
                onChange={(event) => {
                  if (activeTab === "automations") {
                    setAutomationQuery(event.target.value);
                    setAutomationPage(1);
                    return;
                  }
                  setTargetQuery(event.target.value);
                  setTargetPage(1);
                }}
                placeholder={activeTab === "automations" ? "搜索任务、证书、动作或状态" : "搜索名称、地域、ALB 或监听器"}
              />
            </div>
            <Tabs.ListContainer className="automation-tab-list">
              <Tabs.List aria-label="自动化资源">
                <Tabs.Tab id="automations">自动化任务 ({automations.length})<Tabs.Indicator /></Tabs.Tab>
                <Tabs.Tab id="targets">ALB 部署目标 ({targets.length})<Tabs.Indicator /></Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
          </div>
        </div>
        <Tabs.Panel id="automations" className="workspace-tab-panel">
          <section className="automation-section">
            {automations.length === 0 ? (
              <ResourceEmptyState
                icon={RotateCw}
                title="尚未配置自动化任务"
                description="创建任务后，可定期续期证书、上传 SSL 证书或更新 ALB。"
                primaryAction={{ label: "新建任务", icon: Plus, onPress: openNewAutomation }}
              />
            ) : null}
            {automations.length > 0 && visibleAutomations.length === 0 ? (
              <ResourceEmptyState
                icon={Search}
                title="没有匹配的自动化任务"
                description="试试调整任务、证书、动作或状态关键词。"
                primaryAction={{ label: "清除搜索", onPress: () => { setAutomationQuery(""); setAutomationPage(1); } }}
                variant="filtered"
              />
            ) : null}
            {visibleAutomations.length > 0 ? (
              <>
                <AutomationTable
                  items={paginatedAutomations}
                  pending={pending}
                  onDelete={(item) => setConfirmDelete({ kind: "automation", id: item.id, name: item.name })}
                  onEdit={editAutomation}
                  onOpen={openAutomation}
                  onRun={setRunConfirmation}
                  onToggle={toggleAutomation}
                />
                <ResourcePagination
                  page={currentAutomationPage}
                  pageCount={automationPageCount}
                  total={visibleAutomations.length}
                  pageSize={automationPageSize}
                  onPageChange={setAutomationPage}
                  onPageSizeChange={(pageSize) => {
                    setAutomationPageSize(pageSize);
                    setAutomationPage(1);
                  }}
                />
              </>
            ) : null}
          </section>
        </Tabs.Panel>
        <Tabs.Panel id="targets" className="workspace-tab-panel">
          <section className="automation-section">
            {targets.length === 0 ? (
              <ResourceEmptyState
                icon={CloudCog}
                title="尚未配置 ALB 部署目标"
                description="创建目标后，可在“更新 ALB”任务中选择监听器并自动部署证书。"
                primaryAction={{ label: "新建目标", icon: CloudCog, onPress: openNewTarget }}
              />
            ) : null}
            {targets.length > 0 && visibleTargets.length === 0 ? (
              <ResourceEmptyState
                icon={Search}
                title="没有匹配的 ALB 部署目标"
                description="试试调整名称、地域、ALB 或监听器关键词。"
                primaryAction={{ label: "清除搜索", onPress: () => { setTargetQuery(""); setTargetPage(1); } }}
                variant="filtered"
              />
            ) : null}
            {visibleTargets.length > 0 ? (
              <>
                <TargetTable
                  items={paginatedTargets}
                  onDelete={(item) => setConfirmDelete({ kind: "target", id: item.id, name: item.name })}
                  onEdit={editTarget}
                  onOpen={openTarget}
                />
                <ResourcePagination
                  page={currentTargetPage}
                  pageCount={targetPageCount}
                  total={visibleTargets.length}
                  pageSize={targetPageSize}
                  onPageChange={setTargetPage}
                  onPageSizeChange={(pageSize) => {
                    setTargetPageSize(pageSize);
                    setTargetPage(1);
                  }}
                />
              </>
            ) : null}
          </section>
        </Tabs.Panel>
      </Tabs>
      <ResourceModal
        isOpen={automationOpen}
        onOpenChange={(isOpen) => (isOpen ? setAutomationOpen(true) : closeAutomationEditor())}
        title={editingAutomationId ? "编辑自动化任务" : "新建自动化任务"}
        description="上传和 ALB 更新会在证书更新后自动执行。"
        headerIcon={<RotateCw size={20} />}
        size="wide"
      >
        <form className="drawer-form" onSubmit={createAutomation}>
          <div className="field-grid">
            <div className="field field-wide">
              <label htmlFor="automation-name">任务名称</label>
              <Input
                id="automation-name"
                value={taskName}
                onChange={(e) => setTaskName(e.target.value)}
                placeholder="production-certificate-sync"
              />
            </div>
            <div className="field">
              <label htmlFor="automation-certificate">证书</label>
              <Select
                id="automation-certificate"
                selectedKey={certificateId || null}
                onSelectionChange={(key) => setCertificateId(String(key))}
                placeholder="选择证书"
              >
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {certificates.map((item) => (
                      <ListBox.Item id={item.id} key={item.id}>
                        {item.name}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>
            <div className="field">
              <label htmlFor="automation-action">自动化动作</label>
              <Select
                id="automation-action"
                selectedKey={actionType}
                onSelectionChange={(key) => {
                  setActionType(String(key) as ActionType);
                  setSelectedTargetIDs([]);
                }}
              >
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="renew_certificate">定期续期证书</ListBox.Item>
                    <ListBox.Item id="upload_ssl">上传 SSL 证书管理</ListBox.Item>
                    <ListBox.Item id="deploy_alb">更新 ALB</ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>
            {actionType === "renew_certificate" ? (
              <div className="field">
                <label htmlFor="automation-interval">检查周期</label>
                <Select
                  id="automation-interval"
                  selectedKey={intervalMinutes}
                  onSelectionChange={(key) => setIntervalMinutes(String(key))}
                >
                  <Select.Trigger>
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id="60">每小时</ListBox.Item>
                      <ListBox.Item id="360">每 6 小时</ListBox.Item>
                      <ListBox.Item id="720">每 12 小时</ListBox.Item>
                      <ListBox.Item id="1440">每天</ListBox.Item>
                      <ListBox.Item id="10080">每周</ListBox.Item>
                    </ListBox>
                  </Select.Popover>
                </Select>
              </div>
            ) : null}
            {actionType === "upload_ssl" ? (
              <div className="field field-wide">
                <label htmlFor="upload-credential">阿里云凭证</label>
                <Select
                  id="upload-credential"
                  selectedKey={uploadCredentialID || null}
                  onSelectionChange={(key) => setUploadCredentialID(String(key))}
                  placeholder="选择用于上传的阿里云凭证"
                >
                  <Select.Trigger>
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {credentials.map((item) => (
                        <ListBox.Item id={item.id} key={item.id}>
                          {item.name} ({item.credentialHint})
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </div>
            ) : null}
            {actionType === "deploy_alb" ? (
              <div className="field field-wide">
                <span className="field-label">ALB 目标</span>
                <div className="target-picker" role="group" aria-label="选择 ALB 目标">
                  {targets.length === 0 ? (
                    <span className="field-help">请先创建 ALB 部署目标。</span>
                  ) : (
                    targets.map((target) => (
                      <Checkbox
                        className="target-option"
                        isSelected={selectedTargetIDs.includes(target.id)}
                        key={target.id}
                        onChange={(isSelected) =>
                          setSelectedTargetIDs((current) =>
                            isSelected ? [...current, target.id] : current.filter((id) => id !== target.id),
                          )
                        }
                      >
                        <Checkbox.Content>
                          <Checkbox.Control>
                            <Checkbox.Indicator />
                          </Checkbox.Control>
                          <span>
                            {target.name}
                            <small>
                              {target.regionId} · {target.listenerProtocol}
                            </small>
                          </span>
                        </Checkbox.Content>
                      </Checkbox>
                    ))
                  )}
                </div>
              </div>
            ) : null}
            <div className="field field-wide">
              <Checkbox isSelected={taskEnabled} onChange={setTaskEnabled}>
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  <span>
                    启用此任务
                    <small>暂停后不会触发新运行，已在执行的任务会继续完成。</small>
                  </span>
                </Checkbox.Content>
              </Checkbox>
            </div>
          </div>
          {error ? <div className="form-error">{error}</div> : null}
          <div className="form-actions">
            <ModalCancelButton onPress={closeAutomationEditor} />
            <Button type="submit" variant="primary" isDisabled={pending}>
              <RotateCw size={16} />
              {pending ? "正在保存" : "保存任务"}
            </Button>
          </div>
        </form>
      </ResourceModal>
      <ResourceModal
        isOpen={Boolean(automationDetail)}
        onOpenChange={(isOpen) => !isOpen && closeAutomationDetail()}
        title={automationDetail?.name ?? "自动化任务详情"}
        description="查看任务配置、最近状态和执行影响范围"
        headerIcon={<RotateCw size={20} />}
      >
        {automationDetail ? (
          <div className="resource-detail">
            <dl className="resource-details">
              <div>
                <dt>证书</dt>
                <dd>{automationDetail.certificateName}</dd>
              </div>
              <div>
                <dt>动作</dt>
                <dd>{actionLabels[automationDetail.actionType]}</dd>
              </div>
              <div>
                <dt>周期</dt>
                <dd>
                  {automationDetail.actionType === "renew_certificate"
                    ? formatInterval(automationDetail.intervalMinutes)
                    : "证书更新时"}
                </dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>
                  <StatusTag status={automationDetail.lastStatus} />
                </dd>
              </div>
              <div>
                <dt>任务状态</dt>
                <dd>
                  <StatusTag status={automationDetail.enabled ? "active" : "disabled"} />
                </dd>
              </div>
              {automationDetail.actionType === "renew_certificate" ? (
                <div>
                  <dt>下次检查</dt>
                  <dd>{formatDateTime(automationDetail.nextRunAt)}</dd>
                </div>
              ) : null}
              <div>
                <dt>目标数量</dt>
                <dd>{automationDetail.targetCount}</dd>
              </div>
              {automationDetail.lastError ? (
                <div className="certificate-detail-wide">
                  <dt>最近错误</dt>
                  <dd className="table-error">{automationDetail.lastError}</dd>
                </div>
              ) : null}
            </dl>
            <div className="automation-run-history">
              <div className="automation-run-history-heading">
                <strong>最近运行</strong>
                <span>{loadedRunsAutomationID === automationDetail.id ? `${automationRuns.length} 条` : "正在加载"}</span>
              </div>
              {automationRuns.length === 0 && loadedRunsAutomationID === automationDetail.id ? <p>暂无运行记录。</p> : null}
              {loadedRunsAutomationID === automationDetail.id ? automationRuns.map((run) => (
                <div className="automation-run-item" key={run.id}>
                  <div>
                    <strong>{run.triggerType === "manual" ? "手动执行" : run.triggerType === "scheduler" ? "定时检查" : "证书更新"}</strong>
                    <span>{formatDateTime(run.createdAt)}</span>
                  </div>
                  <div>
                    <span>{run.succeededJobs}/{run.totalJobs} 完成</span>
                    <StatusTag status={run.status === "partial_failed" ? "failed" : run.status} />
                  </div>
                  {run.lastError ? <small className="table-error">{run.lastError}</small> : null}
                </div>
              )) : null}
            </div>
            <div className="resource-detail-actions">
              <Button variant="secondary" onPress={() => editAutomation(automationDetail)}>
                编辑
              </Button>
              <Button
                variant="primary"
                isDisabled={!automationDetail.enabled}
                onPress={() => {
                  setRunConfirmation(automationDetail);
                  closeAutomationDetail();
                }}
              >
                立即执行
              </Button>
              <Button
                variant="danger"
                onPress={() =>
                  setConfirmDelete({
                    kind: "automation",
                    id: automationDetail.id,
                    name: automationDetail.name,
                  })
                }
              >
                删除
              </Button>
            </div>
          </div>
        ) : null}
      </ResourceModal>
      <ResourceModal
        isOpen={targetOpen}
        onOpenChange={(isOpen) => (isOpen ? setTargetOpen(true) : closeTargetEditor())}
        title={editingTargetId ? "编辑 ALB 部署目标" : "新建 ALB 部署目标"}
        description="选择 HTTPS 或 QUIC 监听器。"
        headerIcon={<CloudCog size={20} />}
        size="wide"
      >
        <form className="drawer-form" onSubmit={createTarget}>
          <div className="field-grid">
            <div className="field field-wide">
              <label htmlFor="target-name">名称</label>
              <Input
                id="target-name"
                value={targetName}
                onChange={(e) => setTargetName(e.target.value)}
                placeholder="production-alb"
              />
            </div>
            <div className="field">
              <label htmlFor="target-credential">云凭证</label>
              <Select
                id="target-credential"
                selectedKey={credentialId || null}
                onSelectionChange={(key) => handleCredentialChange(String(key))}
                placeholder="选择阿里云凭证"
              >
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {credentials.map((item) => (
                      <ListBox.Item id={item.id} key={item.id}>
                        {item.name} ({item.credentialHint})
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>
            <div className="field">
              <label htmlFor="target-region">地域</label>
              <Select
                id="target-region"
                selectedKey={regionId || null}
                onSelectionChange={(key) => handleRegionChange(String(key))}
                isDisabled={!regions.length}
                placeholder={credentialId ? "选择地域" : "请先选择云凭证"}
              >
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {regions.map((item) => (
                      <ListBox.Item id={item.id} key={item.id}>
                        {item.name} ({item.id})
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>
            <div className="field">
              <label htmlFor="target-alb">ALB</label>
              <Select
                id="target-alb"
                selectedKey={loadBalancerId || null}
                onSelectionChange={(key) => handleLoadBalancerChange(String(key))}
                isDisabled={!loadBalancers.length}
                placeholder={regionId ? "选择 ALB" : "请先选择地域"}
              >
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {loadBalancers.map((item) => (
                      <ListBox.Item id={item.id} key={item.id}>
                        {item.name || item.id} · {item.status}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>
            <div className="field">
              <label htmlFor="target-listener">HTTPS 监听器</label>
              <Select
                id="target-listener"
                selectedKey={listenerId || null}
                onSelectionChange={(key) => setListenerId(String(key))}
                isDisabled={!listeners.length}
                placeholder={loadBalancerId ? "选择监听器" : "请先选择 ALB"}
              >
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {listeners.map((item) => (
                      <ListBox.Item
                        id={item.id}
                        isDisabled={!["HTTPS", "QUIC"].includes(item.protocol)}
                        key={item.id}
                      >
                        {item.protocol}:{item.port} · {item.description || item.id}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>
          </div>
          {error ? <div className="form-error">{error}</div> : null}
          <div className="form-actions">
            <ModalCancelButton onPress={closeTargetEditor} />
            <Button type="submit" variant="primary" isDisabled={pending}>
              <Plus size={16} />
              {pending ? "正在保存" : "保存目标"}
            </Button>
          </div>
        </form>
      </ResourceModal>
      <ResourceModal
        isOpen={Boolean(targetDetail)}
        onOpenChange={(isOpen) => !isOpen && closeTargetDetail()}
        title={targetDetail?.name ?? "ALB 部署目标详情"}
        description="查看地域、负载均衡器和监听器配置"
      >
        {targetDetail ? (
          <div className="resource-detail">
            <dl className="resource-details">
              <div>
                <dt>云凭证</dt>
                <dd>{targetDetail.cloudCredentialId}</dd>
              </div>
              <div>
                <dt>地域</dt>
                <dd>{targetDetail.regionId}</dd>
              </div>
              <div>
                <dt>ALB</dt>
                <dd>{targetDetail.loadBalancerId}</dd>
              </div>
              <div>
                <dt>监听器</dt>
                <dd>
                  {targetDetail.listenerProtocol} · {targetDetail.listenerId}
                </dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>
                  <StatusTag status={targetDetail.status} />
                </dd>
              </div>
            </dl>
            <div className="resource-detail-actions">
              <Button variant="secondary" onPress={() => editTarget(targetDetail)}>
                编辑
              </Button>
              <Button
                variant="danger"
                onPress={() =>
                  setConfirmDelete({ kind: "target", id: targetDetail.id, name: targetDetail.name })
                }
              >
                删除
              </Button>
            </div>
          </div>
        ) : null}
      </ResourceModal>
      <ResourceModal
        isOpen={Boolean(runConfirmation)}
        onOpenChange={(isOpen) => !isOpen && setRunConfirmation(null)}
        size="compact"
        title="确认立即执行"
        description="任务会立刻进入队列，并可能修改外部云资源。"
        headerIcon={<Play size={20} />}
        footer={
          <div className="form-actions">
            <ModalCancelButton onPress={() => setRunConfirmation(null)} />
            <Button variant="primary" isDisabled={pending} onPress={() => void confirmRun()}>
              <Play size={16} />
              {pending ? "正在排队" : "确认执行"}
            </Button>
          </div>
        }
      >
        {runConfirmation ? (
          <div className="resource-detail">
            <dl className="resource-details">
              <div>
                <dt>任务</dt>
                <dd>{runConfirmation.name}</dd>
              </div>
              <div>
                <dt>证书</dt>
                <dd>{runConfirmation.certificateName}</dd>
              </div>
              <div>
                <dt>动作</dt>
                <dd>{actionLabels[runConfirmation.actionType]}</dd>
              </div>
              <div>
                <dt>触发方式</dt>
                <dd>
                  {runConfirmation.actionType === "renew_certificate"
                    ? `本次手动触发，计划周期 ${formatInterval(runConfirmation.intervalMinutes)}`
                    : "本次手动触发"}
                </dd>
              </div>
              {runConfirmation.actionType === "upload_ssl" ? (
                <div className="certificate-detail-wide">
                  <dt>影响</dt>
                  <dd>将向阿里云 SSL 证书管理上传该证书。</dd>
                </div>
              ) : null}
              {runConfirmation.actionType === "deploy_alb" ? (
                <div className="certificate-detail-wide">
                  <dt>影响</dt>
                  <dd>将更新 {runConfirmation.targetCount} 个已选 HTTPS 或 QUIC 监听器关联的证书。</dd>
                </div>
              ) : null}
              {runConfirmation.actionType === "renew_certificate" ? (
                <div className="certificate-detail-wide">
                  <dt>影响</dt>
                  <dd>将检查续期窗口；如需签发，会向 ACME 服务发起域名验证与证书签发。</dd>
                </div>
              ) : null}
            </dl>
            {error ? (
              <div className="form-error" role="alert">
                {error}
              </div>
            ) : null}
          </div>
        ) : null}
      </ResourceModal>
      <ResourceModal
        isOpen={Boolean(confirmDelete)}
        onOpenChange={(isOpen) => !isOpen && setConfirmDelete(null)}
        size="compact"
        title="确认删除"
        description="删除后将无法继续用于新的自动化配置。"
        headerIcon={<Trash2 size={20} />}
        footer={
          <div className="form-actions">
            <ModalCancelButton onPress={() => setConfirmDelete(null)} />
            <Button variant="danger" isDisabled={pending} onPress={() => void deleteResource()}>
              {pending ? "正在删除" : "确认删除"}
            </Button>
          </div>
        }
      >
        {confirmDelete ? (
          <p>确定删除“{confirmDelete.name}”吗？如果资源仍被引用，系统会阻止删除并提示关联配置。</p>
        ) : null}
      </ResourceModal>
    </div>
  );
}

function AutomationTable({
  items,
  onRun,
  onOpen,
  onEdit,
  onDelete,
  onToggle,
  pending,
}: {
  items: AutomationTask[];
  onRun: (item: AutomationTask) => void;
  onOpen: (item: AutomationTask) => void;
  onEdit: (item: AutomationTask) => void;
  onDelete: (item: AutomationTask) => void;
  onToggle: (item: AutomationTask) => void;
  pending: boolean;
}) {
  return (
    <Table className="table-pinned-columns">
      <Table.ScrollContainer>
          <Table.Content aria-label="自动化任务" className="min-w-[1260px]">
          <Table.Header>
            <Table.Column isRowHeader>名称</Table.Column>
            <Table.Column>证书</Table.Column>
            <Table.Column>动作</Table.Column>
            <Table.Column>触发方式</Table.Column>
            <Table.Column>下次检查</Table.Column>
            <Table.Column>最近执行</Table.Column>
            <Table.Column>任务状态</Table.Column>
            <Table.Column>状态</Table.Column>
            <Table.Column>操作</Table.Column>
          </Table.Header>
          <Table.Body>
            {items.map((item) => (
              <Table.Row key={item.id}>
                <Table.Cell>{item.name}</Table.Cell>
                <Table.Cell>{item.certificateName}</Table.Cell>
                <Table.Cell>{actionLabels[item.actionType]}</Table.Cell>
                <Table.Cell>{item.actionType === "renew_certificate" ? `每 ${formatInterval(item.intervalMinutes)} 检查` : "证书更新时"}</Table.Cell>
                <Table.Cell>{item.actionType === "renew_certificate" ? formatDateTime(item.nextRunAt) : "-"}</Table.Cell>
                <Table.Cell>{formatDateTime(item.lastRunAt)}</Table.Cell>
                <Table.Cell><StatusTag status={item.enabled ? "active" : "disabled"} /></Table.Cell>
                <Table.Cell>
                  <div className="table-status-stack">
                    <StatusTag status={item.lastStatus} />
                    {item.lastError ? <small className="table-error">{item.lastError}</small> : null}
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <TableActions
                    actions={[
                      { id: "details", label: "详情", onPress: () => onOpen(item) },
                      { id: "run", label: "立即执行", onPress: () => onRun(item), isDisabled: pending || !item.enabled },
                      { id: "toggle", label: item.enabled ? "暂停" : "启用", onPress: () => onToggle(item), isDisabled: pending },
                      { id: "edit", label: "编辑", onPress: () => onEdit(item) },
                      { id: "delete", label: "删除", onPress: () => onDelete(item), tone: "danger" },
                    ]}
                  />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}
function TargetTable({
  items,
  onOpen,
  onEdit,
  onDelete,
}: {
  items: DeploymentTarget[];
  onOpen: (item: DeploymentTarget) => void;
  onEdit: (item: DeploymentTarget) => void;
  onDelete: (item: DeploymentTarget) => void;
}) {
  return (
    <Table className="table-pinned-columns">
      <Table.ScrollContainer>
        <Table.Content aria-label="ALB 部署目标" className="min-w-[880px]">
          <Table.Header>
            <Table.Column isRowHeader>名称</Table.Column>
            <Table.Column>地域</Table.Column>
            <Table.Column>ALB</Table.Column>
            <Table.Column>监听器</Table.Column>
            <Table.Column>状态</Table.Column>
            <Table.Column>操作</Table.Column>
          </Table.Header>
          <Table.Body>
            {items.map((item) => (
              <Table.Row key={item.id}>
                <Table.Cell>{item.name}</Table.Cell>
                <Table.Cell>{item.regionId}</Table.Cell>
                <Table.Cell>{item.loadBalancerId}</Table.Cell>
                <Table.Cell>{item.listenerProtocol} · {item.listenerId}</Table.Cell>
                <Table.Cell><StatusTag status={item.status} /></Table.Cell>
                <Table.Cell>
                  <TableActions
                    actions={[
                      { id: "details", label: "详情", onPress: () => onOpen(item) },
                      { id: "edit", label: "编辑", onPress: () => onEdit(item) },
                      { id: "delete", label: "删除", onPress: () => onDelete(item), tone: "danger" },
                    ]}
                  />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}
function formatInterval(minutes: number) {
  if (minutes % 10080 === 0) return `${minutes / 10080} 周`;
  if (minutes % 1440 === 0) return `${minutes / 1440} 天`;
  if (minutes % 60 === 0) return `${minutes / 60} 小时`;
  return `${minutes} 分钟`;
}
async function readError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return body?.message ?? fallback;
}
