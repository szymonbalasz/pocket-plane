// One scene's or overview's row in the Scenes window (FR-MAP-51, FR-MAP-116–119, FR-OVW-14):
// name, "Live", a Show button that always looks like a button, the "…" menu, the same menu on
// right-click, and the drag. Test IDs `<prefix>-scene-*`.
import { moveSteps } from "@shared/scenes-map/list-tree";
import type { ListEntryKind } from "@shared/scenes-map/schemas";
import { Button } from "@ui/components/ui/button";
import { ContextMenu, ContextMenuTrigger } from "@ui/components/ui/context-menu";
import { DropdownMenu, DropdownMenuTrigger } from "@ui/components/ui/menus";
import { Tooltip } from "@ui/components/ui/overlays";
import { Badge } from "@ui/components/ui/primitives";
import { Tip } from "@ui/components/ui/tip";
import { cn } from "@ui/lib/utils";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CastIcon,
  CopyIcon,
  FolderIcon,
  FolderInputIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { createContext, type ReactNode, type Ref, useContext } from "react";
import type { Drop, FlatRow } from "./list-drop";
import { ContextActions, DropdownActions, type MenuAction } from "./list-menu";

/** A folder offered by Move to…, in list order. */
export interface FolderOption {
  id: string;
  name: string;
  depth: number;
}

export interface ScenesListApi {
  live: boolean;
  folderOptions: readonly FolderOption[];
  /** The ids of `parentId`'s level, in list order (Move up / down). */
  siblings(parentId: string | null): readonly string[];
  move(kind: ListEntryKind, id: string, parentId: string | null, beforeId: string | null): void;
  /** The drag: the entry dragged, the landing spot, and the press that starts one. */
  dragId: string | null;
  drop: Drop | null;
  startDrag(e: React.PointerEvent<HTMLElement>, row: FlatRow): void;
  askShow(entry: { kind: "scene" | "overview"; id: string; name: string }): void;
  askDelete(entry: { kind: "scene" | "overview"; id: string; name: string; viewed: boolean }): void;
}

export const ScenesListContext = createContext<ScenesListApi | null>(null);

export const useScenesList = (): ScenesListApi => {
  const api = useContext(ScenesListContext);
  if (!api) throw new Error("A Scenes list row needs ScenesListContext");
  return api;
};

/** The Move to… folders, Root and Move up / down of one entry. */
export function moveActions(
  api: ScenesListApi,
  prefix: string,
  { kind, id, parentId }: { kind: ListEntryKind; id: string; parentId: string | null },
  folders: readonly FolderOption[] = api.folderOptions,
): MenuAction[] {
  const { up, down } = moveSteps(api.siblings(parentId), id);
  return [
    {
      type: "sub",
      testId: `${prefix}-menu-move`,
      icon: <FolderInputIcon />,
      label: "Move to…",
      items: [
        ...folders.map(
          (f): MenuAction => ({
            type: "item",
            testId: `${prefix}-move-target`,
            recordId: f.id,
            icon: <FolderIcon />,
            label: f.name,
            indent: f.depth,
            disabled: parentId === f.id,
            onSelect: () => api.move(kind, id, f.id, null),
          }),
        ),
        {
          type: "item",
          testId: `${prefix}-move-target`,
          recordId: "",
          label: "Root",
          disabled: parentId === null,
          onSelect: () => api.move(kind, id, null, null),
        },
      ],
    },
    {
      type: "item",
      testId: `${prefix}-menu-move-up`,
      icon: <ArrowUpIcon />,
      label: "Move up",
      disabled: !up,
      onSelect: () => up && api.move(kind, id, parentId, up.beforeId),
    },
    {
      type: "item",
      testId: `${prefix}-menu-move-down`,
      icon: <ArrowDownIcon />,
      label: "Move down",
      disabled: !down,
      onSelect: () => down && api.move(kind, id, parentId, down.beforeId),
    },
  ];
}

