"use client";

import { Button, ButtonGroup, Dropdown } from "@heroui/react";
import { Ellipsis } from "lucide-react";

export type TableAction = {
  id: string;
  label: string;
  onPress: () => void;
  isDisabled?: boolean;
  isPending?: boolean;
  pendingLabel?: string;
  tone?: "default" | "danger";
};

// Tables use a compact action budget: the three most common commands remain
// visible and lower-frequency or destructive commands are collected in More.
export function TableActions({ actions }: { actions: TableAction[] }) {
  const visibleActions = actions.slice(0, 3);
  const moreActions = actions.slice(3);

  return (
    <ButtonGroup className="table-action-group" size="sm" variant="tertiary">
      {visibleActions.map((action, index) => (
        <Button
          aria-busy={action.isPending || undefined}
          isDisabled={action.isDisabled}
          key={action.id}
          onPress={action.onPress}
        >
          {index > 0 ? <ButtonGroup.Separator /> : null}
          {action.isPending ? action.pendingLabel ?? `${action.label}中` : action.label}
        </Button>
      ))}
      {moreActions.length > 0 ? (
        <Dropdown>
          <Button isIconOnly aria-label="更多操作" size="sm" variant="tertiary">
            {visibleActions.length > 0 ? <ButtonGroup.Separator /> : null}
            <Ellipsis size={16} />
          </Button>
          <Dropdown.Popover placement="bottom end">
            <Dropdown.Menu
              onAction={(key) => {
                const action = moreActions.find((item) => item.id === String(key));
                if (action && !action.isDisabled) action.onPress();
              }}
            >
              {moreActions.map((action) => (
                <Dropdown.Item
                  className={action.tone === "danger" ? "danger-menu-item" : undefined}
                  id={action.id}
                  isDisabled={action.isDisabled}
                  key={action.id}
                >
                  {action.label}
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      ) : null}
    </ButtonGroup>
  );
}
