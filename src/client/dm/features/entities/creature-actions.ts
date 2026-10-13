// Creatures window actions (FR-ENT-20, OQ-ENT-14). APPEND-ONLY (AGENTS §9.9): a feature adds
// one import and one line to `creatureActions`; nothing else changes here. Entities ships none;
// combat-tracker adds New / Derive / Edit (the creature form) in the Combat phase.
//
// Toolbar actions render in the window's toolbar; row actions render at the end of each row.
// Actions talk to the server through their own REST calls; the list updates from sync.
import type { ComponentType } from "react";
import { combatCreatureActions } from "../combat-tracker/creature-form";
import type { CreatureRow, CreatureTab } from "./list";

export interface CreatureToolbarAction {
  placement: "toolbar";
  /** `<prefix>.<name>`, unique. Order = render order. */
  id: string;
  component: ComponentType<{ tab: CreatureTab }>;
}

export interface CreatureRowAction {
  placement: "row";
  id: string;
  /** Rendered per row; may render nothing (e.g. Edit on a read-only row). */
  component: ComponentType<{ row: CreatureRow }>;
}

export type CreatureAction = CreatureToolbarAction | CreatureRowAction;

export const creatureActions: readonly CreatureAction[] = [
  ...combatCreatureActions, // combat-tracker: creature form New / Derive / Edit (FR-CBT-05)
];

export function actionsOf(actions: readonly CreatureAction[]) {
  const ids = new Set<string>();
  for (const a of actions) {
    if (ids.has(a.id)) throw new Error(`creature action "${a.id}" registered twice`);
    ids.add(a.id);
  }
  return {
    toolbar: actions.filter((a): a is CreatureToolbarAction => a.placement === "toolbar"),
    row: actions.filter((a): a is CreatureRowAction => a.placement === "row"),
  };
}
