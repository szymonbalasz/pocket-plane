// `map.scenes` (MAP §7): nested folders + scenes in list order (FR-MAP-02, -116), "Live" on the
// active scene, click views a scene (FR-MAP-08), row menus on "…" and right-click (FR-MAP-118),
// drag to arrange (FR-MAP-116), new scene / folder, a confirmed "Show to players" on non-active rows
// (FR-MAP-51, -119, `map.activateScene`). REST for list CRUD (ADR-0021 D). Actions disabled while
// not live; viewing always works. Overviews sit in the same list and folders (FR-OVW-14,
// `OverviewRow`); New offers Battle scene or Overview.
import type { AssetRecord } from "@shared/assets-pipeline/schemas";
import { OVERVIEW_TYPE, OVW_INTENTS, type OverviewRecord } from "@shared/overview-scenes/schemas";
import {
  canMoveFolder,
  canNestIn,
  folderSubtree,
  type SceneTreeNode,
  sceneTree,
} from "@shared/scenes-map/list-tree";
import {
  FolderName,
  MAP_INTENTS,
  SCENE_FOLDER_TYPE,
  SCENE_TYPE,
  type SceneFolderRecord,
  SceneName,
  type SceneRecord,
} from "@shared/scenes-map/schemas";
import { ApiError } from "@ui/api";
import { Button } from "@ui/components/ui/button";
import { ContextMenu, ContextMenuTrigger } from "@ui/components/ui/context-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ui/components/ui/menus";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ui/components/ui/overlays";
import { Input, Label, Skeleton } from "@ui/components/ui/primitives";
import { Tip } from "@ui/components/ui/tip";
import { AssetImg } from "@ui/features/assets-pipeline/AssetImg";
import { AssetPicker } from "@ui/features/assets-pipeline/AssetPicker";
import { defineWindow } from "@ui/features/play-shell/registry";
import { toastReject, useLive, useMapIntent } from "@ui/features/scenes-map/intents";
import { cn } from "@ui/lib/utils";
import { useRecords, useSync } from "@ui/sync/store";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderPlusIcon,
  GlobeIcon,
  MapIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { OverviewRow } from "../overview-scenes/OverviewRow";
import { flatRows } from "./list-drop";
import { ContextActions, DropdownActions, type MenuAction } from "./list-menu";
import {
  entryActions,
  type FolderOption,
  ListRow,
  moveActions,
  ScenesListContext,
  useScenesList,
} from "./list-row";
import { NameFormDialog } from "./NameFormDialog";
import { scenesRest } from "./rest";
import { useListDrag } from "./use-list-drag";
import { useDmMap, useViewedScene } from "./view-state";

export const SCENES_KIND = "map.scenes";

const fail = (err: unknown) => {
  toast.error(err instanceof Error ? err.message : "Something went wrong");
};

type Rename = { kind: "scene" | "folder" | "overview"; id: string; name: string } | null;

/** One row of the merged list: a battle scene's or an overview's (FR-OVW-14). */
type ListEntry = {
  id: string;
  name: string;
  seq: number;
  position: number;
  folderId: string | null;
} & (
  | { kind: "scene"; scene: SceneRecord; overview?: undefined }
  | { kind: "overview"; overview: OverviewRecord; scene?: undefined }
);

type ListNode = SceneTreeNode<SceneFolderRecord, ListEntry>;

/** What a row asks of the list beyond `ScenesListApi`: only the window's own dialogs and state. */
interface TreeProps {
  viewedId: string | null;
  isClosed(id: string): boolean;
  setOpen(id: string, open: boolean): void;
  onRename(r: Rename): void;
  onNew(kind: "scene" | "overview" | "folder", folderId: string | null): void;
  folders: readonly SceneFolderRecord[];
}

/** FR-MAP-51: the canvas badge asked for this row (window just opened or fronted). */
function useRowFocus(id: string) {
  const focus = useDmMap((s) => s.rowFocus === id);
  const rowButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!focus) return;
    useDmMap.getState().focusRow(null);
    rowButton.current?.scrollIntoView({ block: "nearest" });
    rowButton.current?.focus({ preventScroll: true });
  }, [focus]);
  return rowButton;
}

