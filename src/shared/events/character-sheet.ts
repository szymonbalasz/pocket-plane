// Domain events of character-sheet (CHAR §9, protocol §22). All logged; none undoable.
// Shared definitions (fix/combat-core); character-sheet emits them.
import { Ability } from "@shared/entities/schemas";
import { z } from "zod";
import { RollMode } from "./dice-roll-log";
import { defineEvent } from "./types";

/** `char.adjustHp`: changes = `entity` upsert. Not a combat log entry (#139 P5). */
export const CharacterHpAdjusted = defineEvent({
  type: "CharacterHpAdjusted",
  payload: z
    .object({
      entityId: z.string(),
      delta: z.number().int(),
      hpBefore: z.number().int(),
      hpAfter: z.number().int(),
    })
    .strict(),
  logged: true,
  undoable: false,
});

/** `char.roll`: changes = `game-log-entry` upsert (#67: not undoable). */
export const CharacterRolled = defineEvent({
  type: "CharacterRolled",
  payload: z
    .object({
      characterId: z.string(),
      kind: z.enum(["initiative", "attack", "check", "save"]),
      /** Check / save only (FR-CHAR-21). */
      ability: Ability.optional(),
      mode: RollMode,
      manual: z.boolean(),
      attackName: z.string().optional(),
      damageType: z.string().optional(),
      rollIds: z.array(z.string()).min(1),
      entryId: z.string(),
    })
    .strict(),
  logged: true,
  undoable: false,
});
