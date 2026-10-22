// dice-extras (DICEX): record type `dice-look` and `dicex.setLook` (D2). Tray, throws and 3D
// dice are client-only (D1, D3): no server code. *(Sprint 8)* record types `roll-macro` and
// `roll-request` (TT0); macro commands (TT1); roll requests (TT2).
import type { Feature } from "../../services";
import { setLook, setLookFor } from "./commands";
import { deleteMacro, moveMacro, saveMacro } from "./macros";
import { diceLookType, rollMacroType, rollRequestType } from "./records";
import { answerRequest, closeRequest, declineRequest, request, rollForMissing } from "./requests";

export const diceExtras: Feature = {
  name: "dice-extras",
  register(r) {
    r.command(setLook, { intent: true });
    // Internal: fixture loader only. No route, no WS intent.
    r.command(setLookFor);
    r.recordType(diceLookType);
    r.recordType(rollMacroType);
    r.recordType(rollRequestType);
    r.command(saveMacro, { intent: true });
    r.command(deleteMacro, { intent: true });
    r.command(moveMacro, { intent: true });
    r.command(request, { intent: true });
    r.command(answerRequest, { intent: true });
    r.command(declineRequest, { intent: true });
    r.command(closeRequest, { intent: true });
    r.command(rollForMissing, { intent: true });
  },
};