function SceneRow({
  scene,
  parentId,
  depth,
  viewed,
  onRename,
}: {
  scene: SceneRecord;
  parentId: string | null;
  depth: number;
  viewed: boolean;
  onRename(r: Rename): void;
}) {
  const api = useScenesList();
  const view = useDmMap((s) => s.view);
  const rowButton = useRowFocus(scene.id);
  return (
    <ListRow
      prefix="map"
      kind="scene"
      id={scene.id}
      name={scene.name}
      parentId={parentId}
      depth={depth}
      active={scene.active}
      viewed={viewed}
      rowRef={rowButton}
      onView={() => view(scene.id)}
      mark={<MapIcon className="size-4 shrink-0 text-muted-foreground" />}
      actions={entryActions(api, {
        prefix: "map",
        kind: "scene",
        id: scene.id,
        name: scene.name,
        parentId,
        active: scene.active,
        viewed,
        onRename: () => onRename({ kind: "scene", id: scene.id, name: scene.name }),
        onDuplicate: () => scenesRest.duplicateScene(scene.id).catch(fail),
      })}
    />
  );
}

function OverviewListRow(props: Omit<React.ComponentProps<typeof OverviewRow>, "rowRef">) {
  return <OverviewRow {...props} rowRef={useRowFocus(props.overview.id)} />;
}

/** FR-MAP-118: a folder's menu. New… fills it; subfolders stop at the depth cap (FR-MAP-02). */
function folderActions(
  api: ReturnType<typeof useScenesList>,
  folder: SceneFolderRecord,
  parentId: string | null,
  { folders, onRename, onNew }: TreeProps,
): MenuAction[] {
  return [
    {
      type: "item",
      testId: "map-folder-menu-new-battle",
      icon: <MapIcon />,
      label: "New battle scene…",
      onSelect: () => onNew("scene", folder.id),
    },
    {
      type: "item",
      testId: "map-folder-menu-new-overview",
      icon: <GlobeIcon />,
      label: "New overview…",
      onSelect: () => onNew("overview", folder.id),
    },
    {
      type: "item",
      testId: "map-folder-menu-new-folder",
      icon: <FolderPlusIcon />,
      label: "New subfolder…",
      disabled: !canNestIn(folders, folder.id),
      onSelect: () => onNew("folder", folder.id),
    },
    { type: "separator" },
    {
      type: "item",
      testId: "map-folder-menu-rename",
      icon: <PencilIcon />,
      label: "Rename…",
      onSelect: () => onRename({ kind: "folder", id: folder.id, name: folder.name }),
    },
    ...moveActions(
      api,
      "map-folder",
      { kind: "folder", id: folder.id, parentId },
      api.folderOptions.filter((f) => canMoveFolder(folders, folder.id, f.id)),
    ),
    { type: "separator" },
    {
      type: "item",
      testId: "map-folder-menu-delete",
      icon: <Trash2Icon />,
      label: "Delete folder",
      destructive: true,
      onSelect: () => scenesRest.deleteFolder(folder.id).catch(fail),
    },
  ];
}

