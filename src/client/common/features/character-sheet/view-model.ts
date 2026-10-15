// CHARX sheet view model (CHARX §7): picker groups, edit rights, summary card, skill / passive /
// spell / counter rows, override markers, wallet line. Pure; derived values from
// `@shared/entities` (overrides honoured), never computed twice.
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import { hitDieMax, slotMax } from "@shared/character-sheet/counters";
import { levelLine, signed } from "@shared/character-sheet/logic";
import type { SheetRollKind } from "@shared/character-sheet/schemas";
import {
  type CreatureSheetRecord,
  defaultSheetData,
  type SheetData,
  type SpellRow,
} from "@shared/character-sheet/sheet";
import {
  type AbilityStats,
  type ClassRow,
  HIT_DICE,
  type HitDie,
  isOverridden,
  type OverrideKey,
  PASSIVE_SKILLS,
  type PassiveSkill,
  passiveScore,
  SKILL_ABILITY,
  SKILL_NAMES,
  SKILLS,
  type Skill,
  type SkillProficiency,
  SPELL_LEVELS,
  type Spellcasting,
  type SpellLevelKey,
  sheetValue,
  skillBonus,
  withoutOverride,
  xpForCr,
} from "@shared/entities/schemas";
import { formatCoins } from "@shared/party-loot/format";
import type { Coins } from "@shared/party-loot/schemas";

export interface Viewer {
  role: "dm" | "player";
  playerId: string | null;
}

/** Any creature the sheet can show: a full record (statBlock present) or a redacted PC. */
export interface CreatureLike {
  id: string;
  kind: string;
  name: string;
  ownerPlayerId: string | null;
  campaignId?: string | null;
  statBlock?: unknown;
}

/** FR-CHARX-02: a missing row reads as defaults (ready, unlocked, empty). */
export function sheetData(sheet: CreatureSheetRecord | undefined): SheetData {
  return sheet ?? defaultSheetData();
}

/** CHARX §10: imported never; DM any character or custom monster; owner while unlocked. */
export function canEdit(
  v: Viewer,
  c: CreatureLike,
  sheet: Pick<SheetData, "locked"> | undefined,
): boolean {
  if (c.campaignId === null || c.statBlock === undefined) return false;
  if (v.role === "dm") return true;
  return c.kind === "character" && c.ownerPlayerId === v.playerId && !sheet?.locked;
}

/** Counters and HP (FR-CHARX-17): DM any character, owner also locked. */
export const canUseCounters = (v: Viewer, c: CreatureLike) =>
  c.kind === "character" && (v.role === "dm" || c.ownerPlayerId === v.playerId);

export interface PickerOption {
  id: string;
  label: string;
  group: "own" | "party" | "npc";
}