/** The menu of a scene or overview row (FR-OVW-14: same actions on both). */
export function entryActions(
  api: ScenesListApi,
  e: {
    prefix: "map" | "ovw";
    kind: "scene" | "overview";
    id: string;
    name: string;
    parentId: string | null;
    active: boolean;
    viewed: boolean;
    onRename(): void;
    onDuplicate(): void;
  },
): MenuAction[] {
  const p = `${e.prefix}-scene`;
  const show: MenuAction[] = e.active
    ? []
    : [
        {
          type: "item",
          testId: `${p}-menu-show`,
          icon: <CastIcon />,
          label: "Show to players",
          onSelect: () => api.askShow(e),
        },
        { type: "separator" },
      ];
  return [
    ...show,
    {
      type: "item",
      testId: `${p}-menu-rename`,
      icon: <PencilIcon />,
      label: "Rename…",
      onSelect: e.onRename,
    },
    {
      type: "item",
      testId: `${p}-menu-duplicate`,
      icon: <CopyIcon />,
      label: "Duplicate",
      onSelect: e.onDuplicate,
    },
    ...moveActions(api, p, e),
    { type: "separator" },
    {
      type: "item",
      testId: `${p}-menu-delete`,
      icon: <Trash2Icon />,
      label: "Delete…",
      destructive: true,
      disabled: e.active,
      onSelect: () => api.askDelete(e),
    },
  ];
}

export function ListRow({
  prefix,
  kind,
  id,
  name,
  parentId,
  depth,
  active,
  viewed,
  mark,
  rowRef,
  onView,
  actions,
}: {
  prefix: "map" | "ovw";
  kind: "scene" | "overview";
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  active: boolean;
  viewed: boolean;
  mark: ReactNode;
  /** The row's button: FR-MAP-51's focus lands here. */
  rowRef: Ref<HTMLButtonElement>;
  onView(): void;
  actions: readonly MenuAction[];
}) {
  const api = useScenesList();
  const { live } = api;
  const p = `${prefix}-scene`;
  return (
    <li
      data-testid={`${p}-row`}
      data-record-id={id}
      data-viewed={viewed || undefined}
      className={cn(api.dragId === id && "opacity-40")}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild disabled={!live}>
          <div
            data-list-row={id}
            className={cn(
              "group flex select-none items-center gap-1 rounded-md pr-1 hover:bg-accent",
              viewed && "bg-accent",
            )}
            onPointerDown={(e) => api.startDrag(e, { kind, id, parentId, depth, open: false })}
          >
            <button
              ref={rowRef}
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm"
              onClick={onView}
              aria-current={viewed || undefined}
            >
              {mark}
              <span className="truncate" title={name} data-testid={`${p}-row-name`}>
                {name}
              </span>
              {active && (
                <Badge data-testid={`${p}-live`} className="ml-auto shrink-0">
                  Live
                </Badge>
              )}
            </button>
            <span data-no-drag className="flex shrink-0 items-center gap-1">
              {/* FR-MAP-119: always there, always a button; the active row has "Live" instead. */}
              {!active && (
                <Tooltip content="Show to players">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 gap-1 px-2 text-xs"
                    aria-label={`Show ${name} to players`}
                    data-testid={`${p}-show`}
                    data-record-id={id}
                    disabled={!live}
                    onClick={() => api.askShow({ kind, id, name })}
                  >
                    <CastIcon className="size-3.5" /> Show
                  </Button>
                </Tooltip>
              )}
              <DropdownMenu>
                <Tip content={`Actions for ${name}`} off={!live}>
                  <DropdownMenuTrigger asChild disabled={!live}>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label={`Actions for ${name}`}
                      data-testid={`${p}-menu`}
                      disabled={!live}
                    >
                      <MoreHorizontalIcon className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </Tip>
                <DropdownActions actions={actions} />
              </DropdownMenu>
            </span>
          </div>
        </ContextMenuTrigger>
        <ContextActions actions={actions} />
      </ContextMenu>
    </li>
  );
}