function FolderNode({
  folder,
  items,
  parentId,
  depth,
  tree,
}: {
  folder: SceneFolderRecord;
  items: readonly ListNode[];
  parentId: string | null;
  depth: number;
  tree: TreeProps;
}) {
  const api = useScenesList();
  const { live } = api;
  const actions = folderActions(api, folder, parentId, tree);
  const dropInto = api.drop?.into === folder.id;
  return (
    <li
      data-testid="map-folder-row"
      data-record-id={folder.id}
      className={cn(api.dragId === folder.id && "opacity-40")}
    >
      <Collapsible
        open={!tree.isClosed(folder.id)}
        onOpenChange={(o) => tree.setOpen(folder.id, o)}
      >
        <ContextMenu>
          <ContextMenuTrigger asChild disabled={!live}>
            <div
              data-list-row={folder.id}
              data-drop-into={dropInto || undefined}
              className={cn(
                "group flex select-none items-center gap-1 rounded-md pr-1 hover:bg-accent",
                dropInto && "bg-accent ring-2 ring-primary ring-inset",
              )}
              onPointerDown={(e) =>
                api.startDrag(e, {
                  kind: "folder",
                  id: folder.id,
                  parentId,
                  depth,
                  open: !tree.isClosed(folder.id),
                })
              }
            >
              <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1.5 px-1 py-1.5 text-left text-sm font-medium [&[data-state=open]>svg:first-child]:rotate-90">
                <ChevronRightIcon className="size-4 shrink-0 transition-transform" />
                <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate" title={folder.name} data-testid="map-folder-row-name">
                  {folder.name}
                </span>
              </CollapsibleTrigger>
              <span data-no-drag className="flex shrink-0 items-center">
                <DropdownMenu>
                  <Tip content={`Actions for ${folder.name}`} off={!live}>
                    <DropdownMenuTrigger asChild disabled={!live}>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        aria-label={`Actions for ${folder.name}`}
                        data-testid="map-folder-menu"
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
        <CollapsibleContent>
          <ul className="ml-3 flex flex-col gap-0.5">
            <TreeNodes nodes={items} parentId={folder.id} depth={depth + 1} tree={tree} />
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

function TreeNodes({
  nodes,
  parentId,
  depth,
  tree,
}: {
  nodes: readonly ListNode[];
  parentId: string | null;
  depth: number;
  tree: TreeProps;
}) {
  return nodes.map((n) => {
    if (!n.item) {
      return (
        <FolderNode
          key={n.folder.id}
          folder={n.folder}
          items={n.children}
          parentId={parentId}
          depth={depth}
          tree={tree}
        />
      );
    }
    const { item } = n;
    return item.overview ? (
      <OverviewListRow
        key={item.id}
        overview={item.overview}
        parentId={parentId}
        depth={depth}
        viewed={item.id === tree.viewedId}
        onRename={() => tree.onRename({ kind: "overview", id: item.id, name: item.name })}
      />
    ) : (
      <SceneRow
        key={item.id}
        scene={item.scene}
        parentId={parentId}
        depth={depth}
        viewed={item.id === tree.viewedId}
        onRename={tree.onRename}
      />
    );
  });
}

/** FR-MAP-119, -120: "Show to players" and scene delete ask first. */
type Confirm = {
  testId: "map-scene-show" | "map-scene-delete";
  title: string;
  summary: string;
  action: string;
  destructive: boolean;
  run(): void;
};

function ConfirmDialog({
  confirm,
  onClose,
  live,
}: {
  confirm: Confirm | null;
  onClose(): void;
  live: boolean;
}) {
  // Kept through the closing frame, so the text doesn't vanish as the dialog leaves.
  const shown = useRef(confirm);
  if (confirm) shown.current = confirm;
  const c = shown.current;
  return (
    <Dialog open={confirm !== null} onOpenChange={(o) => !o && onClose()}>
      {c && (
        <DialogContent role="alertdialog" className="max-w-sm" data-testid={`${c.testId}-dialog`}>
          <DialogTitle>{c.title}</DialogTitle>
          <DialogDescription data-testid={`${c.testId}-summary`}>{c.summary}</DialogDescription>
          <DialogFooter>
            {/* Enter confirms a Show; a delete starts on Cancel. */}
            <Button
              variant="outline"
              data-testid={`${c.testId}-cancel`}
              autoFocus={c.destructive}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              variant={c.destructive ? "destructive" : "default"}
              data-testid={`${c.testId}-confirm`}
              autoFocus={!c.destructive}
              disabled={!live}
              onClick={() => {
                onClose();
                c.run();
              }}
            >
              {c.action}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

export function NewSceneDialog({
  open,
  onOpenChange,
  folderId = null,
}: {
  open: boolean;
  onOpenChange(o: boolean): void;
  /** Where the new scene goes (FR-MAP-118's "New battle scene…" on a folder). */
  folderId?: string | null;
}) {
  const [name, setName] = useState("");
  const [mapAssetId, setMap] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const view = useDmMap((s) => s.view);
  // BL-06: the chosen map's name from the asset records the picker already shows.
  const assets = useRecords<AssetRecord>("asset");
  const mapName = assets.find((a) => a.id === mapAssetId)?.name;
  const reset = () => {
    setName("");
    setMap(null);
    setError(null);
  };
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = SceneName.safeParse(name);
    if (!n.success) return setError(n.error.issues[0]?.message ?? "Invalid name");
    if (!mapAssetId) return setError("Choose a map image");
    setBusy(true);
    try {
      const r = await scenesRest.createScene({ name: n.data, mapAssetId, folderId });
      if (r) view(r.scene.id);
      onOpenChange(false);
      reset();
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-2xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>New scene</DialogTitle>
        </DialogHeader>
        <form className="flex min-h-0 flex-col gap-3" onSubmit={submit}>
          <Label htmlFor="map-scene-new-name">Name</Label>
          <Input
            id="map-scene-new-name"
            data-testid="map-scene-new-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            autoFocus
          />
          <div className="flex items-center gap-2 text-sm">
            <span>Map:</span>
            {mapAssetId ? (
              <>
                <AssetImg
                  id={mapAssetId}
                  file="thumb"
                  alt=""
                  className="h-10 w-16 shrink-0 rounded-sm"
                />
                <span
                  className="min-w-0 truncate"
                  title={mapName}
                  data-testid="map-scene-new-map-name"
                >
                  {mapName}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">none chosen</span>
            )}
          </div>
          {/* FR-MAP-86: inline, so its search never takes focus from the name. */}
          <AssetPicker
            className="max-h-[45vh]"
            context="map"
            selectLabel="Use as map"
            initialSelectedId={mapAssetId}
            onSelect={(id) => {
              setMap(id);
              setError(null);
            }}
          />
          {error && (
            <p className="text-sm text-destructive" data-testid="map-scene-new-error">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" data-testid="map-scene-new-submit" disabled={busy}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ScenesBody() {
  const scenes = useRecords<SceneRecord>(SCENE_TYPE);
  const folders = useRecords<SceneFolderRecord>(SCENE_FOLDER_TYPE);
  const overviews = useRecords<OverviewRecord>(OVERVIEW_TYPE);
  const everLive = useSync((s) => s.everLive);
  const live = useLive();
  const viewedNow = useViewedScene();
  const viewedId = viewedNow.overview?.id ?? viewedNow.viewed?.id ?? null;
  const view = useDmMap((s) => s.view);
  const send = useMapIntent();
  const tree = useMemo(() => {
    const rows: ListEntry[] = [
      ...scenes.map((scene) => ({
        id: scene.id,
        kind: "scene" as const,
        name: scene.name,
        seq: scene.seq,
        position: scene.position,
        folderId: scene.folderId,
        scene,
      })),
      ...overviews.map((overview) => ({
        id: overview.id,
        kind: "overview" as const,
        name: overview.name,
        seq: overview.seq,
        position: overview.position,
        folderId: overview.folderId,
        overview,
      })),
    ];
    return sceneTree(folders, rows);
  }, [folders, scenes, overviews]);
  // Move to…'s folders (a closed folder's too) and each level's order for Move up / down.
  const { folderOptions, levels } = useMemo(() => {
    const options: FolderOption[] = [];
    const byParent = new Map<string | null, string[]>();
    const walk = (nodes: readonly ListNode[], parent: string | null, depth: number) => {
      byParent.set(
        parent,
        nodes.map((n) => n.folder?.id ?? (n.item as ListEntry).id),
      );
      for (const n of nodes) {
        if (!n.folder) continue;
        options.push({ id: n.folder.id, name: n.folder.name, depth });
        walk(n.children, n.folder.id, depth + 1);
      }
    };
    walk(tree, null, 0);
    return { folderOptions: options, levels: byParent };
  }, [tree]);
  const [newScene, setNewScene] = useState<{ folderId: string | null } | null>(null);
  const [newOverview, setNewOverview] = useState<{ folderId: string | null } | null>(null);
  const [newFolder, setNewFolder] = useState<{ parentId: string | null } | null>(null);
  const [rename, setRename] = useState<Rename>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const setOpen = (id: string, open: boolean) =>
    setClosed((c) => {
      const n = new Set(c);
      if (open) n.delete(id);
      else n.add(id);
      return n;
    });
  // FR-MAP-51: a row asked for focus inside collapsed folders → expand them so the row renders.
  const rowFocus = useDmMap((s) => s.rowFocus);
  const focusFolder =
    (scenes.find((s) => s.id === rowFocus) ?? overviews.find((o) => o.id === rowFocus))?.folderId ??
    null;
  useEffect(() => {
    if (focusFolder === null) return;
    setClosed((c) => {
      const n = new Set(c);
      let at: string | null | undefined = focusFolder;
      while (at) {
        n.delete(at);
        const id: string = at;
        at = folders.find((f) => f.id === id)?.parentId;
      }
      return n.size === c.size ? c : n;
    });
  }, [focusFolder, folders]);

  const listRef = useRef<HTMLUListElement>(null);
  const move = (
    kind: "scene" | "overview" | "folder",
    id: string,
    parentId: string | null,
    beforeId: string | null,
  ) => {
    scenesRest.moveListEntry({ kind, id, parentId, beforeId }).catch(fail);
  };
  const rows = useMemo(() => flatRows(tree, (id) => closed.has(id)), [tree, closed]);
  const drag = useListDrag({
    listRef,
    rows,
    disabled: !live,
    subtreeOf: (row) =>
      row.kind === "folder" ? folderSubtree(folders, row.id) : new Set([row.id]),
    fits: (row, parentId) => row.kind !== "folder" || canMoveFolder(folders, row.id, parentId),
    onDrop: (row, drop) => {
      // Dropped into a closed folder: open it, so the entry stays in sight.
      if (drop.into) setOpen(drop.into, true);
      move(row.kind, row.id, drop.parentId, drop.beforeId);
    },
  });
  const shownName = (scenes.find((s) => s.active) ?? overviews.find((o) => o.active))?.name;
  const api = {
    live,
    folderOptions,
    siblings: (parentId: string | null) => levels.get(parentId) ?? [],
    move,
    dragId: drag.dragging?.id ?? null,
    drop: drag.dragging?.drop ?? null,
    startDrag: drag.start,
    askShow: ({ kind, id, name }: { kind: "scene" | "overview"; id: string; name: string }) =>
      setConfirm({
        testId: "map-scene-show",
        title: `Show ${name} to players?`,
        summary: shownName
          ? `Players will switch from ${shownName} to this ${kind === "scene" ? "scene" : "overview"} right away.`
          : `Players will see this ${kind === "scene" ? "scene" : "overview"} right away.`,
        action: "Show to players",
        destructive: false,
        run: () => {
          (kind === "scene"
            ? send(MAP_INTENTS.activateScene, { sceneId: id })
            : send(OVW_INTENTS.show, { overviewId: id })
          ).catch(toastReject);
        },
      }),
    askDelete: ({
      kind,
      id,
      name,
      viewed,
    }: {
      kind: "scene" | "overview";
      id: string;
      name: string;
      viewed: boolean;
    }) =>
      setConfirm({
        testId: "map-scene-delete",
        title: `Delete ${name}?`,
        summary:
          kind === "scene"
            ? "Its tokens go with it. This can't be undone."
            : "Its images, labels and miniatures go with it. This can't be undone.",
        action: "Delete",
        destructive: true,
        run: () => {
          const done = () => {
            if (viewed) view(null);
          };
          if (kind === "scene") scenesRest.deleteScene(id).then(done).catch(fail);
          else send(OVW_INTENTS.delete, { overviewId: id }).then(done, toastReject);
        },
      }),
  };
  const treeProps: TreeProps = {
    viewedId,
    isClosed: (id) => closed.has(id),
    setOpen,
    onRename: setRename,
    onNew: (kind, folderId) => {
      if (kind === "scene") setNewScene({ folderId });
      else if (kind === "overview") setNewOverview({ folderId });
      else setNewFolder({ parentId: folderId });
    },
    folders,
  };
  const rootActions: MenuAction[] = [
    {
      type: "item",
      testId: "map-list-menu-new-battle",
      icon: <MapIcon />,
      label: "New battle scene…",
      onSelect: () => setNewScene({ folderId: null }),
    },
    {
      type: "item",
      testId: "map-list-menu-new-overview",
      icon: <GlobeIcon />,
      label: "New overview…",
      onSelect: () => setNewOverview({ folderId: null }),
    },
    {
      type: "item",
      testId: "map-list-menu-new-folder",
      icon: <FolderPlusIcon />,
      label: "New folder…",
      onSelect: () => setNewFolder({ parentId: null }),
    },
  ];
  const line = drag.dragging?.drop && !drag.dragging.drop.into ? drag.dragging.drop : null;

  return (
    <section
      aria-label="Scenes"
      data-testid="map-scenes"
      className="flex h-full min-h-0 flex-col gap-2"
    >
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={!live}>
            <Button size="sm" data-testid="map-scene-new" disabled={!live}>
              <PlusIcon className="size-4" /> New <ChevronDownIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              data-testid="map-scene-new-battle"
              onSelect={() => setNewScene({ folderId: null })}
            >
              <MapIcon /> Battle scene…
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="ovw-scene-new"
              onSelect={() => setNewOverview({ folderId: null })}
            >
              <GlobeIcon /> Overview…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          size="sm"
          variant="secondary"
          data-testid="map-folder-new"
          disabled={!live}
          onClick={() => setNewFolder({ parentId: null })}
        >
          <FolderPlusIcon className="size-4" /> New folder
        </Button>
      </div>
      {!everLive ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </div>
      ) : scenes.length === 0 && overviews.length === 0 && folders.length === 0 ? (
        <p
          data-testid="map-scenes-empty"
          className="py-6 text-center text-sm text-muted-foreground"
        >
          No scenes yet. Create one from an uploaded map.
        </p>
      ) : (
        <ScenesListContext.Provider value={api}>
          <ContextMenu>
            <ContextMenuTrigger asChild disabled={!live}>
              <ul
                ref={listRef}
                className="relative flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto"
                aria-label="Scene list"
                data-testid="map-scene-list"
              >
                <TreeNodes nodes={tree} parentId={null} depth={0} tree={treeProps} />
                {line && (
                  <li
                    aria-hidden
                    data-testid="map-list-drop"
                    data-parent={line.parentId ?? ""}
                    data-before={line.beforeId ?? ""}
                    className="pointer-events-none absolute right-0 z-30 h-0.5 -translate-y-1/2 rounded bg-primary"
                    style={{ top: line.y, left: `${line.depth * 0.75}rem` }}
                  />
                )}
              </ul>
            </ContextMenuTrigger>
            <ContextActions actions={rootActions} />
          </ContextMenu>
        </ScenesListContext.Provider>
      )}
      <NewSceneDialog
        open={newScene !== null}
        onOpenChange={(o) => !o && setNewScene(null)}
        folderId={newScene?.folderId ?? null}
      />
      <NameFormDialog
        open={newOverview !== null}
        onOpenChange={(o) => !o && setNewOverview(null)}
        title="New overview"
        schema={SceneName}
        testId="ovw-scene-new-form"
        submitLabel="Create"
        onSubmit={async (name) => {
          const r = (await send(OVW_INTENTS.create, {
            name,
            folderId: newOverview?.folderId ?? null,
          })) as { overviewId: string };
          view(r.overviewId);
        }}
      />
      <NameFormDialog
        open={newFolder !== null}
        onOpenChange={(o) => !o && setNewFolder(null)}
        title={newFolder?.parentId ? "New subfolder" : "New folder"}
        schema={FolderName}
        testId="map-folder-new-form"
        submitLabel="Create"
        onSubmit={(name) => scenesRest.createFolder(name, newFolder?.parentId ?? null)}
      />
      <NameFormDialog
        open={rename !== null}
        onOpenChange={(o) => !o && setRename(null)}
        title={
          rename?.kind === "folder"
            ? "Rename folder"
            : rename?.kind === "overview"
              ? "Rename overview"
              : "Rename scene"
        }
        initial={rename?.name}
        schema={rename?.kind === "folder" ? FolderName : SceneName}
        testId="map-rename"
        onSubmit={(name) =>
          rename?.kind === "folder"
            ? scenesRest.renameFolder(rename.id, name)
            : rename?.kind === "overview"
              ? send(OVW_INTENTS.update, { overviewId: rename.id, name })
              : scenesRest.patchScene(rename?.id as string, { name })
        }
      />
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} live={live} />
    </section>
  );
}

export const scenesWindow = defineWindow({
  kind: SCENES_KIND,
  title: "Scenes",
  clients: ["dm"],
  // Map-first (#162): closed by default, narrow; opens at the left edge. dx clears the tool
  // rail, which sits above windows on the left edge.
  defaultSize: { w: 260, h: 440 },
  minSize: { w: 240, h: 240 },
  defaultPosition: { anchor: "top-left", dx: 56 },
  launcher: { icon: MapIcon, label: "Scenes", order: 20 },
  component: ScenesBody,
});
