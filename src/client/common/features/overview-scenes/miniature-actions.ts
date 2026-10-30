// What the miniature tools send (FR-OVW-31, -32, -34): `ovw.addParty`, `ovw.placeMiniature`. Both land
// in the view's centre at 64 px on the placer's screen, and the rail is back on Select with the new
// ones selected, as an image (#404). The server decides; a rejection is the caller's to toast.
// DOM-free for `bun test`.
import {
  type AddPartyResult,
  MINIATURE_SCREEN_PX,
  MINIATURE_SIDE,
  OVW_INTENTS,
  type PlaceItemResult,
  POSITION_MAX,
} from "@shared/overview-scenes/schemas";
import { toast } from "sonner";
import type { OverviewView } from "./item-edit";
import type { OverviewItemView } from "./item-layout";
import type { ItemSend } from "./items/item-kind";
import { SELECT_TOOL_ID, useOverviewTool } from "./overview-canvas-context";
import { dispatchItemSelection, useOverviewEditor } from "./overview-editor";

export const EVERYONE_HERE = "Everyone is already here";

const round2 = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const inBounds = (v: number) => clamp(round2(v), -POSITION_MAX, POSITION_MAX);

/** FR-OVW-34: 64 px on the placer's screen, inside the side's bounds. */
export const miniatureSizeAt = (scale: number): number =>
  clamp(round2(MINIATURE_SCREEN_PX / scale), MINIATURE_SIDE.min, MINIATURE_SIDE.max);

/** The middle of what the placer sees, in units. */
export const viewCentre = (view: OverviewView): { x: number; y: number } => ({
  x: inBounds((view.w / 2 - view.x) / view.scale),
  y: inBounds((view.h / 2 - view.y) / view.scale),
});

function landed(itemIds: readonly string[]) {
  dispatchItemSelection({ type: "set", ids: [...itemIds] });
  useOverviewTool.getState().setTool(SELECT_TOOL_ID);
}

/** FR-OVW-31: who's missing, in a row; nobody missing → the toast, and the tool stays on. */
export async function addPartyHere(
  send: ItemSend,
  overviewId: string,
  hidden: boolean,
): Promise<void> {
  const { view } = useOverviewEditor.getState();
  const r = (await send(OVW_INTENTS.addParty, {
    overviewId,
    ...viewCentre(view),
    size: miniatureSizeAt(view.scale),
    ...(hidden ? { hidden } : {}),
  })) as AddPartyResult;
  if (r.itemIds.length === 0) {
    toast.info(EVERYONE_HERE);
    return;
  }
  landed(r.itemIds);
}

/** FR-OVW-32: the picker's choice, with the panel's name and owner. */
export async function placeMiniatureFrom(
  send: ItemSend,
  overviewId: string,
  assetId: string,
  fields: { text: string; ownerPlayerId: string | null },
  hidden: boolean,
): Promise<void> {
  const { view } = useOverviewEditor.getState();
  const size = miniatureSizeAt(view.scale);
  const c = viewCentre(view);
  const text = fields.text.trim();
  const r = (await send(OVW_INTENTS.placeMiniature, {
    overviewId,
    assetId,
    x: inBounds(c.x - size / 2),
    y: inBounds(c.y - size / 2),
    size,
    ...(text ? { text } : {}),
    ...(fields.ownerPlayerId ? { ownerPlayerId: fields.ownerPlayerId } : {}),
    ...(hidden ? { hidden } : {}),
  })) as PlaceItemResult;
  landed([r.itemId]);
}

/** One field of one miniature. A linked one refuses its name, image and owner (FR-OVW-33). */
export const updateMiniature = (send: ItemSend, item: OverviewItemView, patch: object) =>
  send(OVW_INTENTS.updateItems, {
    overviewId: item.overviewId,
    items: [{ itemId: item.id, ...patch }],
  });
