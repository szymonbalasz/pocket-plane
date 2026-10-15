// Settings: scn.setDiagonalRule (DM, FR-SCN-29).
import type { Registrar } from "../../services";
import { setDiagonalRule } from "./settings";

export function registerSettings(r: Registrar): void {
  r.command(setDiagonalRule, { intent: true });
}
