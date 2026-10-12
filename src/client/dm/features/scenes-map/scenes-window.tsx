// `map.scenes` (MAP §7): folders + scenes in list order (FR-MAP-02), "Live" on the active scene,
// click views a scene (FR-MAP-08), row menus (rename, duplicate, move, delete), new scene / folder.
// REST for list CRUD (ADR-0021 D). Actions disabled while not live; viewing always works.
import { sceneList } from "@shared/scenes-map/geometry";
import {
  FolderName,
  SCENE_FOLDER_TYPE,
  SCENE_TYPE,
  type SceneFolderRecord,
  SceneName,
  type SceneRecord,
} from "@shared/scenes-map/schemas";
import { ApiError } from "@ui/api";
import { Button } from "@ui/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@ui/components/ui/menus";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ui/components/ui/overlays";
import { Badge, Input, Label, Skeleton } from "@ui/components/ui/primitives";
import { AssetImg } from "@ui/features/assets-pipeline/AssetImg";
import { defineWindow } from "@ui/features/play-shell/registry";
import { useLive } from "@ui/features/scenes-map/intents";
import { cn } from "@ui/lib/utils";
import { useRecords, useSync } from "@ui/sync/store";
import {
  ChevronRightIcon,
  CopyIcon,
  FolderIcon,
  FolderInputIcon,
  FolderPlusIcon,
  MapIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AssetPicker } from "../assets-pipeline/AssetPicker";
import { NameFormDialog } from "./NameFormDialog";
import { scenesRest } from "./rest";
import { useDmMap, viewedScene } from "./view-state";

export const SCENES_KIND = "map.scenes";

const fail = (err: unknown) => {
  toast.error(err instanceof Error ? err.message : "Something went wrong");
};

type Rename = { kind: "scene" | "folder"; id: string; name: string } | null;

