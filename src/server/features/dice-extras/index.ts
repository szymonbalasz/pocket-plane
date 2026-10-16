// dice-extras (DICEX): record type `dice-look` and `dicex.setLook` (D2). Tray, throws and 3D
// dice are client-only (D1, D3): no server code.
import type { Feature } from "../../services";
import { setLook, setLookFor } from "./commands";
import { diceLookType } from "./records";

export const diceExtras: Feature = {
  name: "dice-extras",
  register(r) {
    r.command(setLook, { intent: true });
    // Internal: fixture loader only. No route, no WS intent.
    r.command(setLookFor);
    r.recordType(diceLookType);
  },
};
