// Add to party (FR-CMP-40–42, CMP §7), pure: which entries show it (items only; the DM client
// alone mounts it), the `party.addItem` payload (name clipped as Add to sheet, notes empty, qty
// mirrored with party-board's rules), the unshared-homebrew hint and the Popover state after a
// send (FR-CMP-57: "Added: ‹name› ×‹qty›" for 1.5 s on ack). The server decides everything else
// (merge, caps, log row, `loot-received`).
import { clip } from "@shared/compendium/homebrew";
import { type CompendiumEntry, isReadOnlyEntry } from "@shared/compendium/schemas";
import { type AddItemIntent, ITEM_NAME_MAX } from "@shared/party-board/schemas";
import { addPayload } from "@ui/features/party-board/inventory-logic";
import type { intentFailure, Parsed } from "@ui/features/party-board/logic";

type EntryLike = Pick<CompendiumEntry, "kind" | "name" | "source" | "shared">;

/** FR-CMP-40 / -42: item entries only (imported and homebrew). */
export const hasAddToParty = (e: Pick<CompendiumEntry, "kind">) => e.kind === "item";

/** The party row's name: the entry name clipped to 60 with Add to sheet's `clip` (FR-CMP-28). */
export const partyItemName = (name: string) => clip(name, ITEM_NAME_MAX);

/** FR-CMP-40: `party.addItem {name, qty, notes: ""}`, or why the qty can't be sent. */
export const addToPartyPayload = (name: string, qty: string): Parsed<AddItemIntent> =>
  addPayload({ name: partyItemName(name), qty, notes: "" });

/** FR-CMP-41: the party inventory is public, so an unshared homebrew item's name gets out. */
export function addToPartyHint(e: EntryLike): string | null {
  if (isReadOnlyEntry(e) || e.shared) return null;
  return `Players will see ${partyItemName(e.name)} in the party inventory`;
}

export interface AddToPartyState {
  open: boolean;
  qty: string;
  error: string | null;
  /** FR-CMP-57: the confirmation shown after an ack, until the Popover closes. */
  done?: string;
}
export const CLOSED: AddToPartyState = { open: false, qty: "1", error: null };

/** FR-CMP-57: how long the confirmation shows before the Popover closes. */
export const DONE_MS = 1500;

/** FR-CMP-57: "Added: Potion of healing ×2" (the party row's name after a merge). */
export const addedText = (name: string, qty: number) => `Added: ${name} ×${qty}`;

export type SendOutcome =
  | { kind: "ack"; name: string; qty: number }
  | ReturnType<typeof intentFailure>;

/**
 * FR-CMP-41 / -57: ack → the confirmation (qty back to 1; `DONE_MS` later the Popover closes);
 * reject → inline, qty kept; lost → toast, qty kept.
 */
export function settle(s: AddToPartyState, o: SendOutcome): AddToPartyState {
  if (o.kind === "ack") return { ...CLOSED, open: true, done: addedText(o.name, o.qty) };
  return { ...s, error: o.kind === "inline" ? o.message : null };
}
