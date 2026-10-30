// The DM's editing surfaces beside the overview canvas (FR-OVW-16, -21–23, -32): the item menu, the
// keys, the delete confirm and the asset picker. Menus act on the selection if the item is in it. Editing
// is off while not live (FR-OVW-47). Keys inside windows never reach here (FR-SHELL-13).
import type { AssetRecord } from "@shared/assets-pipeline/schemas";
import {
  ArrowDownToLineIcon,
  ArrowUpToLineIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  Trash2Icon,
  UnlockIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/menus";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "../../components/ui/overlays";
import { useRecords } from "../../sync/store";
import { AssetPickerDialog } from "../assets-pipeline/AssetPicker";
import { useBaseKeyDown } from "../play-shell/hooks";
import { toastReject, useLive, useMapIntent } from "../scenes-map/intents";
import { useAddHidden } from "./add-hidden";
import {
  askDelete,
  confirmedDelete,
  duplicate,
  menuTargets,
  placeImageFrom,
  setHidden,
  setLocked,
  stack,
  swapImage,
} from "./item-actions";
import type { OverviewItemView } from "./item-layout";
import type { ItemSend } from "./items/item-kind";
import { ITEM_KIND_DEFS } from "./items/kinds";
import { MiniatureNameDialog } from "./items/MiniatureMenu";
import { placeMiniatureFrom, updateMiniature } from "./miniature-actions";
import { dispatchItemSelection, selectedItems, useOverviewEditor } from "./overview-editor";

export const LOCKED_NOT_DELETED = "Locked — unlock it first";

/**
 * FR-OVW-21's keys, canvas focused. Delete leaves locked items: with no undo, a stray click and key
 * must not take the map; the menu's Delete is the deliberate way.
 */
export function itemKey(e: KeyboardEvent, send: ItemSend, live: boolean): void {
  if (e.key === "Escape") {
    dispatchItemSelection({ type: "clear" });
    return;
  }
  if (e.key === "Delete") {
    if (!live) return;
    const all = selectedItems();
    const targets = all.filter((i) => !i.locked);
    if (all.length > 0 && targets.length === 0) toast.error(LOCKED_NOT_DELETED);
    askDelete(send, targets).catch(toastReject);
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
    e.preventDefault();
    if (live) duplicate(send, selectedItems()).catch(toastReject);
  }
}

function ItemMenu({ send, live }: { send: ItemSend; live: boolean }) {
  const menu = useOverviewEditor((s) => s.menu);
  const item = useOverviewEditor((s) =>
    s.menu ? (s.items.find((i) => i.id === s.menu?.itemId) ?? null) : null,
  );
  const close = () => useOverviewEditor.setState({ menu: null });
  const act =
    (fn: (targets: OverviewItemView[], one: OverviewItemView) => Promise<unknown>) => () => {
      close();
      if (item) fn(menuTargets(item), item).catch(toastReject);
    };
  const own = item && menuTargets(item).length === 1 ? ITEM_KIND_DEFS[item.kind].menu : [];
  return (
    <DropdownMenu
      open={item !== null && live}
      onOpenChange={(o) => {
        if (!o) close();
      }}
      modal={false}
    >
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          className="pointer-events-none fixed size-px"
          style={{ left: menu?.at.x ?? 0, top: menu?.at.y ?? 0 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        data-testid="ovw-item-menu"
        data-record-id={item?.id}
        // Its trigger is only an anchor; Edit text's field must keep the focus it takes.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {item && (
          <>
            <DropdownMenuItem
              data-testid="ovw-item-menu-hide"
              onSelect={act((t, one) => setHidden(send, t, !one.hidden))}
            >
              {item.hidden ? <EyeIcon /> : <EyeOffIcon />} {item.hidden ? "Reveal" : "Hide"}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="ovw-item-menu-lock"
              onSelect={act((t, one) => setLocked(send, t, !one.locked))}
            >
              {item.locked ? <UnlockIcon /> : <LockIcon />} {item.locked ? "Unlock" : "Lock"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid="ovw-item-menu-front"
              onSelect={act((t) => stack(send, t, "front"))}
            >
              <ArrowUpToLineIcon /> To front
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="ovw-item-menu-back"
              onSelect={act((t) => stack(send, t, "back"))}
            >
              <ArrowDownToLineIcon /> To back
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid="ovw-item-menu-duplicate"
              onSelect={act((t) => duplicate(send, t))}
            >
              <CopyIcon /> Duplicate
            </DropdownMenuItem>
            {own.map((entry) =>
              "Sub" in entry ? (
                <entry.Sub key={entry.id} item={item} send={send} />
              ) : (
                <DropdownMenuItem
                  key={entry.id}
                  data-testid={`ovw-item-menu-${entry.id}`}
                  disabled={entry.disabled?.(item)}
                  onSelect={act(async (_, one) => entry.run(one, send))}
                >
                  <entry.icon /> {entry.label}
                </DropdownMenuItem>
              ),
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid="ovw-item-menu-delete"
              variant="destructive"
              onSelect={act((t) => askDelete(send, t))}
            >
              <Trash2Icon /> Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DeleteConfirm({ send }: { send: ItemSend }) {
  const ids = useOverviewEditor((s) => s.confirmDelete);
  const close = () => useOverviewEditor.setState({ confirmDelete: null });
  return (
    <Dialog open={ids !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent role="alertdialog" className="max-w-sm" data-testid="ovw-delete-dialog">
        <DialogTitle>Delete {ids?.length} items?</DialogTitle>
        <DialogDescription>This can't be undone.</DialogDescription>
        <DialogFooter>
          <Button variant="outline" data-testid="ovw-delete-cancel" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            data-testid="ovw-delete-confirm"
            onClick={() => {
              confirmedDelete(send).catch(toastReject);
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImagePicker({ send }: { send: ItemSend }) {
  const picking = useOverviewEditor((s) => s.picking);
  const overviewId = useOverviewEditor((s) => s.overviewId);
  const target = useOverviewEditor((s) =>
    picking?.kind === "image" ? (s.items.find((i) => i.id === picking.itemId) ?? null) : null,
  );
  const assets = useRecords<AssetRecord>("asset");
  if (!picking || !overviewId) return null;
  return (
    <AssetPickerDialog
      open
      onOpenChange={(o) => {
        if (!o) useOverviewEditor.setState({ picking: null });
      }}
      title={
        picking.kind === "place"
          ? "Add an image"
          : picking.kind === "miniature"
            ? "Add a miniature"
            : "Change image"
      }
      context={picking.kind === "miniature" || target?.kind === "miniature" ? "token" : "map"}
      initialSelectedId={target?.assetId ?? null}
      onSelect={(id) => {
        const asset = assets.find((a) => a.id === id);
        if (!asset) return;
        const hidden = useAddHidden.getState().on;
        const sent =
          picking.kind === "place"
            ? placeImageFrom(send, overviewId, asset, hidden)
            : picking.kind === "miniature"
              ? placeMiniatureFrom(send, overviewId, asset.id, picking, hidden)
              : target?.kind === "miniature"
                ? updateMiniature(send, target, { assetId: asset.id })
                : target
                  ? swapImage(send, target, asset)
                  : Promise.resolve();
        sent.catch(toastReject);
      }}
    />
  );
}

export function OverviewEditorHost() {
  const send = useMapIntent();
  const live = useLive();
  useBaseKeyDown((e) => itemKey(e, send, live));
  return (
    <>
      <ItemMenu send={send} live={live} />
      <DeleteConfirm send={send} />
      <ImagePicker send={send} />
      <MiniatureNameDialog send={send} />
    </>
  );
}
