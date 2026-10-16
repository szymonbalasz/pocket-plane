// A rule trigger's owner as the client sees it (FR-MOD-35, -45, -49, -50): a character (name,
// stats, sheet features, lock, owner player) or a monster definition (custom or imported). The
// formula's live value reads the stats from the synced store (characters, customs) or, for an
// imported definition, from `useDefinitions` (lazy, FR-CMP-16; review C5): `useOwnerDefinitions`.
import type { FeatureRow } from "@shared/character-sheet/sheet";
import type { FormulaOwner } from "@shared/effect-modifiers/formula";
import { formulaOwnerOf } from "@shared/effect-modifiers/trigger-fire";
import type { PlayerRuleTriggerRecord } from "@shared/effect-modifiers/trigger-records";
import type { TriggerWordsContext } from "@shared/effect-modifiers/trigger-words";
import { type DefinitionRecord, ENTITY_TYPE, type StatBlock } from "@shared/entities/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { useDefinitions } from "../compendium/definitions";
import { presetsIn, sheetIn } from "./store";

export type TriggerOwnerKind = "character" | "definition";
export interface TriggerOwnerRef {
  kind: TriggerOwnerKind;
  id: string;
}

export interface TriggerOwnerFacts {
  name: string;
  /** Formula values (FR-MOD-35); null when the owner's stats aren't held. */
  values: FormulaOwner | null;
  /** The character's sheet features (`every.feature`); undefined = sheet not held / definition. */
  features: readonly FeatureRow[] | undefined;
  locked: boolean;
  ownerPlayerId: string | null;
}

interface DefinitionLike {
  name?: string;
  kind?: string;
  statBlock?: StatBlock;
  ownerPlayerId?: string | null;
}

const recordOf = (store: RecordStore, type: string, id: string) =>
  store.records[type]?.[id] as DefinitionLike | undefined;

/** Definitions `useDefinitions` holds for a definition owner (an imported one loads, DM only). */
export function useOwnerDefinitions(
  owner: TriggerOwnerRef | null,
): ReadonlyMap<string, DefinitionRecord> {
  return useDefinitions(owner?.kind === "definition" ? [owner.id] : []).byId;
}

/**
 * `definitions`: `useOwnerDefinitions(owner)`; without it an imported definition's stats and
 * name aren't known (campaign rows still come from the store).
 */
export function triggerOwnerFacts(
  store: RecordStore,
  owner: TriggerOwnerRef,
  definitions?: ReadonlyMap<string, DefinitionRecord>,
): TriggerOwnerFacts {
  const def =
    recordOf(store, ENTITY_TYPE, owner.id) ??
    (owner.kind === "definition"
      ? (definitions?.get(owner.id) as DefinitionLike | undefined)
      : undefined);
  let values: FormulaOwner | null = null;
  try {
    values = def?.statBlock ? formulaOwnerOf(def.statBlock) : null;
  } catch {
    values = null; // a malformed or partial stat block: no live value
  }
  const sheet = owner.kind === "character" ? sheetIn(store, owner.id) : undefined;
  return {
    name: def?.name ?? (owner.kind === "character" ? "Character" : "Monster"),
    values,
    features: sheet?.features,
    locked: sheet?.locked === true,
    ownerPlayerId: def?.ownerPlayerId ?? null,
  };
}

/** FR-MOD-45: the DM; the owner player for their own character while the sheet is unlocked. */
export function mayEditTriggers(store: RecordStore, owner: TriggerOwnerRef): boolean {
  const you = store.you;
  if (you?.role === "dm") return true;
  if (owner.kind !== "character" || !you?.playerId) return false;
  const f = triggerOwnerFacts(store, owner);
  return f.ownerPlayerId === you.playerId && !f.locked;
}

/** Names of the presets the viewer holds and of the owner's feature rows (sentences, warnings). */
export function wordsContext(
  store: RecordStore,
  features: readonly FeatureRow[] | undefined,
): TriggerWordsContext {
  const presets = new Map(presetsIn(store).map((p) => [p.id, p.name]));
  return {
    presetName: (id) => presets.get(id),
    featureName: (id) => features?.find((f) => f.id === id)?.name,
  };
}

/** FR-MOD-47 (client side too): the owner's rows only; a player never sees a definition's. */
export function ownerTriggers(
  rows: readonly PlayerRuleTriggerRecord[],
  owner: TriggerOwnerRef,
  role: "dm" | "player" | undefined,
): PlayerRuleTriggerRecord[] {
  return rows
    .filter((t) =>
      owner.kind === "character"
        ? t.characterId === owner.id
        : role === "dm" && t.definitionId === owner.id,
    )
    .sort((a, b) => a.seq - b.seq);
}
