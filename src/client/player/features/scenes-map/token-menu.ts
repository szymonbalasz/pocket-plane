// Player token menu registry (FR-NOTES-29, shaped like the DM's FR-MAP-29 one). APPEND-ONLY
// (AGENTS §9.9): a feature adds one import and its line; nothing else changes here. Right-click
// (long-press on touch) on a token the player sees; no available entry → no menu.
import type { RecordStore } from "@shared/protocol/store";
import type { PlayerTokenRecord } from "@shared/scenes-map/schemas";
import type { ComponentType } from "react";
import { notesTokenMenu } from "../linked-notes/token-menu-entries";
import { formsTokenMenu } from "../token-forms/token-menu-entries";

export interface PlayerTokenMenuItemProps {
  token: PlayerTokenRecord;
  /** Opens this entry's `Dialog` for the token (the menu closes first). */
  openDialog(): void;
}

export interface PlayerTokenMenuDialogProps {
  token: PlayerTokenRecord;
  close(): void;
}

export interface PlayerTokenMenuEntry {
  /** `<feature>.<what>`, unique. */
  id: string;
  /** Ascending, top to bottom. */
  order: number;
  /** Hidden when false. `store` (FR-FORM-15): the client's records, when the caller has them. */
  available?(t: PlayerTokenRecord, store?: RecordStore): boolean;
  /** Renders one or more `DropdownMenu*` items. */
  Item: ComponentType<PlayerTokenMenuItemProps>;
  Dialog?: ComponentType<PlayerTokenMenuDialogProps>;
}

/** The player's token menu. Append your feature's entries. */
export const playerTokenMenuEntries: readonly PlayerTokenMenuEntry[] = [
  ...notesTokenMenu, // linked-notes: Open note / Create note (FR-NOTES-29)
  ...formsTokenMenu, // token-forms: Form ▸ on the player's own character (FR-FORM-15)
];

export function playerMenuFor(
  t: PlayerTokenRecord,
  entries: readonly PlayerTokenMenuEntry[] = playerTokenMenuEntries,
  store?: RecordStore,
): PlayerTokenMenuEntry[] {
  return [...entries]
    .sort((a, b) => a.order - b.order)
    .filter((e) => e.available?.(t, store) ?? true);
}
