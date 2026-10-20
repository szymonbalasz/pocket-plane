// Creatures joining combat, DM preview (pure; bun test): Start (FR-CBT-64–66) and the Add dialog
// (FR-CBTX-44) show per instance "token" / "new token" / "no token", the HP mode and eye-off if
// hidden, as the server will do it; plus the Start dialog's "Not on this map" PCs and intent body.
// Sprint 6 (FR-CBT-109): joining PCs' pets, ticked iff a token of theirs is on the scene.
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
  /** FR-CBT-109: a pet joining with its owner: binds its token or joins token-less (kept HP). */
  pet?: boolean;
}

export interface JoinRow extends Binding {
  binding: JoinBinding;
  hpMode: HpMode;
  /** `rolled` asked, but the definition lost its formula: the server uses average. */
  averageFallback: boolean;
  pet?: boolean;
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
      averageFallback: s.kind === "monster" && s.hpMode === "rolled" && !s.hasFormula && !s.pet,
    };
    if (b.tokenId !== null) return { ...b, ...base, binding: "token" as const };
    // FR-CBT-109: a pet never gets a new token.
    if (s.kind === "monster" && opts.createTokens && !s.pet) {
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
 * from the Start dialog, when measured); unticked "Not on this map" PCs → `excludeCharacterIds`;
 * sprint 6 (FR-CBT-109): the ticked pets → `petIds`.
 */
export function startBody(
  encounterId: string,
  sceneId: string,
  offMap: readonly { id: string }[],
  joining: ReadonlySet<string>,
  at: GridCell | null,
  petIds: readonly string[] = [],
): StartInput {
  const exclude = offMap.filter((c) => !joining.has(c.id)).map((c) => c.id);
  return {
    encounterId,
    sceneId,
    ...(at ? { at } : {}),
    ...(exclude.length > 0 ? { excludeCharacterIds: exclude } : {}),
    ...(petIds.length > 0 ? { petIds: [...petIds] } : {}),
  };
}

/** A pet the Start dialog offers (FR-CBT-109). */
export interface PetOffer<P extends { id: string; companionOf: string }> {
  pet: P;
  /** A token of the pet is on the scene (unbound: nothing is bound before Start). */
  onMap: boolean;
  ticked: boolean;
}

/**
 * FR-CBT-109: the joining PCs' pets, in the PCs' order, then in the given order: ticked by
 * default iff a token of theirs is on the scene ("Not on this map" ones start unticked); `picks`
 * = the DM's ticks so far (pet id → ticked).
 */
export function petOffers<P extends { id: string; companionOf: string }>(
  pets: readonly P[],
  joiningPcIds: readonly string[],
  sceneTokens: readonly { definitionId: string }[],
  picks: ReadonlyMap<string, boolean>,
): PetOffer<P>[] {
  return joiningPcIds.flatMap((pc) =>
    pets
      .filter((p) => p.companionOf === pc)
      .map((pet) => {
        const onMap = sceneTokens.some((t) => t.definitionId === pet.id);
        return { pet, onMap, ticked: picks.get(pet.id) ?? onMap };
      }),
  );
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
export function hpLabel(r: Pick<JoinRow, "kind" | "hpMode" | "averageFallback" | "pet">): string {
  if (r.kind !== "monster" || r.pet) return "";
  if (r.averageFallback) return "Average (no formula)";
  return r.hpMode === "rolled" ? "Rolled" : "Average";
}
