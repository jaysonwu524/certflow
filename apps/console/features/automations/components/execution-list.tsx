"use client";

import { useMemo, useState } from "react";
import { Button, Input, Table, Tabs } from "@heroui/react";
import { ListChecks, RefreshCw, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { ResourceEmptyState } from "@/components/ui/resource-empty-state";
import { ResourceModal } from "@/components/ui/resource-modal";
import { ResourcePagination } from "@/components/ui/resource-pagination";
import { StatusTag } from "@/components/ui/status-tag";
import { SortableTableColumn } from "@/components/ui/sortable-table-column";
import { TableActions } from "@/components/ui/table-actions";
import { formatDateTime } from "@/lib/presentation";
import type { Execution } from "@/lib/api";

const executionLabels: Record<string, string> = {
  issue: "签发证书",
  renew: "续期证书",
  upload: "上传 SSL 证书管理",
  deploy: "更新 ALB",
  cleanup: "清理任务",
};

const triggerLabels: Record<string, string> = {
  manual: "手动触发",
  scheduler: "定时触发",
  automation: "自动化任务",
  certificate_issued: "证书更新",
};

type ExecutionFilter = "all" | "active" | "failed" | "completed";
type ExecutionSortColumn = "kind" | "certificate" | "target" | "trigger" | "startedAt" | "finishedAt" | "status";
type SortDescriptor = { column: string; direction: "ascending" | "descending" };
const executionCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

function executionLabel(kind: string) {
  return executionLabels[kind] ?? kind;
}

function triggerLabel(trigger: string) {
  return triggerLabels[trigger] ?? (trigger || "-");
}

export function ExecutionList({ executions }: { executions: Execution[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ExecutionFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<Execution | null>(null);
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({ column: "startedAt", direction: "descending" });
  const filterCounts = useMemo(
    () => ({
      all: executions.length,
      active: executions.filter((execution) => ["queued", "running", "waiting_user"].includes(execution.status)).length,
      failed: executions.filter((execution) => execution.status === "failed").length,
      completed: executions.filter((execution) => ["succeeded", "cancelled"].includes(execution.status)).length,
    }),
    [executions],
  );
  const visibleExecutions = useMemo(() => {
    const value = query.trim().toLowerCase();
    return executions.filter((execution) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "active" && ["queued", "running", "waiting_user"].includes(execution.status)) ||
        (filter === "failed" && execution.status === "failed") ||
        (filter === "completed" && ["succeeded", "cancelled"].includes(execution.status));
      const matchesQuery =
        !value ||
        [executionLabel(execution.kind), execution.certificate, execution.target, triggerLabel(execution.trigger), execution.status, execution.error]
          .join(" ")
          .toLowerCase()
          .includes(value);
      return matchesFilter && matchesQuery;
    });
  }, [executions, filter, query]);
  const sortedExecutions = useMemo(() => {
    const column = sortDescriptor.column as ExecutionSortColumn;
    return [...visibleExecutions].sort((left, right) => {
      const values: Record<ExecutionSortColumn, [string, string]> = {
        kind: [executionLabel(left.kind), executionLabel(right.kind)],
        certificate: [left.certificate, right.certificate],
        target: [left.target, right.target],
        trigger: [triggerLabel(left.trigger), triggerLabel(right.trigger)],
        startedAt: [left.startedAt ?? "", right.startedAt ?? ""],
        finishedAt: [left.finishedAt ?? "", right.finishedAt ?? ""],
        status: [left.status, right.status],
      };
      const [leftValue, rightValue] = values[column];
      const result = executionCollator.compare(leftValue, rightValue);
      return sortDescriptor.direction === "ascending" ? result : -result;
    });
  }, [sortDescriptor, visibleExecutions]);
  const pageCount = Math.max(1, Math.ceil(visibleExecutions.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const paginatedExecutions = sortedExecutions.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function changeQuery(value: string) {
    setQuery(value);
    setPage(1);
  }

  function changeFilter(value: ExecutionFilter) {
    setFilter(value);
    setPage(1);
  }

  return (
    <div className="configuration-layout">
      <Tabs className="workspace-tabs" selectedKey={filter} onSelectionChange={(key) => changeFilter(String(key) as ExecutionFilter)}>
        <div className="automation-actions">
          <div className="resource-operation-bar">
            <Button variant="tertiary" size="sm" onPress={() => router.refresh()}>
              <RefreshCw size={15} />
              刷新
            </Button>
          </div>
          <div className="resource-query-bar automation-query-controls">
            <div className="resource-search">
              <Search size={15} aria-hidden="true" />
              <Input
                aria-label="搜索执行记录"
                placeholder="搜索任务、证书、目标或状态"
                value={query}
                onChange={(event) => changeQuery(event.target.value)}
              />
            </div>
            <Tabs.ListContainer className="automation-tab-list">
              <Tabs.List aria-label="执行记录状态">
                <Tabs.Tab id="all">全部 ({filterCounts.all})<Tabs.Indicator /></Tabs.Tab>
                <Tabs.Tab id="active">进行中 ({filterCounts.active})<Tabs.Indicator /></Tabs.Tab>
                <Tabs.Tab id="failed">失败 ({filterCounts.failed})<Tabs.Indicator /></Tabs.Tab>
                <Tabs.Tab id="completed">已完成 ({filterCounts.completed})<Tabs.Indicator /></Tabs.Tab>
              </Tabs.List>
              </Tabs.ListContainer>
          </div>
        </div>
        <Tabs.Panel id={filter} className="workspace-tab-panel">
          <section className="automation-section">
            {executions.length === 0 ? (
              <ResourceEmptyState
                icon={ListChecks}
                title="暂无执行记录"
                description="签发、续期、上传或部署任务运行后，将在这里查看过程与结果。"
              />
            ) : null}
            {executions.length > 0 && visibleExecutions.length === 0 ? (
              <ResourceEmptyState
                icon={Search}
                title="没有匹配的执行记录"
                description="试试调整关键词或状态筛选。"
                primaryAction={{
                  label: "清除筛选",
                  onPress: () => {
                    setQuery("");
                    setFilter("all");
                    setPage(1);
                  },
                }}
                variant="filtered"
              />
            ) : null}
            {visibleExecutions.length > 0 ? (
              <>
          <Table className="table-pinned-columns">
            <Table.ScrollContainer>
              <Table.Content
                aria-label="执行记录"
                className="min-w-[1040px]"
                sortDescriptor={sortDescriptor}
                onSortChange={(descriptor) => setSortDescriptor({ column: String(descriptor.column), direction: descriptor.direction })}
              >
                <Table.Header>
                  <SortableTableColumn id="kind" isRowHeader>任务</SortableTableColumn>
                  <SortableTableColumn id="certificate">证书</SortableTableColumn>
                  <SortableTableColumn id="target">部署目标</SortableTableColumn>
                  <SortableTableColumn id="trigger">触发方式</SortableTableColumn>
                  <SortableTableColumn id="startedAt">开始时间</SortableTableColumn>
                  <SortableTableColumn id="finishedAt">结束时间</SortableTableColumn>
                  <SortableTableColumn id="status">状态</SortableTableColumn>
                  <Table.Column>操作</Table.Column>
                </Table.Header>
                <Table.Body>
                  {paginatedExecutions.map((execution) => (
                    <Table.Row key={execution.id}>
                      <Table.Cell>{executionLabel(execution.kind)}</Table.Cell>
                      <Table.Cell>{execution.certificate || "-"}</Table.Cell>
                      <Table.Cell>{execution.target || "-"}</Table.Cell>
                      <Table.Cell>{triggerLabel(execution.trigger)}</Table.Cell>
                      <Table.Cell>{formatDateTime(execution.startedAt)}</Table.Cell>
                      <Table.Cell>{formatDateTime(execution.finishedAt)}</Table.Cell>
                      <Table.Cell>
                        <div className="table-status-stack">
                          <StatusTag status={execution.status} />
                          {execution.error ? <small className="table-error">{execution.error}</small> : null}
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <TableActions actions={[{ id: "details", label: "详情", onPress: () => setSelected(execution) }]} />
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
          <ResourcePagination
            page={currentPage}
            pageCount={pageCount}
            total={visibleExecutions.length}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
              </>
            ) : null}
          </section>
        </Tabs.Panel>
      </Tabs>
      <ResourceModal
        isOpen={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
        title={selected ? executionLabel(selected.kind) : "执行详情"}
        description="查看该任务的运行范围、时间和结果。"
        headerIcon={<ListChecks size={20} />}
      >
        {selected ? (
          <div className="resource-detail">
            <dl className="resource-details">
              <div>
                <dt>任务类型</dt>
                <dd>{executionLabel(selected.kind)}</dd>
              </div>
              <div>
                <dt>触发方式</dt>
                <dd>{triggerLabel(selected.trigger)}</dd>
              </div>
              <div>
                <dt>证书</dt>
                <dd>{selected.certificate || "-"}</dd>
              </div>
              <div>
                <dt>部署目标</dt>
                <dd>{selected.target || "-"}</dd>
              </div>
              <div>
                <dt>开始时间</dt>
                <dd>{formatDateTime(selected.startedAt)}</dd>
              </div>
              <div>
                <dt>结束时间</dt>
                <dd>{formatDateTime(selected.finishedAt)}</dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>
                  <StatusTag status={selected.status} />
                </dd>
              </div>
              {selected.error ? (
                <div className="certificate-detail-wide">
                  <dt>错误信息</dt>
                  <dd className="table-error">{selected.error}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : null}
      </ResourceModal>
    </div>
  );
}
