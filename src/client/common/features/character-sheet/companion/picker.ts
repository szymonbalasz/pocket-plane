// Companion card data (FR-CHARX-60–62, -67): which companions a viewer's card lists and what each
// shows, read from the records the viewer already receives (pet `entity` rows, companion
// `combatant` rows of the started encounter). Pure; plus the per-browser selection
// (FR-CHARX-61, as FR-CHARX-47): `localStorage` `pp.companion.v1.<campaignId>.<dm | playerId>`.

import { sideOf } from "@shared/combat-tracker/rules";
import type { CombatantView, Side } from "@shared/combat-tracker/schemas";
import {
  type CompanionCard,
  companionCard,
  isPet,
  type MonsterStatBlock,
  type TurnMode,
} from "@shared/entities/schemas";
import { createStore } from "zustand";
import { createSheetMemory, type Eligibility } from "../selection";

/** An `entity` row as either client holds it: full (DM, owner), redacted (others), PC summary. */
export interface CompanionEntityLike {
  id: string;
  kind: string;
  name: string;
  campaignId?: string | null;
  portraitAssetId?: string | null;
  ownerPlayerId?: string | null;
  companionOf?: string | null;
  turnMode?: TurnMode | null;
  hpCurrent?: number | null;
  statBlock?: MonsterStatBlock;
}

export interface Viewer {
  role: "dm" | "player";
  playerId: string | null;
}

/** One companion the card can show (FR-CHARX-61). */
export interface CompanionEntry {
  /** Selection key and `data-record-id`: the pet's id, else the combatant's (a summon). */
  key: string;
  name: string;
  imageAssetId: string | null;
  /** The pet entity (a pet, in a fight or not); null = a summon. */
  petId: string | null;
  /** Its active companion combatant of the started encounter; null = not in a fight. */
  combatant: CombatantView | null;
  ownerCharacterId: string;
  /** The owner PC's name ("Mira"). */
  ownerName: string;
  turnMode: TurnMode;
  /** FR-CHARX-60: the combatant's `card` in a fight, else the pet's stat block's. */
  card: CompanionCard | null;
  hp: { current: number | null; max: number | null; temp: number };
  /** FR-CHARX-62: the side chip, only off `ally`. */
  side: Side | null;
  /** DM: the definition its NPC sheet opens (pet or combatant entity); null for players. */
  definitionId: string | null;
}

/** FR-CHARX-62: "Acts after Mira" / "In Mira's turn" / "Own initiative" (FR-CBT-106). */
export function modeText(mode: TurnMode, owner: string): string {
  if (mode === "after-owner") return `Acts after ${owner}`;
  if (mode === "in-owner-turn") return `In ${owner}'s turn`;
  return "Own initiative";
}

/** FR-CHARX-62: "Mira's pet" / "Mira's summon". */
export const ownerText = (e: Pick<CompanionEntry, "ownerName" | "petId">): string =>
  `${e.ownerName}'s ${e.petId ? "pet" : "summon"}`;

/** FR-CHARX-63: "Large monstrosity" (size alone when the type isn't known). */
export function sizeTypeText(card: Pick<CompanionCard, "size" | "type">): string {
  const size = `${card.size.charAt(0).toUpperCase()}${card.size.slice(1)}`;
  return card.type ? `${size} ${card.type}` : size;
}

/** A pet's card rows carry its stat-block row ids (FR-ENT-32); a legacy row gets its index. */
const petCard = (s: MonsterStatBlock): CompanionCard => {
  let i = 0;
  return companionCard(s, () => `row-${i++}`);
};

/**
 * FR-CHARX-61 (a pet in a fight shows once, from its combatant): the DM's combatant names its
 * entity; a player's owner view doesn't, so its pet is the owner's pet of the same name.
 */
function isPetCombatant(c: CombatantView, pet: CompanionEntityLike): boolean {
  if (c.pet !== true) return false;
  if (c.entityId !== undefined) return c.entityId === pet.id;
  return c.ownerCharacterId === pet.companionOf && c.name === pet.name;
}

/**
 * FR-CHARX-61 / -67: player → own pets (full rows) and own active companion combatants; DM →
 * every pet and every active companion combatant. Sorted by owner PC, then name.
 * `combatants` = the started encounter's rows (none outside a fight).
 */
