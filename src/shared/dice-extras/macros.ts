// Roll macros (DICEX sprint 8, FR-DICEX-64–67): record `roll-macro`, intents and caps. A macro is a
// saved `dice.roll` (name, notation, category, roll-as creature): rolling one sends `dice.roll`
// unchanged (FR-DICEX-68), so nothing here touches the roll path.
import { z } from "zod";
import { EXPRESSION_MAX_CHARS, parseExpression, toNotation } from "../dice-roll-log/grammar";
import { RollCategory } from "../events/dice-roll-log";

export const ROLL_MACRO_TYPE = "roll-macro";

/** FR-DICEX-64: name length. */
export const MACRO_NAME_MAX = 40;
/** FR-DICEX-64: macros per list (`playerId`, `creatureId`). */
export const MACROS_PER_LIST = 24;
/** FR-DICEX-64 (review A #1): macros per campaign. */
export const MACROS_PER_CAMPAIGN = 200;

export const DICEX_MACRO_INTENTS = {
  saveMacro: "dicex.saveMacro",
  deleteMacro: "dicex.deleteMacro",
  moveMacro: "dicex.moveMacro",
} as const;

const Id = z.string().min(1).max(64);

// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control chars is the rule.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** FR-DICEX-64: trimmed, 1–40 chars, no control characters. */
export const MacroName = z
  .string()
  .max(4 * MACRO_NAME_MAX)
  .transform((s) => s.trim())
  .refine((s) => !CONTROL.test(s), "Name: no control characters")
  .refine((s) => s.length >= 1, "Name is required")
  .refine((s) => [...s].length <= MACRO_NAME_MAX, `Name: at most ${MACRO_NAME_MAX} characters`);

/** FR-DICEX-64: FR-DICE-01 notation, stored canonical ("1D20 + 5" → "1d20+5"). */
export const MacroExpression = z
  .string()
  .max(4 * EXPRESSION_MAX_CHARS)
  .transform((s, ctx) => {
    const r = parseExpression(s);
    if (!r.ok) {
      ctx.addIssue({ code: "custom", message: r.message });
      return z.NEVER;
    }
    return toNotation(r.value);
  });

/**
 * Wire record (FR-DICEX-64, -67). `playerId` = who uses it (null = the DM only); `creatureId` =
 * roll as (null = "Me" / "DM"; no FK, a gone creature's macros show under "General");
 * `createdBy` = the player who made it, null = the DM (the DM's rows are read-only for players,
 * review A #14). `order` 0-based within its list. `updatedAt` stays server-only.
 */
export const RollMacroRecord = z.strictObject({
  id: Id,
  campaignId: Id,
  playerId: Id.nullable(),
  creatureId: Id.nullable(),
  name: z.string().min(1).max(MACRO_NAME_MAX),
  expression: z.string().min(1).max(EXPRESSION_MAX_CHARS),
  category: RollCategory,
  order: z.int().min(0),
  createdBy: Id.nullable(),
});
export type RollMacroRecord = z.infer<typeof RollMacroRecord>;

/** `dicex.saveMacro` (FR-DICEX-66): no `id` = new; `dmOnly` (DM on a PC) → `playerId` null. */
export const SaveMacroInput = z.strictObject({
  id: Id.optional(),
  name: MacroName,
  expression: MacroExpression,
  category: RollCategory,
  creatureId: Id.nullable(),
  dmOnly: z.boolean().optional(),
});
export type SaveMacroInput = z.infer<typeof SaveMacroInput>;

export const DeleteMacroInput = z.strictObject({ id: Id });
export type DeleteMacroInput = z.infer<typeof DeleteMacroInput>;

export const MoveMacroInput = z.strictObject({
  id: Id,
  index: z
    .int()
    .min(0)
    .max(MACROS_PER_LIST - 1),
});
export type MoveMacroInput = z.infer<typeof MoveMacroInput>;

export const MacroResult = z.strictObject({ macroId: Id });
export type MacroResult = z.infer<typeof MacroResult>;

/** FR-DICEX-67: the DM gets every row; a player the rows they use (`playerId` = them). */
export const macroVisibleTo = (r: Pick<RollMacroRecord, "playerId">, playerId: string): boolean =>
  r.playerId === playerId;
