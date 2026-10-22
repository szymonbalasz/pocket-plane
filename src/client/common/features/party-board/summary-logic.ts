// Pure rows of the `party.summary` "Party status" window (FR-PARTY-51–56, sprint 8, CB3): one row
// per player character the viewer receives (drafts out where the viewer holds the sheet), the
// viewer's own first, then by name (DM: by name); companions per ADR-0056 grouped under their
// owner PC after the PC rows (present pets + owned combatants of the started encounter; never an
// unowned or hostile creature, never a hidden / `ownerHidden` one). Reads only records the client
// already holds (FR-PARTY-55): `entity`, `combatant`, `encounter`, `effect`, `creature-sheet`.
// No React.

import { deathStateOf, effectName } from "@shared/combat-extras/rules";
import type { EffectView } from "@shared/combat-extras/schemas";
import { healthBand } from "@shared/combat-tracker/rules";
import {
  type DeathState,
  EntityRecord,
  type HealthBand,
  RedactedCharacter,
} from "@shared/entities/schemas";
import { type CompanionViewer, companionGroups, hpValue } from "./logic";

export const PARTY_SUMMARY_KIND = "party.summary";
export const EMPTY_PARTY = "No player characters yet";
/** FR-CBTX-29's cap: ≤ 4 icons, then "+N". */
export const SUMMARY_ICONS_MAX = 4;

export interface SummaryPc {
  id: string;
  name: string;
  portraitAssetId: string | null;
  ownerPlayerId: string;
  own: boolean;
  hp: { current: number; max: number };
  temp: number;
  /** The sheet's stored AC (OQ-PARTY-32 A). */
  ac: number;
  band: HealthBand;
  deathState: DeathState | null;
  /** Active, non-secret effects on the PC, chip order as stored. */
  effects: EffectView[];
  /** The viewer's turn field names this PC's combatant (FR-CBT-167). */
  turn: boolean;
  /** DM: the PC's active combatant is hidden from players (#141, FR-PARTY-53). */
  hidden: boolean;
  /** FR-PARTY-54: a player's own row, any row for the DM. */
  canOpen: boolean;
}

export interface SummaryCompanion {
  id: string;
  name: string;
  portraitAssetId: string | null;
  /** Numbers for the DM and the owner; null = band only (ADR-0056). */
  hp: { current: number; max: number } | null;
  band: HealthBand;
  ac: number | null;
  effects: EffectView[];
  turn: boolean;
}

export interface SummaryGroup {
  characterId: string;
  characterName: string;
  playerId: string;
  rows: SummaryCompanion[];
}

export interface PartySummary {
  pcs: SummaryPc[];
  companions: SummaryGroup[];
}

/** A combatant as either client holds it: only the fields read here. */
interface CombatantLike {
  id: string;
  encounterId?: string;
  kind?: string;
  entityId?: string;
  name?: string;
  imageAssetId?: string | null;
  active?: boolean;
  removed?: boolean;
  hidden?: boolean;
  ownerHidden?: boolean;
  pet?: boolean;
  ownerCharacterId?: string | null;
  ownerPlayerId?: string | null;
  hpCurrent?: number | null;
  hpMax?: number | null;
  band?: HealthBand;
  card?: { ac: number } | null;
}

interface EncounterLike {
  id: string;
  status?: string;
  turnCombatantId?: string | null;
  playerTurnCombatantId?: string | null;
}

interface PcFigures {
  id: string;
  name: string;
  portraitAssetId: string | null;
  ownerPlayerId: string;
  hpCurrent: number;
  hpMax: number;
  tempHp: number;
  ac: number;
  deathState: DeathState | null;
}

/** A character as the viewer holds it: the other-player whitelist (ADR-0063) or the full row. */
function pcFigures(r: unknown): PcFigures | null {
  const red = RedactedCharacter.safeParse(r);
  if (red.success) return red.data;
  const full = EntityRecord.safeParse({ derivedFromId: null, ...(r as object) });
  if (!full.success || full.data.kind !== "character") return null;
  const c = full.data;
  return {
    id: c.id,
    name: c.name,
    portraitAssetId: c.portraitAssetId,
    ownerPlayerId: c.ownerPlayerId,
    hpCurrent: c.hpCurrent,
    hpMax: c.statBlock.hpMax,
    tempHp: c.tempHp,
    ac: c.statBlock.ac,
    deathState: deathStateOf(c.hpCurrent, c.deathSuccesses, c.deathFailures),
  };
}

const byName = (a: { name: string; id: string }, b: { name: string; id: string }) =>
  a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/** A combatant of the started encounter still in the fight (not removed). */
const inFight = (c: CombatantLike, encId: string | null) =>
  encId !== null && c.encounterId === encId && c.active !== false && c.removed !== true;

export interface SummaryInput {
  entities: readonly unknown[];
  combatants: readonly unknown[];
  encounters: readonly unknown[];
  effects: readonly EffectView[];
  sheets: readonly unknown[];
}

