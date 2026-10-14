// Edit-mode field model (FR-CHARX-27, -28, -38). Pure: one reducer per field, the client mirror
// of the zod rules, the "Changed by" hint and the lost-intent rule.
import { CharEditSet, CharPutRowIntent } from "@shared/character-sheet/sheet";
import type { SheetEditField, SheetRowList } from "@shared/events/character-sheet";

export interface FieldState {
  /** Local text while editing; null = showing the committed value. */
  draft: string | null;
  /** Committed value when editing started (JSON), to detect a remote change. */
  base: string | null;
  /** FR-CHARX-28: the committed value changed remotely while this field was being edited. */
  changed: boolean;
  /** FR-CHARX-38: the commit was lost to a disconnect; re-commit on the next blur / Enter. */
  unsaved: boolean;
  inFlight: boolean;
  /** Inline validation error (nothing sent). */
  error: string | null;
}

export const idleField: FieldState = {
  draft: null,
  base: null,
  changed: false,
  unsaved: false,
  inFlight: false,
  error: null,
};

export type FieldAction =
  | { type: "focus"; text: string; committed: unknown }
  | { type: "input"; text: string }
  | { type: "remote"; committed: unknown }
  | { type: "invalid"; message: string }
  | { type: "commitStart" }
  | { type: "commitOk" }
  | { type: "commitFail"; lost: boolean }
  | { type: "cancel" };

const json = (v: unknown) => JSON.stringify(v ?? null);

export function fieldReducer(s: FieldState, a: FieldAction): FieldState {
  switch (a.type) {
    case "focus":
      // An unsaved draft survives (FR-CHARX-38); otherwise start from the committed value.
      if (s.draft !== null) return s;
      return { ...idleField, draft: a.text, base: json(a.committed) };
    case "input":
      return { ...s, draft: a.text, error: null };
    case "remote":
      // Only a change that is not this field's own commit (frames carry no actor).
      if (s.draft === null || s.inFlight || s.base === json(a.committed)) return s;
      return { ...s, changed: true, base: json(a.committed) };
    case "invalid":
      return { ...s, error: a.message };
    case "commitStart":
      return { ...s, inFlight: true, error: null };
    case "commitOk":
      return idleField;
    case "commitFail":
      return { ...s, inFlight: false, unsaved: a.lost || s.unsaved };
    case "cancel":
      return s.unsaved ? s : idleField;
  }
}

/** FR-CHARX-28: who changed it. Only the DM and the owner edit a sheet. */
export function changedHint(
  client: "dm" | "player",
  opts: { npc: boolean; ownerName: string | null },
): string {
  if (client === "player") return "Changed by the DM";
  if (opts.npc) return "Changed in another tab";
  return `Changed by ${opts.ownerName ?? "the owner"}`;
}

/** FR-CHARX-38: which intents keep the draft as "Not saved" after a lost connection. */
export type SheetOp = "set" | "putRow" | "create" | "counter" | "other";
export const recommitsAfterLoss = (op: SheetOp) => op === "set";

export const LOST_TOAST = "Connection lost — check the sheet before trying again";

/** Number field text → int, empty → null (cleared), else NaN (caller reports it). */
export function parseIntField(text: string): number | null {
  const t = text.trim().replace(/^−/, "-");
  if (t === "") return null;
  if (!/^[+-]?\d+$/.test(t)) return Number.NaN;
  return Number(t);
}

/** Client mirror of `char.edit` (FR-CHARX-27): the message of the first issue, or null. */
export function setFieldError(key: SheetEditField, value: unknown): string | null {
  const p = CharEditSet.shape[key].safeParse(value);
  return p.success ? null : (p.error.issues[0]?.message ?? "Invalid value");
}

/** Client mirror of `char.putRow` for one row. */
export function rowError(creatureId: string, list: SheetRowList, row: unknown): string | null {
  const p = CharPutRowIntent.safeParse({ creatureId, list, row });
  if (p.success) return null;
  const i = p.error.issues[0];
  // Paths are `["row", field…]`.
  const field = i?.path.slice(1).join(".");
  return i ? (field ? `${field}: ${i.message}` : i.message) : "Invalid row";
}
