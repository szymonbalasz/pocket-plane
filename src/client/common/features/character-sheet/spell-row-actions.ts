// Spell-row actions registry (OQ-VFX-06 A, spell-fx FR-VFX-06). APPEND-ONLY (AGENTS §9.9): a
// feature adds one import and one line; nothing else changes here. A spell row (view and Main's
// Spells box) renders every available action after its roll buttons, in `order`. Created empty by
// fix/vfx-core; spell-fx's build adds Cast / End, and wires the rows.
import type { SpellRow } from "@shared/character-sheet/sheet";
import type { RecordStore } from "@shared/protocol/store";
import type { ComponentType } from "react";
import { vfxCastAction } from "../spell-fx/CastAction";
import type { SheetClient, SheetCreatureKind } from "./sections";

export interface SpellRowActionProps {
  creatureId: string;
  row: SpellRow;
  client: SheetClient;
}

export interface SpellRowAction {
  /** `<prefix>.<name>`, e.g. `vfx.cast`. */
  id: string;
  /** Ascending after the roll buttons; ties by id. */
  order: number;
  /** Default both. */
  clients?: readonly SheetClient[];
  /** Default `["character"]`. */
  kinds?: readonly SheetCreatureKind[];
  /** False → not rendered for this row. */
  available?(store: RecordStore, creatureId: string, row: SpellRow): boolean;
  component: ComponentType<SpellRowActionProps>;
}

export const spellRowActions: readonly SpellRowAction[] = [
  vfxCastAction, // spell-fx: Cast / End (FR-VFX-06)
];
