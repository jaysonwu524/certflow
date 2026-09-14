import type { ReactNode } from "react";
import { Table } from "@heroui/react";

export function SortableTableColumn({ id, children, isRowHeader = false }: { id: string; children: ReactNode; isRowHeader?: boolean }) {
  return (
    <Table.Column id={id} isRowHeader={isRowHeader} allowsSorting>
      {({ sortDirection }) => <Table.SortableColumnHeader sortDirection={sortDirection}>{children}</Table.SortableColumnHeader>}
    </Table.Column>
  );
}