/** FR-PARTY-51–53: the window's rows for this viewer. */
export function partySummary(input: SummaryInput, viewer: CompanionViewer): PartySummary {
  const dm = viewer.role === "dm";
  const enc =
    (input.encounters as readonly EncounterLike[]).find((e) => e.status === "started") ?? null;
  const encId = enc?.id ?? null;
  const turnId = (dm ? enc?.turnCombatantId : enc?.playerTurnCombatantId) ?? null;
  const combatants = (input.combatants as readonly CombatantLike[]).filter((c) =>
    inFight(c, encId),
  );
  // Secret effects never (FR-PARTY-51); ended ones are history.
  const effects = input.effects.filter((e) => !e.endedAt && e.secret !== true);
  const drafts = new Set(
    (input.sheets as readonly { entityId?: string; status?: string }[])
      .filter((s) => s.status === "draft")
      .map((s) => s.entityId),
  );

  const pcs: SummaryPc[] = [];
  for (const r of input.entities) {
    const c = pcFigures(r);
    if (!c || drafts.has(c.id)) continue;
    const own = viewer.playerId !== null && c.ownerPlayerId === viewer.playerId;
    const combatant = combatants.find((x) => x.kind === "pc" && x.entityId === c.id);
    pcs.push({
      id: c.id,
      name: c.name,
      portraitAssetId: c.portraitAssetId,
      ownerPlayerId: c.ownerPlayerId,
      own,
      hp: { current: c.hpCurrent, max: c.hpMax },
      temp: c.tempHp,
      ac: c.ac,
      band: healthBand(c.hpCurrent, c.hpMax),
      deathState: c.deathState,
      effects: effects.filter((e) => e.targetCharacterId === c.id),
      turn: combatant !== undefined && combatant.id === turnId,
      hidden: dm && combatant?.hidden === true,
      canOpen: dm || own,
    });
  }
  pcs.sort((a, b) => Number(b.own) - Number(a.own) || byName(a, b));

  // Companions: present pets (FR-ENT-37) first resolve their combatant, then the other owned
  // combatants (summons, charmed creatures). Players hold no hidden companion (ADR-0056).
  const listed = new Set(pcs.map((p) => p.id));
  const groups = new Map<string, SummaryGroup>();
  const add = (ownerId: string, playerId: string, row: SummaryCompanion) => {
    const owner = pcs.find((p) => p.id === ownerId);
    if (!owner || !listed.has(ownerId)) return;
    const g = groups.get(ownerId) ?? {
      characterId: ownerId,
      characterName: owner.name,
      playerId,
      rows: [],
    };
    g.rows.push(row);
    groups.set(ownerId, g);
  };
  const claimed = new Set<string>();
  const fullPets = new Map<string, { ac: number; present: boolean }>();
  for (const r of input.entities) {
    const p = EntityRecord.safeParse({ derivedFromId: null, ...(r as object) });
    if (p.success && p.data.kind === "monster" && p.data.companionOf !== null) {
      fullPets.set(p.data.id, { ac: p.data.statBlock.ac, present: p.data.petPresent });
    }
  }
  for (const g of companionGroups(input.entities, combatants, viewer)) {
    for (const row of g.rows) {
      const c = combatants.find(
        (x) =>
          x.kind === "monster" &&
          (x.entityId === row.id ||
            (x.entityId === undefined &&
              x.ownerCharacterId === row.ownerCharacterId &&
              x.name === row.name)),
      );
      if (c) claimed.add(c.id);
      // The DM holds every pet: only present ones count; the owner's view carries no
      // `petPresent` (FR-ENT-37), so the owner sees its pets always.
      if (dm && row.record?.petPresent !== true) continue;
      if (dm && (c?.hidden === true || c?.ownerHidden === true)) continue;
      add(row.ownerCharacterId, row.ownerPlayerId, {
        id: row.id,
        name: row.name,
        portraitAssetId: row.portraitAssetId,
        hp: row.hp,
        band: row.band,
        ac: row.hp ? (c?.card?.ac ?? fullPets.get(row.id)?.ac ?? null) : null,
        effects: c ? effects.filter((e) => e.targetCombatantId === c.id) : [],
        turn: c !== undefined && c.id === turnId,
      });
    }
  }
  for (const c of combatants) {
    if (c.kind !== "monster" || claimed.has(c.id) || c.pet === true) continue;
    if (typeof c.ownerCharacterId !== "string" || typeof c.ownerPlayerId !== "string") continue;
    if (c.hidden === true || c.ownerHidden === true) continue;
    const numbers =
      (dm || c.ownerPlayerId === viewer.playerId) &&
      typeof c.hpCurrent === "number" &&
      typeof c.hpMax === "number";
    const hp = numbers ? { current: c.hpCurrent as number, max: c.hpMax as number } : null;
    add(c.ownerCharacterId, c.ownerPlayerId, {
      id: c.id,
      name: c.name ?? "",
      portraitAssetId: c.imageAssetId ?? null,
      hp,
      band: hp ? healthBand(hp.current, hp.max) : (c.band ?? "healthy"),
      ac: hp ? (c.card?.ac ?? null) : null,
      effects: effects.filter((e) => e.targetCombatantId === c.id),
      turn: c.id === turnId,
    });
  }
  const companions = pcs.flatMap((p) => {
    const g = groups.get(p.id);
    return g ? [{ ...g, rows: g.rows.sort(byName) }] : [];
  });
  return { pcs, companions };
}

/** `party-summary-hp` `data-value`: "cur/max", or the band for a band-only companion. */
export const summaryHpValue = (r: {
  hp: { current: number; max: number } | null;
  band: HealthBand;
}) => (r.hp ? hpValue(r.hp) : r.band);

/** FR-PARTY-54: the Tooltip of a row ("Thorn · HP 10 / 10 + 5 temp · AC 15 · Poisoned"). */
export function summaryTip(r: SummaryPc): string {
  const temp = r.temp > 0 ? ` + ${r.temp} temp` : "";
  const parts = [`${r.name}`, `HP ${r.hp.current} / ${r.hp.max}${temp}`, `AC ${r.ac}`];
  const names = r.effects.map((e) => effectName(e));
  if (names.length > 0) parts.push(names.join(", "));
  return parts.join(" · ");
}
