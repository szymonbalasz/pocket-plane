// Creatures joining combat, DM preview (pure; bun test): Start (FR-CBT-64–66) and the Add dialog
// (FR-CBTX-44) show per instance "token" / "new token" / "no token", the HP mode and eye-off if
// hidden, as the server will do it; plus the Start dialog's "Not on this map" PCs and intent body.
import {
  type Binding,
  type BindSlot,
  type BindToken,
  planBindings,
} from "@shared/combat-tracker/rules";
import type { GridCell, HpMode, StartInput } from "@shared/combat-tracker/schemas";
import { numberedName } from "@shared/scenes-map/geometry";

/** `cbt-enc-binding` / `cbtx-add-binding` `data-value`. */
export type JoinBinding = "token" | "new" | "none";

export interface JoinSlot extends BindSlot {
  hpMode: HpMode;
  /** The definition has an `hpFormula` now (FR-ENT-25); `rolled` without one → average. */
  hasFormula: boolean;
}

export interface JoinRow extends Binding {
  binding: JoinBinding;
  hpMode: HpMode;
  /** `rolled` asked, but the definition lost its formula: the server uses average. */
  averageFallback: boolean;
}

/**
 * FR-CBT-64 / FR-CBTX-44 order per instance: the next free placed token (copies, its own
 * `hidden`); else a monster with `createTokens` → "new token" (FR-MAP-16 name over the scene's
 * token names, `hidden` = `hidden`); else "no token" (numbered, visible). PCs never get a new
 * token (FR-CBT-66). `freeTokens` = the scene's tokens not bound to an active combatant.
 */
export function previewJoin(
  slots: readonly JoinSlot[],
  freeTokens: readonly BindToken[],
  opts: { createTokens: boolean; hidden: boolean; sceneTokenNames: readonly string[] },
): JoinRow[] {
  const names = [...opts.sceneTokenNames];
  return planBindings(slots, freeTokens).map((b, i) => {
    const s = slots[i] as JoinSlot;
    const base = {
      hpMode: s.hpMode,
      averageFallback: s.kind === "monster" && s.hpMode === "rolled" && !s.hasFormula,
    };
    if (b.tokenId !== null) return { ...b, ...base, binding: "token" as const };
    if (s.kind === "monster" && opts.createTokens) {
      const name = numberedName(s.name.slice(0, 40), names);
      names.push(name);
      return { ...b, ...base, name, hidden: opts.hidden, binding: "new" as const };
    }
    return { ...b, ...base, binding: "none" as const };
  });
}

/** FR-CBT-66: party PCs with no token of theirs on the scene ("Not on this map"). */
export function notOnMap<C extends { id: string }>(
  party: readonly C[],
  sceneTokens: readonly { definitionId: string }[],
): C[] {
  return party.filter((c) => !sceneTokens.some((t) => t.definitionId === c.id));
}

/**
 * P3 glitch 7: the planned party ids Start adds when the DM ticks nothing: those with a token on
 * the scene ("Not on this map" PCs start unticked, FR-CBT-66). The builder's rating uses them.
 */
export function defaultJoiningIds(
  partyIds: readonly string[],
  sceneTokens: readonly { definitionId: string }[],
): string[] {
  const off = new Set(
    notOnMap(
      partyIds.map((id) => ({ id })),
      sceneTokens,
    ).map((c) => c.id),
  );
  return partyIds.filter((id) => !off.has(id));
}

/**
 * The Start intent (FR-CBT-64–66): `at` only when the DM views the scene it starts on (always,
 * from the Start dialog, when measured); unticked "Not on this map" PCs → `excludeCharacterIds`.
 */
export function startBody(
  encounterId: string,
  sceneId: string,
  offMap: readonly { id: string }[],
  joining: ReadonlySet<string>,
  at: GridCell | null,
): StartInput {
  const exclude = offMap.filter((c) => !joining.has(c.id)).map((c) => c.id);
  return {
    encounterId,
    sceneId,
    ...(at ? { at } : {}),
    ...(exclude.length > 0 ? { excludeCharacterIds: exclude } : {}),
  };
}

/**
 * OQ-CBTX-22 / FR-CBT-65: "Add hidden" is disabled while "Create tokens" is off; with no scene
 * "Create tokens" is disabled too ("This encounter has no scene") and nothing is created.
 */
export function addOptionsState(o: { createTokens: boolean; hasScene: boolean }) {
  const createDisabled = !o.hasScene;
  const creating = o.createTokens && o.hasScene;
  return { createDisabled, hiddenDisabled: !creating, creating };
}

/** `HP` Select label of a preview row. */
export function hpLabel(r: Pick<JoinRow, "kind" | "hpMode" | "averageFallback">): string {
  if (r.kind !== "monster") return "";
  if (r.averageFallback) return "Average (no formula)";
  return r.hpMode === "rolled" ? "Rolled" : "Average";
}