const byName = <T extends { id: string; name: string }>(a: T, b: T) => {
  const ka = a.name.toLowerCase();
  const kb = b.name.toLowerCase();
  if (ka !== kb) return ka < kb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/**
 * FR-CHARX-29: player = own characters, then a "Party" group of other PCs (summary); DM = every
 * character (owner name, Draft / Locked marks), then the NPC last opened. `canCreate`: the DM
 * always, a player while they have no open draft.
 */
export function pickerModel(
  entities: readonly CreatureLike[],
  sheets: Readonly<Record<string, CreatureSheetRecord | undefined>>,
  v: Viewer,
  players: readonly Pick<PlayerRecord, "id" | "name">[],
  npc: CreatureLike | null,
): { options: PickerOption[]; canCreate: boolean } {
  const chars = entities.filter((e) => e.kind === "character").sort(byName);
  const ownerName = (id: string | null) => players.find((p) => p.id === id)?.name;
  const marks = (id: string) => {
    const s = sheets[id];
    return [s?.status === "draft" ? "Draft" : null, s?.locked ? "Locked" : null].filter(Boolean);
  };
  const label = (e: CreatureLike) => {
    const owner = v.role === "dm" ? ownerName(e.ownerPlayerId) : undefined;
    return [owner ? `${e.name} (${owner})` : e.name, ...marks(e.id)].join(" · ");
  };
  const own = chars.filter(
    (e) => e.statBlock !== undefined && (v.role === "dm" || e.ownerPlayerId === v.playerId),
  );
  const options: PickerOption[] = own.map((e) => ({ id: e.id, label: label(e), group: "own" }));
  if (v.role === "player") {
    for (const e of chars) {
      if (e.ownerPlayerId === v.playerId) continue;
      const owner = ownerName(e.ownerPlayerId);
      options.push({ id: e.id, label: owner ? `${e.name} (${owner})` : e.name, group: "party" });
    }
  }
  if (v.role === "dm" && npc)
    options.push({ id: npc.id, label: `${npc.name} (NPC)`, group: "npc" });
  const openDraft = own.some((e) => sheets[e.id]?.status === "draft");
  return { options, canCreate: v.role === "dm" || !openDraft };
}

/** The redacted PC other players get (FR-CHARX-35); fields optional for older servers. */
export interface SummaryInput {
  id: string;
  name: string;
  portraitAssetId: string | null;
  ownerPlayerId: string;
  down?: boolean;
  level?: number;
  className?: string;
  species?: string | null;
  deathState?: "dying" | "stable" | "dead" | null;
}

/** FR-CHARX-32: portrait, name, owner, "Level N Class", species, Down / death state. */
export function summaryCard(
  e: SummaryInput,
  players: readonly Pick<PlayerRecord, "id" | "name">[],
) {
  const status =
    e.deathState === "dead"
      ? "Dead"
      : e.deathState === "stable"
        ? "Stable"
        : e.deathState === "dying" || e.down
          ? "Down"
          : null;
  return {
    name: e.name,
    owner: players.find((p) => p.id === e.ownerPlayerId)?.name ?? null,
    level: e.level === undefined ? null : levelLine(e.level, e.className ?? ""),
    species: e.species?.trim() ? e.species : null,
    status,
  };
}

/** "CR 1/2 · 100 XP" for an NPC sheet (FR-CHARX-31). */
export const crLine = (cr: string) => `CR ${cr} · ${xpForCr(cr)} XP`;

export interface SkillRowView {
  skill: Skill;
  name: string;
  abbr: string;
  proficiency: SkillProficiency | null;
  bonus: number;
  overridden: boolean;
}

/** FR-CHARX-05: the 18 skill rows; null without ability scores. */
export function skillRows(stats: AbilityStats): SkillRowView[] | null {
  if (!stats.abilities) return null;
  return SKILLS.map((skill) => ({
    skill,
    name: SKILL_NAMES[skill],
    abbr: SKILL_ABILITY[skill].toUpperCase(),
    proficiency: stats.skills?.[skill] ?? null,
    bonus: skillBonus(stats, skill) as number,
    overridden: isOverridden(stats, `skill.${skill}`),
  }));
}

export interface PassiveView {
  skill: PassiveSkill;
  name: string;
  value: number;
  overridden: boolean;
}

export function passives(stats: AbilityStats): PassiveView[] {
  if (!stats.abilities) return [];
  return PASSIVE_SKILLS.map((skill) => ({
    skill,
    name: `Passive ${SKILL_NAMES[skill]}`,
    value: passiveScore(stats, skill) as number,
    overridden: isOverridden(stats, `passive.${skill}`),
  }));
}

/** Next skill proficiency in edit mode: none → proficient → expertise → none. */
export function nextProficiency(p: SkillProficiency | null): SkillProficiency | null {
  if (p === null) return "proficient";
  return p === "proficient" ? "expertise" : null;
}

/** `skills` with one skill changed (absent = none). */
export function withSkill(
  skills: Partial<Record<Skill, SkillProficiency>> | undefined,
  skill: Skill,
  p: SkillProficiency | null,
): Partial<Record<Skill, SkillProficiency>> {
  const out = { ...(skills ?? {}) };
  if (p === null) delete out[skill];
  else out[skill] = p;
  return out;
}

/**
 * FR-CHARX-06, CHARX §7: Tooltip on an overridden number, e.g. "Derived +7 · Override: Test".
 * Null when the key is not overridden. `dc` keys show plain numbers.
 */
export function overrideTooltip(stats: AbilityStats, key: OverrideKey): string | null {
  const o = stats.overrides?.[key];
  if (!o) return null;
  const derived = sheetValue(withoutOverride(stats, key), key);
  const fmt = (n: number | null) =>
    n === null ? "—" : key === "spellDc" || key.startsWith("passive.") ? String(n) : signed(n);
  return `Derived ${fmt(derived)} · Override${o.note ? `: ${o.note}` : ` ${fmt(o.value)}`}`;
}

/** Spells by level, cantrips first; row order kept inside a level (CHARX §7 Actions). */
export function spellGroups(spells: readonly SpellRow[]): { level: number; spells: SpellRow[] }[] {
  const out: { level: number; spells: SpellRow[] }[] = [];
  for (let level = 0; level <= 9; level++) {
    const rows = spells.filter((s) => s.level === level);
    if (rows.length) out.push({ level, spells: rows });
  }
  return out;
}

export const spellLevelLabel = (level: number) => (level === 0 ? "Cantrips" : `Level ${level}`);

/** One roll button of an attack or spell row (CHARX §6.1, N7). */
export interface RowRollButton {
  kind: SheetRollKind;
  label: string;
  testId: string;
}

/**
 * FR-CHARX-41 (§6.1): every attack row shows Attack (to-hit only), Damage, Attack + damage, in
 * that order. The same on DM and player, PC and NPC sheets.
 */
export function attackButtons(): RowRollButton[] {
  return [
    { kind: "toHit", label: "Attack", testId: "charx-roll-attack" },
    { kind: "damage", label: "Damage", testId: "charx-roll-damage" },
    { kind: "attack", label: "Attack + damage", testId: "charx-roll-attack-damage" },
  ];
}

/**
 * FR-CHARX-41 (§6.1) for a spell row: Attack iff `roll: attack`; Damage ("Healing" for
 * `effect: healing`) iff it has damage (any `roll`); Attack + damage iff both. Same order.
 */
export function spellButtons(s: Pick<SpellRow, "roll" | "damage" | "effect">): RowRollButton[] {
  const attack = s.roll === "attack";
  const out: RowRollButton[] = [];
  if (attack) out.push({ kind: "spellToHit", label: "Attack", testId: "charx-roll-spell-attack" });
  if (s.damage) {
    const label = s.effect === "healing" ? "Healing" : "Damage";
    out.push({ kind: "spellDamage", label, testId: "charx-roll-spell-damage" });
  }
  if (attack && s.damage) {
    out.push({
      kind: "spellAttack",
      label: "Attack + damage",
      testId: "charx-roll-spell-attack-damage",
    });
  }
  return out;
}

/** Slot pips per level with max > 0 (CHARX §7). */
export function slotPips(
  stats: { spellcasting?: Spellcasting },
  sheet: Pick<SheetData, "slotsUsed">,
): { level: SpellLevelKey; max: number; used: number }[] {
  return SPELL_LEVELS.map((level) => ({
    level,
    max: slotMax(stats, level),
    used: sheet.slotsUsed[level] ?? 0,
  })).filter((p) => p.max > 0);
}

/** Hit dice per die size with levels (FR-CHARX-05); none without classes. */
export function hitDicePips(
  stats: { classes?: readonly ClassRow[] },
  sheet: Pick<SheetData, "hitDiceUsed">,
): { die: HitDie; max: number; used: number }[] {
  return HIT_DICE.map((die) => ({
    die,
    max: hitDieMax(stats, die),
    used: sheet.hitDiceUsed[die] ?? 0,
  })).filter((p) => p.max > 0);
}

/**
 * FR-CHARX-48: the header + tab strip stay pinned unless they would take more than half the
 * window body (then everything scrolls together). Not measured yet (0) → pinned.
 */
export function headerPinned(headerPx: number, bodyPx: number): boolean {
  return bodyPx <= 0 || headerPx * 2 <= bodyPx;
}

/** A pip click (CHARX §7): click = use one, Shift+click = restore one. */
export const pipDelta = (shiftKey: boolean) => (shiftKey ? -1 : 1);

/** FR-CHARX-33: the read-only wallet line; missing record = all zero. */
export function walletLine(w: Coins | undefined): string {
  return (w && formatCoins(w)) || "0 gp";
}
