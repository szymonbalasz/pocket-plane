// fog-of-war (FOG): record type `fog` and the DM-only intents `fog.edit` / `fog.setAll` /
// `fog.undo` (FOG §9). Its lines in scenes-map's `visibility-hooks.ts` / `scene-hooks.ts` live in
// `hooks.ts` (derive, hides, dragToDm; created, duplicated, deleting).
import type { Feature } from "../../services";
import { fogCommands } from "./commands";
import { fogRecordType } from "./records";

export const fogOfWar: Feature = {
  name: "fog-of-war",
  register(r) {
    r.recordType(fogRecordType);
    const c = fogCommands(r.services.log);
    r.command(c.edit, { intent: true });
    r.command(c.setAll, { intent: true });
    r.command(c.undo, { intent: true });
  },
};
