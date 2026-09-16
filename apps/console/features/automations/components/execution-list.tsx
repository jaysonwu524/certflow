"use client";

import { useCallback, useMemo, useState } from "react";
import { Button, Input, Table, Tabs } from "@heroui/react";
import { ListChecks, RefreshCw, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { ResourceEmptyState } from "@/components/ui/resource-empty-state";
import { ResourceModal } from "@/components/ui/resource-modal";
import { ResourcePagination } from "@/components/ui/resource-pagination";
import { StatusTag } from "@/components/ui/status-tag";
import { SortableTableColumn } from "@/components/ui/sortable-table-column";
import { TableActions } from "@/components/ui/table-actions";
import { useLocale, type TranslationKey } from "@/components/providers/locale-provider";
import { translateErrorCode } from "@/lib/error-message";
import { formatDateTime } from "@/lib/presentation";
import type { Execution } from "@/lib/api";

const executionLabels: Record<string, TranslationKey> = {
  issue: "execution.issue",
  renew: "execution.renew",
  upload: "execution.upload",
  deploy: "execution.deploy",
  cleanup: "execution.cleanup",
};

const triggerLabels: Record<string, TranslationKey> = {
  manual: "execution.manual",
  scheduler: "execution.scheduler",
  automation: "execution.automation",
  certificate_issued: "execution.certificateIssued",
};

type ExecutionFilter = "all" | "active" | "failed" | "completed";
type ExecutionSortColumn =
  "kind" | "certificate" | "target" | "trigger" | "startedAt" | "finishedAt" | "status";
type SortDescriptor = { column: string; direction: "ascending" | "descending" };
export function ExecutionList({ executions }: { executions: Execution[] }) {
  const router = useRouter();
  const { locale, t } = useLocale();
  const executionCollator = useMemo(
    () => new Intl.Collator(locale, { numeric: true, sensitivity: "base" }),
    [locale],
  );
  const executionLabel = useCallback(
    (kind: string) => (executionLabels[kind] ? t(executionLabels[kind]) : kind),
    [t],
  );
  const triggerLabel = useCallback(
    (trigger: string) => (triggerLabels[trigger] ? t(triggerLabels[trigger]) : trigger || "-"),
    [t],
  );
  const errorLabel = useCallback(
    (execution: Execution) => translateErrorCode(execution.errorCode, execution.error, t),
    [t],
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ExecutionFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<Execution | null>(null);
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({
    column: "startedAt",
    direction: "descending",
  });
  const filterCounts = useMemo(
    () => ({
      all: executions.length,
      active: executions.filter((execution) =>
        ["queued", "running", "waiting_user"].includes(execution.status),
      ).length,
      failed: executions.filter((execution) => execution.status === "failed").length,
      completed: executions.filter((execution) => ["succeeded", "cancelled"].includes(execution.status))
        .length,
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
        [
          executionLabel(execution.kind),
          execution.certificate,
          execution.target,
          triggerLabel(execution.trigger),
          execution.status,
          errorLabel(execution),
        ]
          .join(" ")
          .toLowerCase()
          .includes(value);
      return matchesFilter && matchesQuery;
    });
  }, [errorLabel, executionLabel, executions, filter, query, triggerLabel]);
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
  }, [executionCollator, executionLabel, sortDescriptor, triggerLabel, visibleExecutions]);
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
      <Tabs
        className="workspace-tabs"
        selectedKey={filter}
        onSelectionChange={(key) => changeFilter(String(key) as ExecutionFilter)}
      >
        <div className="automation-actions">
          <div className="resource-operation-bar">
            <Button variant="tertiary" size="sm" onPress={() => router.refresh()}>
              <RefreshCw size={15} />
              {t("common.refresh")}
            </Button>
          </div>
          <div className="resource-query-bar automation-query-controls">
            <div className="resource-search">
              <Search size={15} aria-hidden="true" />
              <Input
                aria-label={t("common.search")}
                placeholder={t("execution.searchPlaceholder")}
                value={query}
                onChange={(event) => changeQuery(event.target.value)}
              />
            </div>
            <Tabs.ListContainer className="automation-tab-list">
              <Tabs.List aria-label={t("dashboard.executionHistory")}>
                <Tabs.Tab id="all">
                  {t("execution.filterAll", { count: filterCounts.all })}
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="active">
                  {t("execution.filterActive", { count: filterCounts.active })}
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="failed">
                  {t("execution.filterFailed", { count: filterCounts.failed })}
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="completed">
                  {t("execution.filterCompleted", { count: filterCounts.completed })}
                  <Tabs.Indicator />
                </Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
          </div>
        </div>
        <Tabs.Panel id={filter} className="workspace-tab-panel">
          <section className="automation-section">
            {executions.length === 0 ? (
              <ResourceEmptyState
                icon={ListChecks}
                title={t("execution.empty")}
                description={t("execution.emptyDescription")}
              />
            ) : null}
            {executions.length > 0 && visibleExecutions.length === 0 ? (
              <ResourceEmptyState
                icon={Search}
                title={t("execution.noResults")}
                description={t("execution.noResultsDescription")}
                primaryAction={{
                  label: t("execution.clearFilters"),
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
                      aria-label={t("dashboard.executionHistory")}
                      className="min-w-[1040px]"
                      sortDescriptor={sortDescriptor}
                      onSortChange={(descriptor) =>
                        setSortDescriptor({
                          column: String(descriptor.column),
                          direction: descriptor.direction,
                        })
                      }
                    >
                      <Table.Header>
                        <SortableTableColumn id="kind" isRowHeader>
                          {t("dashboard.task")}
                        </SortableTableColumn>
                        <SortableTableColumn id="certificate">
                          {t("execution.certificate")}
                        </SortableTableColumn>
                        <SortableTableColumn id="target">{t("execution.target")}</SortableTableColumn>
                        <SortableTableColumn id="trigger">{t("execution.trigger")}</SortableTableColumn>
                        <SortableTableColumn id="startedAt">{t("execution.startedAt")}</SortableTableColumn>
                        <SortableTableColumn id="finishedAt">{t("execution.finishedAt")}</SortableTableColumn>
                        <SortableTableColumn id="status">{t("common.status")}</SortableTableColumn>
                        <Table.Column>{t("common.actions")}</Table.Column>
                      </Table.Header>
                      <Table.Body>
                        {paginatedExecutions.map((execution) => (
                          <Table.Row key={execution.id}>
                            <Table.Cell>{executionLabel(execution.kind)}</Table.Cell>
                            <Table.Cell>{execution.certificate || "-"}</Table.Cell>
                            <Table.Cell>{execution.target || "-"}</Table.Cell>
                            <Table.Cell>{triggerLabel(execution.trigger)}</Table.Cell>
                            <Table.Cell>{formatDateTime(execution.startedAt, locale)}</Table.Cell>
                            <Table.Cell>{formatDateTime(execution.finishedAt, locale)}</Table.Cell>
                            <Table.Cell>
                              <div className="table-status-stack">
                                <StatusTag status={execution.status} />
                                {execution.error ? (
                                  <small className="table-error">{errorLabel(execution)}</small>
                                ) : null}
                              </div>
                            </Table.Cell>
                            <Table.Cell>
                              <TableActions
                                actions={[
                                  {
                                    id: "details",
                                    label: t("common.details"),
                                    onPress: () => setSelected(execution),
                                  },
                                ]}
                              />
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
        title={selected ? executionLabel(selected.kind) : t("execution.details")}
        description={t("execution.detailsDescription")}
        headerIcon={<ListChecks size={20} />}
      >
        {selected ? (
          <div className="resource-detail">
            <dl className="resource-details">
              <div>
                <dt>{t("execution.kind")}</dt>
                <dd>{executionLabel(selected.kind)}</dd>
              </div>
              <div>
                <dt>{t("execution.trigger")}</dt>
                <dd>{triggerLabel(selected.trigger)}</dd>
              </div>
              <div>
                <dt>{t("execution.certificate")}</dt>
                <dd>{selected.certificate || "-"}</dd>
              </div>
              <div>
                <dt>{t("execution.target")}</dt>
                <dd>{selected.target || "-"}</dd>
              </div>
              <div>
                <dt>{t("execution.startedAt")}</dt>
                <dd>{formatDateTime(selected.startedAt, locale)}</dd>
              </div>
              <div>
                <dt>{t("execution.finishedAt")}</dt>
                <dd>{formatDateTime(selected.finishedAt, locale)}</dd>
              </div>
              <div>
                <dt>{t("common.status")}</dt>
                <dd>
                  <StatusTag status={selected.status} />
                </dd>
              </div>
              {selected.error ? (
                <div className="certificate-detail-wide">
                  <dt>{t("execution.error")}</dt>
                  <dd className="table-error">{errorLabel(selected)}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : null}
      </ResourceModal>
    </div>
  );
}
