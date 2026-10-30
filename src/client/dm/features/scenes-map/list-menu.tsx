// FR-MAP-118: a Scenes list row's actions as data, drawn in both of its menus: the "…" button's and
// the right-click one. Same items, same test IDs; only one is ever open.
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@ui/components/ui/context-menu";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@ui/components/ui/menus";
import type { ComponentType, ReactNode } from "react";

export type MenuAction =
  | {
      type: "item";
      testId: string;
      recordId?: string;
      icon?: ReactNode;
      label: ReactNode;
      disabled?: boolean;
      destructive?: boolean;
      /** A level in a nested list (Move to…). */
      indent?: number;
      onSelect(): void;
    }
  | { type: "separator" }
  | { type: "sub"; testId: string; icon: ReactNode; label: ReactNode; items: MenuAction[] };

interface ItemProps {
  "data-testid"?: string;
  "data-record-id"?: string;
  disabled?: boolean;
  variant?: "destructive";
  style?: React.CSSProperties;
  onSelect?(): void;
  children?: ReactNode;
}

interface MenuParts {
  Item: ComponentType<ItemProps>;
  Separator: ComponentType;
  Sub: ComponentType<{ children?: ReactNode }>;
  SubTrigger: ComponentType<{ "data-testid"?: string; children?: ReactNode }>;
  SubContent: ComponentType<{ children?: ReactNode }>;
}

const DROPDOWN: MenuParts = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
};

const CONTEXT: MenuParts = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
};

function Items({ actions, ui }: { actions: readonly MenuAction[]; ui: MenuParts }) {
  return actions.map((a, i) => {
    if (a.type === "separator") {
      // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity; the list is fixed per render.
      return <ui.Separator key={i} />;
    }
    if (a.type === "sub") {
      return (
        <ui.Sub key={a.testId}>
          <ui.SubTrigger data-testid={a.testId}>
            {a.icon} {a.label}
          </ui.SubTrigger>
          <ui.SubContent>
            <Items actions={a.items} ui={ui} />
          </ui.SubContent>
        </ui.Sub>
      );
    }
    return (
      <ui.Item
        key={`${a.testId}:${a.recordId ?? ""}`}
        data-testid={a.testId}
        data-record-id={a.recordId}
        disabled={a.disabled}
        variant={a.destructive ? "destructive" : undefined}
        style={a.indent ? { paddingLeft: `${0.5 + a.indent * 0.75}rem` } : undefined}
        onSelect={a.onSelect}
      >
        {a.icon} {a.label}
      </ui.Item>
    );
  });
}

export function DropdownActions({ actions }: { actions: readonly MenuAction[] }) {
  return (
    <DropdownMenuContent align="end">
      <Items actions={actions} ui={DROPDOWN} />
    </DropdownMenuContent>
  );
}

export function ContextActions({ actions }: { actions: readonly MenuAction[] }) {
  return (
    <ContextMenuContent>
      <Items actions={actions} ui={CONTEXT} />
    </ContextMenuContent>
  );
}
