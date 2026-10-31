// Structure: scn.addWalls / addDoor / setDoor / removeSegments / flipWalls (DM). The wall move guard is a line
// in scenes-map's `move-guards.ts` (`guard.ts`).
import type { Registrar } from "../../services";
import { addDoor, addWalls, flipWalls, removeSegments, setDoor } from "./structure";

export function registerStructure(r: Registrar): void {
  r.command(addWalls, { intent: true });
  r.command(addDoor, { intent: true });
  r.command(setDoor, { intent: true });
  r.command(removeSegments, { intent: true });
  r.command(flipWalls, { intent: true });
}
