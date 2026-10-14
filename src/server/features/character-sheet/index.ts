// character-sheet (CHAR + CHARX): intents `char.roll`, `char.adjustHp`, the CHARX lifecycle, edit,
// row and counter intents; record type `creature-sheet` (FR-CHARX-36); internal API
// `characters.adjustHp` (FR-CHAR-13) for combat-tracker. Rules numbers stay in `entity`.
import type { Feature } from "../../services";
import { definitionHooksOf } from "../entities/definition-hooks";
import { charAdjustHp, charRoll } from "./commands";
import {
  charDeleteRowCommand,
  charEditCommand,
  charMoveRowCommand,
  charPutRowCommand,
} from "./edit";
import { adjustHp } from "./hp";
import { charApprove, charCreate, charSetLock } from "./lifecycle";
import { creatureSheetRecordType } from "./records";
import { charUseResource } from "./resources";

export type { AdjustHpResult } from "./hp";

/** `characters.adjustHp(env, characterId, delta) → {hpBefore, hpAfter, change}`; no event. */
export const characters = { adjustHp } as const;

export const characterSheet: Feature = {
  name: "character-sheet",
  register(r) {
    r.command(charRoll, { intent: true });
    r.command(charAdjustHp, { intent: true });
    // CHARX (§9): WS intents for both roles; stat-block writes run entities' hooks.
    const hooks = definitionHooksOf(r.services);
    r.command(charCreate, { intent: true });
    r.command(charApprove, { intent: true });
    r.command(charSetLock, { intent: true });
    r.command(charEditCommand(hooks), { intent: true });
    r.command(charPutRowCommand(hooks), { intent: true });
    r.command(charDeleteRowCommand(hooks), { intent: true });
    r.command(charMoveRowCommand(hooks), { intent: true });
    r.command(charUseResource, { intent: true });
    r.recordType(creatureSheetRecordType(r.services.log));
  },
};
