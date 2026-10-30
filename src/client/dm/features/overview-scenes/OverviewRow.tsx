// An overview's row in the Scenes window (FR-OVW-14), beside the battle scenes': an Overview mark,
// "Live" on the shown one, Show, Rename, Duplicate, Move and Delete. Actions off while not live;
// viewing always works. Test IDs `ovw-scene-*`.
import { OVW_INTENTS, type OverviewRecord } from "@shared/overview-scenes/schemas";
import type { SceneFolderRecord } from "@shared/scenes-map/schemas";
import { Button } from "@ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@ui/components/ui/menus";
import { Tooltip } from "@ui/components/ui/overlays";
import { Badge } from "@ui/components/ui/primitives";
import { Tip } from "@ui/components/ui/tip";
import { toastReject, useMapIntent } from "@ui/features/scenes-map/intents";
import { cn } from "@ui/lib/utils";
import {
  CastIcon,
  CopyIcon,
  FolderIcon,
  FolderInputIcon,
  GlobeIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { useDmMap } from "../scenes-map/view-state";

export function OverviewRow({
  overview,
  folders,
  viewed,
  live,
  onRename,
  rowRef,
}: {
  overview: OverviewRecord;
  folders: readonly SceneFolderRecord[];
  viewed: boolean;
  live: boolean;
  onRename(): void;
  /** The row's button: FR-MAP-51's focus lands here. */
  rowRef: React.Ref<HTMLButtonElement>;
}) {
  const view = useDmMap((s) => s.view);
  const send = useMapIntent();
  const overviewId = overview.id;
  const show = () => send(OVW_INTENTS.show, { overviewId }).catch(toastReject);
  const move = (folderId: string | null) =>
    send(OVW_INTENTS.update, { overviewId, folderId }).catch(toastReject);
  return (
    <li
      data-testid="ovw-scene-row"
      data-record-id={overviewId}
      data-viewed={viewed || undefined}
      className={cn(
        "group flex items-center gap-1 rounded-md pr-1 hover:bg-accent",
        viewed && "bg-accent",
      )}
    >
      <button
        ref={rowRef}
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm"
        onClick={() => view(overviewId)}
        aria-current={viewed || undefined}
      >
        <Tooltip content="Overview">
          <GlobeIcon
            className="size-4 shrink-0 text-muted-foreground"
            aria-label="Overview"
            data-testid="ovw-scene-mark"
          />
        </Tooltip>
        <span className="truncate" data-testid="ovw-scene-row-name">
          {overview.name}
        </span>
        {overview.active && (
          <Badge data-testid="ovw-scene-live" className="ml-auto shrink-0">
            Live
          </Badge>
        )}
      </button>
      {!overview.active && (
        <span className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          <Tooltip content="Show to players">
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label={`Show ${overview.name} to players`}
              data-testid="ovw-scene-show"
              data-record-id={overviewId}
              disabled={!live}
              onClick={show}
            >
              <CastIcon className="size-4" />
            </Button>
          </Tooltip>
        </span>
      )}
      <DropdownMenu>
        <Tip content={`Actions for ${overview.name}`} off={!live}>
          <DropdownMenuTrigger asChild disabled={!live}>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label={`Actions for ${overview.name}`}
              data-testid="ovw-scene-menu"
              disabled={!live}
            >
              <MoreHorizontalIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="end">
          {!overview.active && (
            <>
              <DropdownMenuItem data-testid="ovw-scene-menu-show" onSelect={show}>
                <CastIcon /> Show to players
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem data-testid="ovw-scene-menu-rename" onSelect={onRename}>
            <PencilIcon /> Rename…
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="ovw-scene-menu-duplicate"
            onSelect={() => send(OVW_INTENTS.duplicate, { overviewId }).catch(toastReject)}
          >
            <CopyIcon /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid="ovw-scene-menu-move">
              <FolderInputIcon /> Move to…
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {folders.map((f) => (
                <DropdownMenuItem
                  key={f.id}
                  data-testid="ovw-scene-move-target"
                  data-record-id={f.id}
                  disabled={overview.folderId === f.id}
                  onSelect={() => move(f.id)}
                >
                  <FolderIcon /> {f.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem
                data-testid="ovw-scene-move-target"
                data-record-id=""
                disabled={overview.folderId === null}
                onSelect={() => move(null)}
              >
                Root
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            data-testid="ovw-scene-menu-delete"
            disabled={overview.active}
            onSelect={() =>
              send(OVW_INTENTS.delete, { overviewId }).then(() => {
                if (viewed) view(null);
              }, toastReject)
            }
          >
            <Trash2Icon /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
