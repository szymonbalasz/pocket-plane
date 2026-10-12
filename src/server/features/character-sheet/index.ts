// character-sheet (CHAR): intents `char.roll`, `char.adjustHp`; internal API
// `characters.adjustHp` (FR-CHAR-13) for combat-tracker. No record type: sheet data is `entity`.
import type { Feature } from "../../services";
import { charAdjustHp, charRoll } from "./commands";
import { adjustHp } from "./hp";

export type { AdjustHpResult } from "./hp";

/** `characters.adjustHp(env, characterId, delta) → {hpBefore, hpAfter, change}`; no event. */
export const characters = { adjustHp } as const;

export const characterSheet: Feature = {
  name: "character-sheet",
  register(r) {
    r.command(charRoll, { intent: true });
    r.command(charAdjustHp, { intent: true });
  },
};
