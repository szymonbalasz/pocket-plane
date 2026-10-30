import { ItemDragData, OVW_SIGNALS } from "@shared/overview-scenes/schemas";
import type { CommandDef } from "../../commands/commands";
import type { Feature } from "../../services";
import { defineSignal } from "../../ws/signals";
import {
  createOverview,
  deleteOverview,
  duplicateOverview,
  showOverview,
  updateOverview,
} from "./commands";
import { itemDragAudience } from "./drag";
import {
  addParty,
  deleteItems,
  duplicateItems,
  moveItems,
  placeImage,
  placeLabel,
  placeMiniature,
  updateItems,
} from "./items";
import { overviewRecordTypes } from "./records";

export const overviewScenes: Feature = {
  name: "overview-scenes",
  register(r) {
    const intents: CommandDef[] = [
      createOverview,
      updateOverview,
      duplicateOverview,
      deleteOverview,
      showOverview,
      placeImage,
      placeLabel,
      placeMiniature,
      addParty,
      updateItems,
      moveItems,
      duplicateItems,
      deleteItems,
    ] as unknown as CommandDef[];
    for (const c of intents) r.command(c, { intent: true });
    for (const t of overviewRecordTypes) r.recordType(t);
    // FR-OVW-37: routed per frame by its audience hook (FR-SYNC-28, ADR-0033).
    r.signal(
      defineSignal({
        name: OVW_SIGNALS.drag,
        schema: ItemDragData,
        roles: ["dm", "player"],
        audience: itemDragAudience,
      }),
    );
  },
};
