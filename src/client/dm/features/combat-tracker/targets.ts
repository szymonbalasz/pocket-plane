// Attack popup target list (FR-CBT-33) and Undo label (FR-CBT-35): pure, DOM-free (bun test).
// Rows = selection rows (combatants bound to a selected token, selection order) ∪ added rows
// (picked in "Add target", add order). Only eligible combatants: active, non-removed, of the
// started encounter, not the attacker. Client memory only; the server re-checks on apply.
import { absorb } from "@shared/combat-extras/rules";
import { naturalMark, publicRuling } from "@shared/combat-tracker/log-kinds";
import { clampHp, hitHint, undoGroup } from "@shared/combat-tracker/rules";
import { APPLY_TARGETS_MAX, type HpChangeRecord } from "@shared/combat-tracker/schemas";

export interface TargetCandidate {
  id: string;
  encounterId: string;
  tokenId: string | null;
  name: string;
  hidden?: boolean;
  active?: boolean;
  removed?: boolean;
}

export interface TargetRow<C extends TargetCandidate> {
  c: C;
  source: "selection" | "added";
}

export function eligibleTargets<C extends TargetCandidate>(
  combatants: readonly C[],
  encounterId: string,
  attackerId: string,
): C[] {
  return combatants.filter(
    (c) => c.encounterId === encounterId && c.active !== false && !c.removed && c.id !== attackerId,
  );
}

export interface TargetList<C extends TargetCandidate> {
  rows: TargetRow<C>[];
  /** Selected tokens not bound to an eligible combatant (the attacker's own token excepted). */
  notInCombat: number;
  /** > 20 rows: Apply disabled ("Max 20 targets"). */
  tooMany: boolean;
}

export function targetList<C extends TargetCandidate>(o: {
  combatants: readonly C[];
  encounterId: string;
  attackerId: string;
  selectedTokenIds: readonly string[];
  added: readonly string[];
}): TargetList<C> {
  const eligible = eligibleTargets(o.combatants, o.encounterId, o.attackerId);
  const attackerToken = o.combatants.find((c) => c.id === o.attackerId)?.tokenId ?? null;
  const rows: TargetRow<C>[] = [];
  const seen = new Set<string>();
  let notInCombat = 0;
  for (const tokenId of o.selectedTokenIds) {
    const c = eligible.find((x) => x.tokenId === tokenId);
    if (!c) {
      if (tokenId !== attackerToken) notInCombat += 1;
      continue;
    }
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    rows.push({ c, source: "selection" });
  }
  for (const id of o.added) {
    const c = eligible.find((x) => x.id === id);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    rows.push({ c, source: "added" });
  }
  return { rows, notInCombat, tooMany: rows.length > APPLY_TARGETS_MAX };
}

/**
 * Adding a combatant: one whose token is on the viewed scene is selected (it becomes a selection
 * row); any other (hidden off-scene, token-less) becomes an added row.
 */
export function addAction(
  c: TargetCandidate,
  tokenSceneOf: (tokenId: string) => string | null,
  viewedSceneId: string | null,
): { select: string } | { add: string } {
  if (c.tokenId && viewedSceneId && tokenSceneOf(c.tokenId) === viewedSceneId) {
    return { select: c.tokenId };
  }
  return { add: c.id };
}

/** Per-target hit preset: nat 20 hit, nat 1 miss, else total ≥ AC; unknown AC → hit. */
export function presetHit(natural: number | null, toHitTotal: number, ac: number | null): boolean {
  return ac === null ? true : hitHint(natural, toHitTotal, ac);
}

/**
 * FR-CBT-57 (R4): a target row whose Hit / Miss contradicts the natural roll (Hit on a natural 1,
 * Miss on a natural 20): the mark beside the toggle and the players' wording (FR-CBT-58).
 */
export function naturalContradiction(
  natural: number | null,
  hit: boolean,
): { natural: 1 | 20; hint: string } | null {
  const mark = naturalMark(natural);
  if (mark === null || !publicRuling(natural, hit)) return null;
  return { natural: mark, hint: `Players see: DM ruled ${hit ? "hit" : "miss"}` };
}

/**
 * Undo Tooltip (FR-CBT-25, FR-CBT-35, FR-CBT-80): one row reads "Undo: Sela → Goblin 2, 6
 * damage", "…, miss" (hit false) or "Undo: DM → Mira, heal 5", the amount being `raw` (dealt
 * after the multiplier), not `applied`; "Undo: Goblin → Goblin, Goblin 2 (2 targets)" for a
 * multi-target apply. Null = nothing to undo.
 */
