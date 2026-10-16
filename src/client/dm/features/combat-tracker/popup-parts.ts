// Popup parts (FR-MOD-39, -40, ADR-0043, protocol §26). APPEND-ONLY (AGENTS §9.9): a feature adds
// one import and one line to `popupParts`; nothing else changes here.
//
// The DM's attack popup renders every line's `Chips` under every target row (registry order) and
// merges each line's `toInput` into that row's entry of the `cbt.applyCard` intent. A line keeps
// one value per popup (`value` / `onChange`; client memory, lost on close), so a chip can move
// between rows. Lines read the card (settle facts ride on it, FR-MOD-37) and may read records
// with the store hooks (`useRecords`); they never send intents themselves. `previewExtra` adds a
// row's extra raw damage to its HP preview.
import type {
  ApplyTargetInput,
  CombatantView,
  DamageCardPayload,
  DamageMultiplier,
} from "@shared/combat-tracker/schemas";
import type { ComponentType } from "react";
import { modDefensePart } from "../effect-modifiers/popup-facts";
import type { HpTemp } from "./targets";

/** One target row as the popup shows it (list order). */
export interface PopupRowView {
  targetId: string;
  combatant: CombatantView;
  hit: boolean;
  multiplier: DamageMultiplier;
  /** Stored AC (null = unknown). */
  ac: number | null;
  hp: HpTemp | null;
}

export interface PopupPartProps<V = unknown> {
  card: DamageCardPayload;
  cardId: string;
  row: PopupRowView;
  rows: readonly PopupRowView[];
  /** undefined until the line first calls `onChange` (its defaults). */
  value: V | undefined;
  onChange(value: V): void;
  disabled: boolean;
}

export interface PopupPart<V = unknown> {
  /** `<feature>.<what>`, unique. */
  id: string;
  Chips: ComponentType<PopupPartProps<V>>;
  /** This row's share of the apply intent (e.g. `{triggers}`); `{}` = nothing. */
  toInput(
    value: V | undefined,
    row: PopupRowView,
    rows: readonly PopupRowView[],
    card: DamageCardPayload,
  ): Partial<ApplyTargetInput>;
  /** Extra raw damage this line lands on the row (preview only; the server decides). */
  previewExtra?(
    value: V | undefined,
    row: PopupRowView,
    rows: readonly PopupRowView[],
    card: DamageCardPayload,
  ): number;
}

/** Type-erased registration (a line's value type stays its own; the registry holds unknown). */
export const definePopupPart = <V>(part: PopupPart<V>): PopupPart => part as unknown as PopupPart;

/** The registry. Append your feature's line (`definePopupPart`); order = render order. */
export const popupParts: readonly PopupPart[] = [
  modDefensePart, // effect-modifiers: defense hint "Half (Rage)" (FR-MOD-25)
];

type Values = Readonly<Record<string, unknown>>;

/**
 * Every line's `toInput` for one row, merged in registry order: arrays concatenated (e.g. two
 * lines' `triggers`), other keys last-wins. The popup spreads it over the row's base entry.
 */
export function partInputs(
  lines: readonly PopupPart[],
  values: Values,
  row: PopupRowView,
  rows: readonly PopupRowView[],
  card: DamageCardPayload,
): Partial<ApplyTargetInput> {
  const out: Record<string, unknown> = {};
  for (const l of lines) {
    for (const [k, v] of Object.entries(l.toInput(values[l.id], row, rows, card))) {
      const prev = out[k];
      out[k] = Array.isArray(prev) && Array.isArray(v) ? [...prev, ...v] : v;
    }
  }
  return out as Partial<ApplyTargetInput>;
}

/** Σ every line's `previewExtra` for one row (0 without lines). */
export const partPreviewExtra = (
  lines: readonly PopupPart[],
  values: Values,
  row: PopupRowView,
  rows: readonly PopupRowView[],
  card: DamageCardPayload,
): number => lines.reduce((s, l) => s + (l.previewExtra?.(values[l.id], row, rows, card) ?? 0), 0);