export function companionEntries(
  viewer: Viewer,
  entities: readonly CompanionEntityLike[],
  combatants: readonly CombatantView[],
): CompanionEntry[] {
  const dm = viewer.role === "dm";
  const nameOf = (id: string) => entities.find((e) => e.id === id)?.name ?? "—";
  const owned = combatants.filter(
    (c) =>
      c.kind === "monster" &&
      !c.removed &&
      c.active !== false &&
      typeof c.ownerCharacterId === "string" &&
      (dm || c.ownerPlayerId === viewer.playerId),
  );
  const pets = entities.filter(
    (e) => isPet(e) && e.statBlock !== undefined && (dm || e.ownerPlayerId === viewer.playerId),
  );
  const used = new Set<string>();
  const entry = (pet: CompanionEntityLike | null, c: CombatantView | null): CompanionEntry => {
    const owner = (c?.ownerCharacterId ?? pet?.companionOf) as string;
    const stats = pet?.statBlock;
    const hp = c
      ? { current: c.hpCurrent ?? null, max: c.hpMax ?? null, temp: c.tempHp ?? 0 }
      : { current: pet?.hpCurrent ?? null, max: stats?.hpMax ?? null, temp: 0 };
    const side = c ? sideOf(c) : null;
    return {
      key: pet?.id ?? (c as CombatantView).id,
      name: c?.name ?? (pet as CompanionEntityLike).name,
      imageAssetId: c ? c.imageAssetId : (pet?.portraitAssetId ?? null),
      petId: pet?.id ?? null,
      combatant: c,
      ownerCharacterId: owner,
      ownerName: nameOf(owner),
      turnMode: c?.turnMode ?? pet?.turnMode ?? "after-owner",
      card: c ? (c.card ?? null) : stats ? petCard(stats) : null,
      hp,
      side: side === "ally" ? null : side,
      definitionId: dm ? (pet?.id ?? c?.entityId ?? null) : null,
    };
  };
  const out: CompanionEntry[] = pets.map((pet) => {
    const c = owned.find((x) => !used.has(x.id) && isPetCombatant(x, pet)) ?? null;
    if (c) used.add(c.id);
    return entry(pet, c);
  });
  // Summons (and any companion combatant that isn't a listed pet).
  for (const c of owned) if (!used.has(c.id) && c.pet !== true) out.push(entry(null, c));
  return out.sort((a, b) => a.ownerName.localeCompare(b.ownerName) || a.name.localeCompare(b.name));
}

/** FR-CHARX-59 / OQ-CHARX-33: the player's launcher entry is available iff they own one. */
export function ownsCompanion(
  playerId: string | null,
  entities: readonly CompanionEntityLike[],
  combatants: readonly CombatantView[],
): boolean {
  return companionEntries({ role: "player", playerId }, entities, combatants).length > 0;
}

/** The entry a request names (Initiative row, Party, token): its key, pet or combatant id. */
export const entryFor = (
  entries: readonly CompanionEntry[],
  id: string | null,
): CompanionEntry | null =>
  id === null
    ? null
    : (entries.find((e) => e.key === id || e.petId === id || e.combatant?.id === id) ?? null);

// ---------- selection (FR-CHARX-61) ----------

export const companionMemoryKey = (
  campaignId: string,
  role: "dm" | "player",
  playerId: string | null,
) => `pp.companion.v1.${campaignId}.${role === "dm" ? "dm" : (playerId ?? "unknown")}`;

export const companionSelection = createStore<{ selectedId: string | null }>(() => ({
  selectedId: null,
}));

let memory = createSheetMemory();

/** Tests: a fresh memory over `backend`. */
export function resetCompanionMemory(
  m: ReturnType<typeof createSheetMemory> = createSheetMemory(),
) {
  memory = m;
  companionSelection.setState({ selectedId: null });
}

/** After the first snapshot (and per campaign): restore the stored choice if still listed. */
export function bindCompanionMemory(key: string, listed: (id: string) => boolean) {
  const eligible: Eligibility = (id) => (listed(id) ? "option" : null);
  const patch = memory.bind(key, companionSelection.getState().selectedId, eligible);
  if (patch.selectedId) companionSelection.setState({ selectedId: patch.selectedId });
}

export function selectCompanion(key: string) {
  companionSelection.setState({ selectedId: key });
  memory.touched(key);
}

/** FR-CHARX-61: the selected entry, else (none, or it left) the first one, else null. */
export const shownEntry = (
  entries: readonly CompanionEntry[],
  selectedId: string | null,
): CompanionEntry | null => entryFor(entries, selectedId) ?? entries[0] ?? null;

/**
 * FR-CHARX-68: the name of the companion the card showed if it is no longer listed (Dismiss,
 * turned hostile, hidden, released, owner reassigned), else null.
 */
export const leftCompanion = (
  last: Pick<CompanionEntry, "key" | "name"> | null,
  entries: readonly CompanionEntry[],
): string | null => (last && !entries.some((x) => x.key === last.key) ? last.name : null);

/** FR-CHARX-68: "No longer your companion" shows this long before the picker moves on. */
export const GONE_MS = 3000;
