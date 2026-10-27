// Pure rows of the Party Manager's **Party status** tab (FR-PARTY-51–56, sprint 8 CB3; FR-PARTY-61,
// sprint 9 PM2): one row per player character the viewer receives (drafts out where the viewer
// holds the sheet), the viewer's own first, then by name (DM: by name); under each PC its
// companions (ADR-0056) in the companion row form (FR-PARTY-42): pets per FR-ENT-37 (DM and owner
// every pet, the DM's hidden one marked; another player's only while that player holds a visible
// combatant or token for it) and owned combatants of the started encounter (summons, charmed
// creatures; never a hidden / `ownerHidden` one); a companion whose owner PC has no row goes to
// "Other companions". Never an unowned or hostile creature. Reads only records the client already
// holds (FR-PARTY-55): `entity`, `combatant`, `encounter`, `effect`, `creature-sheet`, `token`,
// `scene`. No React.

import { levelLine } from "@shared/character-sheet/logic";
import { deathStateOf, effectName } from "@shared/combat-extras/rules";
import type { EffectView } from "@shared/combat-extras/schemas";
import { healthBand } from "@shared/combat-tracker/rules";
import {
  type DeathState,
  EntityRecord,
  type HealthBand,
  RedactedCharacter,
} from "@shared/entities/schemas";
import { type CompanionRow, type CompanionViewer, companionGroups, hpValue } from "./logic";

/** The retired `party.summary` window (FR-PARTY-64): absorbed by `party.board` (FR-SHELL-155). */
export const PARTY_SUMMARY_KIND = "party.summary";
export const EMPTY_PARTY = "No player characters yet";
/** FR-PARTY-61: companions whose owner PC has no row for this viewer. */
export const OTHER_COMPANIONS = "Other companions";
/** The mode Tooltip's owner name when the owner PC isn't held. */
export const OWNER_UNKNOWN = "(unknown)";
/** FR-CBTX-29's cap: ≤ 4 icons, then "+N". */
export const SUMMARY_ICONS_MAX = 4;

export interface SummaryPc {
  id: string;
  name: string;
  portraitAssetId: string | null;
  ownerPlayerId: string;
  /** FR-KIT-82: "Level 5 Fighter · Human" from the character record (no species: left out). */
  line: string;
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
  /** FR-PARTY-61: its companions, by name. */
  companions: SummaryCompanion[];
}

/** FR-PARTY-61: a companion in the Companions tab's row form (FR-PARTY-42) plus the marks. */
export interface SummaryCompanion extends CompanionRow {
  /** A pet entity (the DM's row menu) or an owned combatant (summon; no menu, FR-PARTY-62). */
  pet: boolean;
  /** DM: hidden from the other players right now (combatant hidden, or only hidden tokens). */
  hidden: boolean;
  effects: EffectView[];
  turn: boolean;
}

export interface PartySummary {
  pcs: SummaryPc[];
  /** FR-PARTY-61 "Other companions": owner PC not listed for this viewer, by name. */
  others: SummaryCompanion[];
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
  turnMode?: CompanionRow["turnMode"];
  hpCurrent?: number | null;
  hpMax?: number | null;
  band?: HealthBand;
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
  level: number;
  className: string;
  species: string | null;
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
    level: c.statBlock.level,
    className: c.statBlock.className,
    species: c.statBlock.species ?? null,
    hpCurrent: c.hpCurrent,
    hpMax: c.statBlock.hpMax,
    tempHp: c.tempHp,
    ac: c.statBlock.ac,
    deathState: deathStateOf(c.hpCurrent, c.deathSuccesses, c.deathFailures),
  };
}

/** FR-KIT-82: the card's second line, "Level 5 Fighter · Human" (the sheet's level line). */
export const pcLine = (c: { level: number; className: string; species: string | null }) =>
  [levelLine(c.level, c.className), c.species?.trim() || null].filter(Boolean).join(" · ");

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
  /** Tokens the viewer holds (players: visible ones of the active scene only). */
  tokens: readonly unknown[];
  /** Scenes the viewer holds (the DM's pet tokens count on the active one only). */
  scenes?: readonly unknown[];
}

interface TokenLike {
  sceneId?: string;
  definitionId?: string;
  characterId?: string | null;
  ownerPlayerId?: string | null;
  name?: string;
  hidden?: boolean;
}

/**
 * A pet's token as a player holds it: no `definitionId` (FR-MAP-26), so matched as a monster
 * token (no `characterId`) with the pet's owner and name; hidden tokens never reach a player.
 */
const holdsPetToken = (tokens: readonly unknown[], pet: { name: string; ownerPlayerId: string }) =>
  (tokens as readonly TokenLike[]).some(
    (t) => !t.characterId && t.ownerPlayerId === pet.ownerPlayerId && t.name === pet.name,
  );

/**
 * DM: a pet out of a fight is hidden from players while it has tokens on the active scene and
 * all of them are hidden (FR-ENT-37's presence, ADR-0056).
 */
function petTokensHidden(input: SummaryInput, petId: string): boolean {
  const scenes = (input.scenes ?? []) as readonly { id?: string; active?: boolean }[];
  const active = scenes.find((x) => x.active === true);
  const mine = (input.tokens as readonly TokenLike[]).filter(
    (t) => t.definitionId === petId && (!active || t.sceneId === active.id),
  );
  return mine.length > 0 && mine.every((t) => t.hidden === true);
}

/** FR-PARTY-51–53, -61: the Party status tab's rows for this viewer. */
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
      line: pcLine(c),
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
      companions: [],
    });
  }
  pcs.sort((a, b) => Number(b.own) - Number(a.own) || byName(a, b));

  // Companions: pets first resolve their combatant, then the other owned combatants (summons,
  // charmed creatures). Players hold no hidden companion combatant (ADR-0056).
  const byPc = new Map(pcs.map((p) => [p.id, p]));
  const others: SummaryCompanion[] = [];
  const add = (row: SummaryCompanion) => {
    const owner = byPc.get(row.ownerCharacterId);
    (owner ? owner.companions : others).push(row);
  };
  const claimed = new Set<string>();
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
      // Another player's pet: only while that player holds a visible combatant or token for it
      // (a hidden one is never sent; the pet row alone would tell them it is around). The DM and
      // the owner list every pet (FR-ENT-37); only the DM marks a hidden one.
      const notMine = !dm && row.ownerPlayerId !== viewer.playerId;
      if (notMine && !c && !holdsPetToken(input.tokens, row)) continue;
      const hidden =
        dm && (c ? c.hidden === true || c.ownerHidden === true : petTokensHidden(input, row.id));
      add({
        ...row,
        pet: true,
        hidden,
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
    add({
      id: c.id,
      name: c.name ?? "",
      portraitAssetId: c.imageAssetId ?? null,
      ownerCharacterId: c.ownerCharacterId,
      ownerPlayerId: c.ownerPlayerId,
      turnMode: c.turnMode ?? null,
      baseId: null,
      inCombat: true,
      hp,
      band: hp ? healthBand(hp.current, hp.max) : (c.band ?? "healthy"),
      card: numbers,
      record: null,
      pet: false,
      hidden: false,
      effects: effects.filter((e) => e.targetCombatantId === c.id),
      turn: c.id === turnId,
    });
  }
  for (const p of pcs) p.companions.sort(byName);
  return { pcs, others: others.sort(byName) };
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
