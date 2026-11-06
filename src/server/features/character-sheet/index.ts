// character-sheet (CHAR + CHARX): intents `char.roll`, `char.adjustHp`, the CHARX lifecycle, edit,
// row, counter and rest intents; record type `creature-sheet` (FR-CHARX-36); internal API
// `characters.adjustHp` (FR-CHAR-13) and `characters.sheetAttack` (FR-CHARX-24) for combat-tracker.
// Rules numbers stay in `entity`.
import type { CommandDef } from "../../commands/commands";
import type { Feature } from "../../services";
import { definitionHooksOf } from "../entities/definition-hooks";
import { sheetAttack } from "./attack";
import { charAdjustHp, charRoll } from "./commands";
import {
  charDeleteRowCommand,
  charEditCommand,
  charMoveRowCommand,
  charPutRowCommand,
} from "./edit";
import { linkSpendByName } from "./fixture-commands";
import { adjustHp } from "./hp";
import { charApprove, charCreate, charSetLock } from "./lifecycle";
import { creatureSheetRecordType } from "./records";
import { charUseResource } from "./resources";
import { charRest } from "./rest";
import { charConvertSlot, charCreateSlot, charUndoResourceUse, charUseFeature } from "./sorcery";

export type { AdjustHpResult } from "./hp";

/**
 * `characters.adjustHp(env, characterId, delta) → {hpBefore, hpAfter, change}`; no event.
 * `characters.sheetAttack(env, creatureId, ref) → {name, toHit, damage, damageType}` (OQ-CHARX-12).
 */
export const characters = { adjustHp, sheetAttack } as const;

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
    r.command(charRest, { intent: true });
    r.command(charConvertSlot, { intent: true });
    r.command(charCreateSlot, { intent: true });
    r.command(charUseFeature, { intent: true });
    r.command(charUndoResourceUse, { intent: true });
    // Fixtures only (not an intent): a spend link by row names (class-resources §13).
    r.command(linkSpendByName(hooks) as unknown as CommandDef);
    r.recordType(creatureSheetRecordType(r.services.log));
  },
};
