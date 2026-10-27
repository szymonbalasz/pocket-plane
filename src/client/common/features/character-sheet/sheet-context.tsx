// Per-sheet context: the creature shown, its sheet row, who views it and whether edit mode is on.
// Components below the sheet read it instead of threading props.
import {
  CHARX_INTENTS,
  type CreatureSheetRecord,
  type SheetData,
} from "@shared/character-sheet/sheet";
import type { DefinitionRecord, StatBlock } from "@shared/entities/schemas";
import type { SheetEditField } from "@shared/events/character-sheet";
import { createContext, useContext } from "react";
import { toast } from "sonner";
import { useSync } from "../../sync/store";
import type { DiceTextContext } from "../dice-extras/DiceText";
import { LOST_TOAST } from "./edit-model";
import { intentErrorText } from "./routing";

export interface SheetCtx {
  creature: DefinitionRecord;
  stats: StatBlock;
  /** The row, or defaults (FR-CHARX-02). */
  sheet: SheetData;
  row: CreatureSheetRecord | undefined;
  client: "dm" | "player";
  /** Monster definition (NPC sheet, FR-CHARX-31). */
  npc: boolean;
  /** Imported definition: read-only. */
  readOnly: boolean;
  canEdit: boolean;
  editing: boolean;
  /** Counters + HP (FR-CHARX-17). */
  canCount: boolean;
  ownerName: string | null;
}

export const SheetContext = createContext<SheetCtx | null>(null);

/**
 * K13 (DM #363): where a repeated sheet part renders. `main` = the wide Main's Attacks / Spells /
 * Limited uses boxes, the same rows and controls as Actions / Features; their test IDs carry
 * `data-scope="main"` so a selector stays unambiguous. Elsewhere none (no attribute).
 */
export const SheetScope = createContext<"main" | undefined>(undefined);
export const useSheetScope = () => useContext(SheetScope);

/** K13: the sheet body is wide (≥ 560 px, FR-CHARX-112's switch), measured by the sheet view. */
export const SheetWide = createContext(false);

export function useSheet(): SheetCtx {
  const c = useContext(SheetContext);
  if (!c) throw new Error("useSheet outside a sheet");
  return c;
}

/**
 * FR-DICEX-30: notation in sheet text stages as this creature (when the viewer may roll as it),
 * labelled with the row's name; category stays the tray default `other` (FR-DICEX-29, -31).
 */
export const notationContext = (
  ctx: Pick<SheetCtx, "creature">,
  label: string,
): DiceTextContext => ({
  label,
  creature: { entityId: ctx.creature.id },
});

/** FR-CHARX-38: a failed intent as a Toast; a lost one asks to check the sheet first. */
export function toastIntentError(err: unknown): void {
  const text = intentErrorText(err);
  toast.error(text.startsWith("Connection lost") ? LOST_TOAST : text);
}

/** Sends CHARX intents (rejections reach the caller). */
export function useSheetIntents() {
  const connection = useSync((s) => s.connection);
  const send = (name: string, payload: unknown) => connection.sendIntent(name, payload);
  return {
    send,
    /** `char.edit` of one or more keys; the caller handles failure (field drafts). */
    edit: (creatureId: string, set: Partial<Record<SheetEditField, unknown>>) =>
      send(CHARX_INTENTS.edit, { creatureId, set }),
  };
}
