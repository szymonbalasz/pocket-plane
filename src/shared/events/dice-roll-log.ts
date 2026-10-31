// Domain events of dice-roll-log (DICE §9, protocol §22). All logged; none undoable.
// Shared definitions (fix/combat-core); dice-roll-log emits them.
import { z } from "zod";
import { defineEvent } from "./types";

/** The 9 roll categories (FR-DICE-11); one public-log setting each (FR-DICE-12). */
export const ROLL_CATEGORIES = [
  "attack",
  "damage",
  "saving-throw",
  "ability-check",
  "skill-check",
  "contested",
  "initiative",
  "healing",
  "other",
] as const;
export const RollCategory = z.enum(ROLL_CATEGORIES);
export type RollCategory = z.infer<typeof RollCategory>;

/** FR-DICE-04. */
export const ROLL_MODES = ["normal", "advantage", "disadvantage"] as const;
export const RollMode = z.enum(ROLL_MODES);
export type RollMode = z.infer<typeof RollMode>;

/** `dice.roll`: changes = the `game-log-entry` upsert (players iff public). */
export const DiceRolled = defineEvent({
  type: "DiceRolled",
  payload: z.object({ entryId: z.string(), rollIds: z.array(z.string()).min(1) }).strict(),
  logged: true,
  undoable: false,
});

/**
 * `dice.setEntryHidden` (FR-DICE-99): changes = the `game-log-entry` upsert of each line of the
 * rerolled chain that moved (players: delete on hide, upsert on reveal).
 */
export const LogEntryHiddenSet = defineEvent({
  type: "LogEntryHiddenSet",
  payload: z.object({ entryIds: z.array(z.string()).min(1), hidden: z.boolean() }).strict(),
  logged: true,
  undoable: false,
});

/** `dice.setCategoryPublic`: changes = `game-log-settings` upsert (DM only). */
export const PublicLogCategorySet = defineEvent({
  type: "PublicLogCategorySet",
  payload: z.object({ category: RollCategory, public: z.boolean() }).strict(),
  logged: true,
  undoable: false,
});
