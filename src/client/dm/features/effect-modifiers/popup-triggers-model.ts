// Trigger-part chips in the DM's attack popup (FR-MOD-39, -40; MOD §7 "Popup"), pure. Each offered
// part of the card is one chip, shown under its target row: tick, value edit, its own multiplier,
// target Select (the Hit rows), hints "Check: …" / "No target passes" / a conflict's "… already
// used this turn" with a Force tick. Untouched chips follow `settleTriggers`' defaults live (a Hit
// toggle moves them); a chip the DM touched keeps the DM's state. Apply sends the ticked chips of
// each Hit row (`targets[].triggers`); the server settles (FR-MOD-38).
import { MULTIPLIER_FACTOR } from "@shared/combat-tracker/rules";
import type {
  ApplyTargetTrigger,
  CardTriggerPart,
  DamageCardPayload,
  DamageMultiplier,
} from "@shared/combat-tracker/schemas";
import { offerText } from "@shared/effect-modifiers/combat-parts";
import { type SettleRow, type SettleStore, settleTriggers } from "@shared/effect-modifiers/settle";
import type { PopupRowView } from "../combat-tracker/popup-parts";

/** The DM's state of one chip. `used` = the conflict message of the last apply. */
export interface ChipState {
  on: boolean;
  targetId: string | null;
  value?: number;
  multiplier?: DamageMultiplier;
  force?: boolean;
  used?: string;
}

/** A chip as the popup draws and sends it (defaults resolved). */
export interface ChipView {
  part: CardTriggerPart;
  /** "+ 6 radiant Divine Fury". */
  text: string;
  on: boolean;
  /** The Hit row it lands on; null = none (unticked). */
  targetId: string | null;
  /** The row it's drawn under: its target, else the first Hit row, else the first row. */
  shownOn: string | null;
  value: number;
  multiplier: DamageMultiplier;
  force: boolean;
  hint: { kind: "ask" | "none" | "used"; text: string } | null;
  /** Damage it adds to its row (0 unless ticked on a Hit row). */
  lands: number;
}

/** The line's popup value: the DM's touched chips + every chip resolved (read by `toInput`). */
export interface ChipsValue {
  touched: Readonly<Record<string, ChipState>>;
  chips: readonly ChipView[];
}

export interface ChipFacts {
  store: SettleStore;
  /** FR-MOD-25: a defense's multiplier preset for a typed part on a row (null = none). */
  defenseOf(row: PopupRowView, type: string): DamageMultiplier | null;
}

const settleRow = (r: PopupRowView): SettleRow => ({
  targetId: r.targetId,
  characterId: r.combatant.kind === "pc" ? (r.combatant.entityId ?? null) : null,
  hit: r.hit,
  hp: r.hp ? { current: r.hp.cur, max: r.hp.max } : null,
});

/** A part's multiplier unless the DM set one: untyped (the attack's type) → the row's; typed → its defense. */
function defaultMultiplier(
  part: CardTriggerPart,
  row: PopupRowView | undefined,
  card: DamageCardPayload,
  facts: ChipFacts,
): DamageMultiplier {
  if (!row) return "normal";
  if (part.type === null || part.type === card.damageType) return row.multiplier;
  return facts.defenseOf(row, part.type) ?? "normal";
}

/** Every offered part's chip, card order. */
export function chipViews(
  card: DamageCardPayload,
  rows: readonly PopupRowView[],
  touched: Readonly<Record<string, ChipState>>,
  facts: ChipFacts,
): ChipView[] {
  const settled = settleTriggers(card, rows.map(settleRow), facts.store);
  const hits = rows.filter((r) => r.hit);
  return (card.damage?.triggers ?? []).map((part, i) => {
    const d = settled[i];
    const t = touched[part.triggerId];
    // A touched chip keeps its target while that row is a Hit row; else it has none.
    const targetId = t
      ? hits.some((r) => r.targetId === t.targetId)
        ? t.targetId
        : null
      : (d?.targetId ?? null);
    const on = (t ? t.on : (d?.ticked ?? false)) && targetId !== null;
    const row = rows.find((r) => r.targetId === targetId);
    const multiplier = t?.multiplier ?? defaultMultiplier(part, row, card, facts);
    const value = t?.value ?? part.value;
    const hint: ChipView["hint"] = t?.used
      ? { kind: "used", text: t.used }
      : d?.hint === "ask" && d.ask
        ? { kind: "ask", text: `Check: ${d.ask}` }
        : targetId === null && hits.length > 0
          ? { kind: "none", text: "No target passes" }
          : null;
    return {
      part,
      text: offerText(part, card.damageType),
      on,
      targetId,
      shownOn: targetId ?? hits[0]?.targetId ?? rows[0]?.targetId ?? null,
      value,
      multiplier,
      force: !!t?.force,
      hint,
      lands: on ? Math.floor(value * MULTIPLIER_FACTOR[multiplier]) : 0,
    };
  });
}

/** The DM touched a chip: its resolved state + the patch. */
export function touch(
  value: ChipsValue | undefined,
  chip: ChipView,
  patch: Partial<ChipState>,
): Readonly<Record<string, ChipState>> {
  const prev = value?.touched[chip.part.triggerId];
  const base: ChipState = prev ?? { on: chip.on, targetId: chip.targetId };
  return { ...value?.touched, [chip.part.triggerId]: { ...base, ...patch } };
}

/** This row's share of `cbt.applyCard`: its ticked chips (`{}` for none / a Miss row). */
export function chipsInput(
  value: ChipsValue | undefined,
  row: PopupRowView,
): { triggers?: ApplyTargetTrigger[] } {
  if (!row.hit) return {};
  const mine = (value?.chips ?? []).filter((c) => c.on && c.targetId === row.targetId);
  if (mine.length === 0) return {};
  return {
    triggers: mine.map((c) => ({
      triggerId: c.part.triggerId,
      ...(c.value !== c.part.value ? { value: c.value } : {}),
      multiplier: c.multiplier,
      ...(c.force ? { force: true } : {}),
    })),
  };
}

/** Σ damage the ticked chips add to this row (preview only). */
export const chipsExtra = (value: ChipsValue | undefined, row: PopupRowView): number =>
  row.hit
    ? (value?.chips ?? [])
        .filter((c) => c.targetId === row.targetId)
        .reduce((s, c) => s + c.lands, 0)
    : 0;

/**
 * FR-MOD-40: a rejected apply whose issues name parts (`["triggers", triggerId]`, a used
 * charge): those chips show the message with a Force tick (still ticked, Force off).
 */
export function markUsed(
  value: ChipsValue | undefined,
  issues: readonly { path?: readonly unknown[]; message?: string }[] | undefined,
): Readonly<Record<string, ChipState>> | null {
  let touched = value?.touched ?? {};
  let changed = false;
  for (const i of issues ?? []) {
    const [k, id] = i.path ?? [];
    const chip = value?.chips.find((c) => c.part.triggerId === id);
    if (k !== "triggers" || !chip) continue;
    touched = touch({ touched, chips: value?.chips ?? [] }, chip, {
      used: i.message ?? "Used this turn",
      force: false,
    });
    changed = true;
  }
  return changed ? touched : null;
}
