// FR-DICE-68 (sprint 7): entry actions, per-line icon Buttons in the game log (both clients).
// APPEND-ONLY registry (AGENTS §9.9): a feature adds one import and one line to `entryActions`;
// nothing else changes here. `GameLog.tsx` draws the available ones at the line end, before the
// category Badge, on hover / keyboard focus of the line (always on touch); Tooltip = `label`.
// Empty registry → lines unchanged. A client registry entry with `feature` shows only while that
// campaign feature is on (`isFeatureOn`, ADR-0058).
import type {
  GameLogEntryView,
  ManualEntry,
  RollCategory,
  RollMode,
} from "@shared/dice-roll-log/schemas";
import type { You } from "@shared/protocol/frames";
import type { RecordStore } from "@shared/protocol/store";
import type { LucideIcon } from "lucide-react";
import { isFeatureOn } from "../campaign-management/use-feature";
import { useAsAttackAction, useAsDamageAction } from "../combat-tracker/use-roll-action";
import { gemRerollAction } from "../gems/reroll-action";

/**
 * An action that rolls dice (a reroll): the roll control's options, so physical-dice mode asks
 * for the dice (FR-DICE-07, "Roll for me" included) and the throw waits for the new entry
 * (FR-DICEX-09). Absent → a plain action.
 */
export interface EntryActionRoll {
  expression: string;
  mode: RollMode;
  category: RollCategory;
  /** The physical form's heading. */
  label: string;
}

export interface EntryActionContext {
  store: RecordStore;
  send(intent: string, payload: unknown): Promise<unknown>;
  /** Physical-dice mode: the dice the roller typed for `roll` (absent = the server rolls). */
  manual?: ManualEntry;
}

export interface EntryAction {
  /** `<prefix>.<name>` (e.g. `gem.reroll`): `dice-log-action` `data-value`. */
  id: string;
  order: number;
  /** Which clients draw it (absent = both). */
  clients?: readonly ("dm" | "player")[];
  /** A campaign feature key (`@shared/campaign-management/features`): hidden while it is off. */
  feature?: string;
  available(store: RecordStore, entry: GameLogEntryView, you: You): boolean;
  Icon: LucideIcon;
  label: string;
  /** Asked once before `run` ("Spend?" ✓ ✗, 4 s; FR-GEM-17). Absent = runs at once. */
  confirm?: string;
  roll?(entry: GameLogEntryView): EntryActionRoll | null;
  run(entry: GameLogEntryView, ctx: EntryActionContext): Promise<unknown>;
}

export const entryActions: readonly EntryAction[] = [
  gemRerollAction, // gem.reroll (gems, FR-GEM-33; feature `gems`)
  useAsAttackAction, // cbt.useAsAttack (combat, FR-DICE-97; DM only)
  useAsDamageAction, // cbt.useAsDamage (combat, FR-DICE-97; DM only)
];

/** FR-DICE-68: the actions a line shows for this viewer, in `order`. */
export function actionsFor(
  list: readonly EntryAction[],
  store: RecordStore,
  entry: GameLogEntryView,
): EntryAction[] {
  const you = store.you;
  if (!you) return [];
  return list
    .filter(
      (a) =>
        (!a.clients || a.clients.includes(you.role)) &&
        (a.feature === undefined || isFeatureOn(store, a.feature)) &&
        a.available(store, entry, you),
    )
    .sort((a, b) => a.order - b.order);
}
