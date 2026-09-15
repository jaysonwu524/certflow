"use client";

import { ListBox, Pagination, Select } from "@heroui/react";
import { useLocale } from "@/components/providers/locale-provider";

type ResourcePaginationProps = {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

const pageSizeOptions = [10, 20, 50, 100];

function pageItems(page: number, pageCount: number): Array<number | "ellipsis-left" | "ellipsis-right"> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);
  const items: Array<number | "ellipsis-left" | "ellipsis-right"> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pageCount - 1, page + 1);
  if (start > 2) items.push("ellipsis-left");
  for (let value = start; value <= end; value += 1) items.push(value);
  if (end < pageCount - 1) items.push("ellipsis-right");
  items.push(pageCount);
  return items;
}

export function ResourcePagination({ page, pageCount, total, pageSize, onPageChange, onPageSizeChange }: ResourcePaginationProps) {
  const { t } = useLocale();
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <Pagination className="resource-pagination" size="sm">
      <div className="resource-pagination-meta">
        <Pagination.Summary>
          {t("common.showing").replace("{start}", String(start)).replace("{end}", String(end)).replace("{total}", String(total))}
        </Pagination.Summary>
        <div className="resource-page-size-field">
          <span>{t("common.perPage")}</span>
          <Select
            aria-label={t("common.pageSize")}
            selectedKey={String(pageSize)}
            onSelectionChange={(key) => onPageSizeChange(Number(key))}
          >
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {pageSizeOptions.map((size) => (
                  <ListBox.Item key={size} id={String(size)}>
                    {t("common.items").replace("{count}", String(size))}
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>
      </div>
      <Pagination.Content>
        <Pagination.Item>
          <Pagination.Previous
            aria-label={t("common.previousPage")}
            isDisabled={page <= 1}
            onPress={() => onPageChange(Math.max(1, page - 1))}
          >
            <Pagination.PreviousIcon />
          </Pagination.Previous>
        </Pagination.Item>
        {pageItems(page, pageCount).map((item) =>
          typeof item === "number" ? (
            <Pagination.Item key={item}>
              <Pagination.Link isActive={item === page} onPress={() => onPageChange(item)}>
                {item}
              </Pagination.Link>
            </Pagination.Item>
          ) : (
            <Pagination.Item key={item}>
              <Pagination.Ellipsis />
            </Pagination.Item>
          ),
        )}
        <Pagination.Item>
          <Pagination.Next
            aria-label={t("common.nextPage")}
            isDisabled={page >= pageCount}
            onPress={() => onPageChange(Math.min(pageCount, page + 1))}
          >
            <Pagination.NextIcon />
          </Pagination.Next>
        </Pagination.Item>
      </Pagination.Content>
    </Pagination>
  );
}
