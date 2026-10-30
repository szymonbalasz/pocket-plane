import type { CommandDef } from "../../commands/commands";
import type { Feature } from "../../services";
import {
  createOverview,
  deleteOverview,
  duplicateOverview,
  showOverview,
  updateOverview,
} from "./commands";
import {
  deleteItems,
  duplicateItems,
  moveItems,
  placeImage,
  placeLabel,
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
      updateItems,
      moveItems,
      duplicateItems,
      deleteItems,
    ] as unknown as CommandDef[];
    for (const c of intents) r.command(c, { intent: true });
    for (const t of overviewRecordTypes) r.recordType(t);
  },
};