export function undoLabel(rows: readonly HpChangeRecord[]): {
  text: string;
  expectedHpChangeId: string;
} | null {
  const unit = undoGroup(rows);
  const last = unit[0];
  if (!last) return null;
  const who = last.attackerName ?? "DM";
  if (unit.length === 1) {
    const what =
      last.kind === "heal"
        ? `heal ${last.raw}`
        : last.hit === false
          ? "miss"
          : `${last.raw} damage`;
    return { text: `Undo: ${who} → ${last.targetName}, ${what}`, expectedHpChangeId: last.id };
  }
  const names = [...unit].reverse().map((r) => r.targetName);
  return {
    text: `Undo: ${who} → ${names.join(", ")} (${unit.length} targets)`,
    expectedHpChangeId: last.id,
  };
}

/** HP and temp HP the DM sees for one creature (FR-CBT-78). */
export interface HpTemp {
  cur: number;
  max: number;
  temp: number;
}

/**
 * FR-CBT-78 (G5): HP and temp HP after `amount`, by CBTX's absorption (FR-CBTX-15, the shared
 * `absorb`): damage drains temp HP first, then HP (clamped); heal ignores temp HP.
 */
export function hpAfter(hp: HpTemp, kind: "damage" | "heal", amount: number): HpTemp {
  if (kind === "heal") return { ...hp, cur: clampHp(hp.cur, amount, hp.max) };
  const { absorbed, rest } = absorb(hp.temp, amount);
  return { ...hp, cur: clampHp(hp.cur, -rest, hp.max), temp: hp.temp - absorbed };
}

/** "10 (+5)" with temp HP, else "10". */
export const hpTempText = (hp: Pick<HpTemp, "cur" | "temp">) =>
  hp.temp > 0 ? `${hp.cur} (+${hp.temp})` : `${hp.cur}`;

/** FR-CBT-78 popup target preview: "Thorn 10 (+5) → 10 (+2)", "Goblin 7 → 1". */
export const previewText = (name: string, hp: HpTemp, raw: number) =>
  `${name} ${hpTempText(hp)} → ${hpTempText(hpAfter(hp, "damage", raw))}`;

/** FR-CBT-78 Damage / heal dialog: "HP 10 / 10 · Temp 5" (no temp → "HP 10 / 10"). */
export const hpDialogText = (hp: HpTemp) =>
  `HP ${hp.cur} / ${hp.max}${hp.temp > 0 ? ` · Temp ${hp.temp}` : ""}`;

// ---------- partial cards (FR-CBT-72, N7) ----------

/** Which rolls a card holds: both, to-hit only (damage pending) or damage only. */
export type CardShape = "full" | "toHit" | "damage";

export function cardShape(p: { toHit: unknown; damage: unknown }): CardShape {
  if (p.toHit === null) return "damage";
  return p.damage === null ? "toHit" : "full";
}

/**
 * Hit preset of a target row: a damage-only card has no to-hit, so every row starts Hit
 * (FR-CBT-72); else the to-hit rule (FR-CBT-33).
 */
export function rowPreset(
  shape: CardShape,
  natural: number | null,
  toHitTotal: number,
  ac: number | null,
): boolean {
  return shape === "damage" ? true : presetHit(natural, toHitTotal, ac);
}

/**
 * The total an editable cell shows: the DM's draft once typed, else the rolled value (so damage
 * attaching while the popup is open fills the cell, and a typed total stays); "" = none yet.
 */
export function shownTotal(draft: string | null, rolled: number | null | undefined): string {
  if (draft !== null) return draft;
  return rolled == null ? "" : String(rolled);
}

/** An integer total typed in a cell, else null (empty or not a number). */
export function totalOf(s: string): number | null {
  const n = Number(s);
  return s.trim() !== "" && Number.isInteger(n) ? n : null;
}

/**
 * FR-CBT-72: Apply needs rows, at most 20, and a damage total unless every row is a Miss (a
 * to-hit-only card whose damage hasn't been rolled).
 */
export function applyReady(
  hits: readonly boolean[],
  damageTotal: number | null,
  tooMany: boolean,
): boolean {
  if (hits.length === 0 || tooMany) return false;
  return damageTotal !== null || hits.every((h) => !h);
}
