// Attack popup target list (FR-CBT-33) and Undo label (FR-CBT-35): pure, DOM-free (bun test).
// Rows = selection rows (combatants bound to a selected token, selection order) ∪ added rows
// (picked in "Add target", add order). Only eligible combatants: active, non-removed, of the
// started encounter, not the attacker. Client memory only; the server re-checks on apply.
import { naturalMark, publicRuling } from "@shared/combat-tracker/log-kinds";
import { hitHint, undoGroup } from "@shared/combat-tracker/rules";
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
 * Undo Tooltip (FR-CBT-25, FR-CBT-35): "Undo: Goblin → Mira, 6" for one row; "Undo: Goblin →
 * Goblin, Goblin 2 (2 targets)" for a multi-target apply. Null = nothing to undo.
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
    const sign = last.kind === "heal" ? "+" : "";
    return {
      text: `Undo: ${who} → ${last.targetName}, ${sign}${last.applied}`,
      expectedHpChangeId: last.id,
    };
  }
  const names = [...unit].reverse().map((r) => r.targetName);
  return {
    text: `Undo: ${who} → ${names.join(", ")} (${unit.length} targets)`,
    expectedHpChangeId: last.id,
  };
}
