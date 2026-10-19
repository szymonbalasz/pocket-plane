// Sprint 5 late damage in the DM's attack popup (FR-CBT-87–93, ADR-0053): pure, DOM-free (bun
// test). The popup's step comes from the card's hit ruling (to-hit step without one, damage step
// with one); the primary button reads "Apply hit" while a Hit row waits for damage; a late roll
// fills each field (base, each extra part) on its own unless the DM typed into it, and never
// fills a focused field; the late note names an apply of this turn the roll could have joined.
import type { DamageCardPayload, HitRulingRecord } from "@shared/combat-tracker/schemas";

export type PopupStep = "to-hit" | "damage";

/** FR-CBT-89: the damage step iff the card has a hit ruling (DM store), also after a reload. */
export const popupStep = (ruling: HitRulingRecord | null | undefined): PopupStep =>
  ruling ? "damage" : "to-hit";

/**
 * FR-CBT-87: the primary button. "Apply hit" on a card with a to-hit roll and no damage yet, in
 * the to-hit step, with ≥ 1 Hit row and no typed total; else "Apply" (all Miss, a typed total, a
 * full card, a damage-only card, the damage step).
 */
export function primaryAction(o: {
  step: PopupStep;
  card: Pick<DamageCardPayload, "toHit" | "damage">;
  hits: readonly boolean[];
  typedTotal: boolean;
}): "apply-hit" | "apply" {
  const waiting = o.card.toHit !== null && o.card.damage === null;
  return o.step === "to-hit" && waiting && o.hits.some((h) => h) && !o.typedTotal
    ? "apply-hit"
    : "apply";
}

/**
 * FR-CBT-89: the damage step's rows = the ruled hits in ruling order, minus the ones the DM
 * dropped (✕); the multiplier preset is the ruling's.
 */
export function ruledRows(
  ruling: HitRulingRecord,
  dropped: readonly string[],
): { targetId: string; multiplier: HitRulingRecord["targets"][number]["multiplier"] }[] {
  return ruling.targets
    .filter((t) => t.hit && !dropped.includes(t.targetId))
    .map(({ targetId, multiplier }) => ({ targetId, multiplier }));
}

// ---------- fields that fill (FR-CBT-90) ----------

/**
 * One editable total: `text` = what the DM typed (null = follow the roll); `frozen` = the text the
 * field showed when it took focus untouched (it stays until blur, so a roll arriving meanwhile
 * never fills it, and typing "7" never yields "87").
 */
export interface FieldDraft {
  text: string | null;
  frozen?: string;
}

export const FIELD_EMPTY: FieldDraft = { text: null };

/** What the field shows: the DM's text, else the rolled value, else "". */
export const fieldValue = (f: FieldDraft | undefined, rolled: number | null | undefined) =>
  f?.text ?? (rolled == null ? "" : String(rolled));

/** Typed by the DM (a focused, untouched field is not). */
export const isTyped = (f: FieldDraft | undefined) =>
  f !== undefined && f.text !== null && f.frozen === undefined;

/** "rolled N" beside a field that shows something else than its roll (typed, or focused empty). */
export function rolledHint(f: FieldDraft | undefined, rolled: number | null | undefined) {
  if (rolled == null) return null;
  return fieldValue(f, rolled) === String(rolled) ? null : rolled;
}

/** Focus: an untouched field freezes what it shows. */
export function focusField(f: FieldDraft | undefined, rolled: number | null | undefined) {
  if (f?.text != null) return f;
  const shown = fieldValue(f, rolled);
  return { text: shown, frozen: shown };
}

/** The DM typed. */
export const typeField = (text: string): FieldDraft => ({ text });

/**
 * Blur: an empty field, or one left as it was frozen, follows the roll again (fills now if the
 * roll arrived meanwhile); anything else stays the DM's.
 */
export function blurField(f: FieldDraft | undefined): FieldDraft {
  if (!f || f.text === null || f.text.trim() === "") return FIELD_EMPTY;
  if (f.frozen !== undefined && f.text === f.frozen) return FIELD_EMPTY;
  return { text: f.text };
}

// ---------- the late note (FR-CBT-93 b) ----------

/** A card this DM client saw resolved: its attacker, row and the turn it happened in. */
export interface ResolvedCard {
  cardId: string;
  seq: number;
  encounterId: string;
  attackerId: string;
  attackerName: string;
  attackName: string;
  attackId?: string;
  spellId?: string;
  turn: string;
}

/** The turn as the DM client sees it ("round:turn combatant"). */
export const turnKey = (e: { round: number; turnCombatantId?: string | null }) =>
  `${e.round}:${e.turnCombatantId ?? ""}`;

/**
 * FR-CBT-93 (b): a damage-only card for the same attacker and row as a card resolved earlier
 * this turn (client memory; nothing after a reload): "Mira's Light crossbow attack was already
 * applied. Undo it to use this roll there."
 */
export function lateNote(
  card: { seq: number; p: DamageCardPayload },
  resolved: readonly ResolvedCard[],
  turn: string | null,
): string | null {
  const { p } = card;
  if (p.toHit !== null || turn === null) return null;
  const hit = resolved.find(
    (r) =>
      r.turn === turn &&
      r.seq < card.seq &&
      r.encounterId === p.encounterId &&
      r.attackerId === p.attackerId &&
      r.attackId === p.attackId &&
      r.spellId === p.spellId,
  );
  return hit
    ? `${hit.attackerName}'s ${hit.attackName} attack was already applied. Undo it to use this roll there.`
    : null;
}

/** "Also rolled: 9 — not used" (FR-CBT-92); null without unused rolls. */
export const unusedText = (p: Pick<DamageCardPayload, "unusedRolls">) =>
  p.unusedRolls?.length
    ? `Also rolled: ${p.unusedRolls.map((u) => u.total).join(", ")} — not used`
    : null;
