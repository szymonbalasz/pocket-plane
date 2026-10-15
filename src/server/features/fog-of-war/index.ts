// fog-of-war (FOG): record type `fog`. fix/fog-core registers the record type only; commands
// (`fog.*`), the undo stack and the registry lines in scenes-map's `visibility-hooks.ts` /
// `scene-hooks.ts` come with build/fog-server and build/fog-visibility (FOG §14).
import type { Feature } from "../../services";
import { fogRecordType } from "./records";

export const fogOfWar: Feature = {
  name: "fog-of-war",
  register(r) {
    r.recordType(fogRecordType);
  },
};