function SceneRow({
  scene,
  folders,
  viewed,
  live,
  onRename,
}: {
  scene: SceneRecord;
  folders: SceneFolderRecord[];
  viewed: boolean;
  live: boolean;
  onRename(r: Rename): void;
}) {
  const view = useDmMap((s) => s.view);
  const select = useDmMap((s) => s.select);
  return (
    <li
      data-testid="map-scene-row"
      data-record-id={scene.id}
      data-viewed={viewed || undefined}
      className={cn(
        "group flex items-center gap-1 rounded-md pr-1 hover:bg-accent",
        viewed && "bg-accent",
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm"
        onClick={() => view(scene.id)}
        aria-current={viewed || undefined}
      >
        <MapIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate" data-testid="map-scene-row-name">
          {scene.name}
        </span>
        {scene.active && (
          <Badge data-testid="map-scene-live" className="ml-auto shrink-0">
            Live
          </Badge>
        )}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={!live}>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label={`Actions for ${scene.name}`}
            data-testid="map-scene-menu"
            disabled={!live}
          >
            <MoreHorizontalIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            data-testid="map-scene-menu-rename"
            onSelect={() => onRename({ kind: "scene", id: scene.id, name: scene.name })}
          >
            <PencilIcon /> Rename…
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="map-scene-menu-duplicate"
            onSelect={() => scenesRest.duplicateScene(scene.id).catch(fail)}
          >
            <CopyIcon /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid="map-scene-menu-move">
              <FolderInputIcon /> Move to…
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {folders.map((f) => (
                <DropdownMenuItem
                  key={f.id}
                  data-testid="map-scene-move-target"
                  data-record-id={f.id}
                  disabled={scene.folderId === f.id}
                  onSelect={() => scenesRest.patchScene(scene.id, { folderId: f.id }).catch(fail)}
                >
                  <FolderIcon /> {f.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem
                data-testid="map-scene-move-target"
                data-record-id=""
                disabled={scene.folderId === null}
                onSelect={() => scenesRest.patchScene(scene.id, { folderId: null }).catch(fail)}
              >
                Root
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            data-testid="map-scene-menu-delete"
            disabled={scene.active}
            onSelect={() =>
              scenesRest
                .deleteScene(scene.id)
                .then(() => {
                  if (viewed) {
                    view(null);
                    select(null);
                  }
                })
                .catch(fail)
            }
          >
            <Trash2Icon /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function NewSceneDialog({ open, onOpenChange }: { open: boolean; onOpenChange(o: boolean): void }) {
  const [name, setName] = useState("");
  const [mapAssetId, setMap] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const view = useDmMap((s) => s.view);
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
      const r = await scenesRest.createScene({ name: n.data, mapAssetId });
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
              <AssetImg id={mapAssetId} file="thumb" alt="" className="h-10 w-16 rounded-sm" />
            ) : (
              <span className="text-muted-foreground">none chosen</span>
            )}
          </div>
          <AssetPicker
            className="max-h-[45vh]"
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

function ScenesBody() {
  const scenes = useRecords<SceneRecord>(SCENE_TYPE);
  const folders = useRecords<SceneFolderRecord>(SCENE_FOLDER_TYPE);
  const everLive = useSync((s) => s.everLive);
  const live = useLive();
  const requested = useDmMap((s) => s.viewedSceneId);
  const viewedId = viewedScene(scenes, folders, requested)?.id ?? null;
  const list = useMemo(() => sceneList(folders, scenes), [folders, scenes]);
  const sortedFolders = useMemo(() => list.flatMap((e) => (e.folder ? [e.folder] : [])), [list]);
  const [newScene, setNewScene] = useState(false);
  const [newFolder, setNewFolder] = useState(false);
  const [rename, setRename] = useState<Rename>(null);
  const [closed, setClosed] = useState<Set<string>>(new Set());

  return (
    <section aria-label="Scenes" data-testid="map-scenes" className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          data-testid="map-scene-new"
          disabled={!live}
          onClick={() => setNewScene(true)}
        >
          <PlusIcon className="size-4" /> New scene
        </Button>
        <Button
          size="sm"
          variant="secondary"
          data-testid="map-folder-new"
          disabled={!live}
          onClick={() => setNewFolder(true)}
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
      ) : scenes.length === 0 && folders.length === 0 ? (
        <p
          data-testid="map-scenes-empty"
          className="py-6 text-center text-sm text-muted-foreground"
        >
          No scenes yet. Create one from an uploaded map.
        </p>
      ) : (
        <ul className="flex min-h-0 flex-col gap-0.5 overflow-auto" aria-label="Scene list">
          {list.map((entry) =>
            entry.folder ? (
              <li
                key={entry.folder.id}
                data-testid="map-folder-row"
                data-record-id={entry.folder.id}
              >
                <Collapsible
                  open={!closed.has(entry.folder.id)}
                  onOpenChange={(o) => {
                    const id = entry.folder?.id as string;
                    setClosed((c) => {
                      const n = new Set(c);
                      if (o) n.delete(id);
                      else n.add(id);
                      return n;
                    });
                  }}
                >
                  <div className="group flex items-center gap-1 rounded-md pr-1 hover:bg-accent">
                    <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1.5 px-1 py-1.5 text-left text-sm font-medium [&[data-state=open]>svg:first-child]:rotate-90">
                      <ChevronRightIcon className="size-4 shrink-0 transition-transform" />
                      <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate" data-testid="map-folder-row-name">
                        {entry.folder.name}
                      </span>
                    </CollapsibleTrigger>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild disabled={!live}>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          aria-label={`Actions for ${entry.folder.name}`}
                          data-testid="map-folder-menu"
                          disabled={!live}
                        >
                          <MoreHorizontalIcon className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          data-testid="map-folder-menu-rename"
                          onSelect={() =>
                            setRename({
                              kind: "folder",
                              id: entry.folder?.id as string,
                              name: entry.folder?.name as string,
                            })
                          }
                        >
                          <PencilIcon /> Rename…
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          data-testid="map-folder-menu-delete"
                          onSelect={() =>
                            scenesRest.deleteFolder(entry.folder?.id as string).catch(fail)
                          }
                        >
                          <Trash2Icon /> Delete folder
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <CollapsibleContent>
                    <ul className="ml-4 flex flex-col gap-0.5">
                      {entry.scenes.map((s) => (
                        <SceneRow
                          key={s.id}
                          scene={s}
                          folders={sortedFolders}
                          viewed={s.id === viewedId}
                          live={live}
                          onRename={setRename}
                        />
                      ))}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>
              </li>
            ) : (
              entry.scenes.map((s) => (
                <SceneRow
                  key={s.id}
                  scene={s}
                  folders={sortedFolders}
                  viewed={s.id === viewedId}
                  live={live}
                  onRename={setRename}
                />
              ))
            ),
          )}
        </ul>
      )}
      <NewSceneDialog open={newScene} onOpenChange={setNewScene} />
      <NameFormDialog
        open={newFolder}
        onOpenChange={setNewFolder}
        title="New folder"
        schema={FolderName}
        testId="map-folder-new-form"
        submitLabel="Create"
        onSubmit={(name) => scenesRest.createFolder(name)}
      />
      <NameFormDialog
        open={rename !== null}
        onOpenChange={(o) => !o && setRename(null)}
        title={rename?.kind === "folder" ? "Rename folder" : "Rename scene"}
        initial={rename?.name}
        schema={rename?.kind === "folder" ? FolderName : SceneName}
        testId="map-rename"
        onSubmit={(name) =>
          rename?.kind === "folder"
            ? scenesRest.renameFolder(rename.id, name)
            : scenesRest.patchScene(rename?.id as string, { name })
        }
      />
    </section>
  );
}

export const scenesWindow = defineWindow({
  kind: SCENES_KIND,
  title: "Scenes",
  clients: ["dm"],
  defaultSize: { w: 300, h: 480 },
  minSize: { w: 240, h: 240 },
  // dx clears the tool rail, which sits above windows on the left edge.
  defaultPosition: { anchor: "top-left", dx: 56 },
  defaultOpen: true,
  launcher: { icon: MapIcon, label: "Scenes", order: 20 },
  component: ScenesBody,
});
