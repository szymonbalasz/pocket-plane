// CHARX sheet view model (CHARX §7): picker groups, edit rights, summary card, skill / passive /
// spell / counter rows, override markers, wallet line. Pure; derived values from
// `@shared/entities` (overrides honoured), never computed twice.
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import { hitDieMax, leftText, slotMax } from "@shared/character-sheet/counters";
import { levelLine, signed, withDamageBonus } from "@shared/character-sheet/logic";
import type { SheetRollKind } from "@shared/character-sheet/schemas";
import {
  type CreatureSheetRecord,
  defaultSheetData,
  FEATURE_OVERSPEND_MAX,
  type SheetData,
  type SpellRow,
} from "@shared/character-sheet/sheet";
import {
  ABILITY_NAMES,
  type Ability,
  type AbilityStats,
  ATTACK_BONUS_MAX,
  type Attack,
  abilityMod,
  type ClassRow,
  DAMAGE_TYPES,
  EXTRA_DAMAGE_MAX,
  EXTRA_DAMAGE_RE,
  ExtraDamage,
  HIT_DICE,
  type HitDie,
  isOverridden,
  type OverrideKey,
  PASSIVE_SKILLS,
  type PassiveSkill,
  passiveScore,
  proficiencyBonus,
  type Senses,
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

/**
 * FR-CHAR-04 / FR-CHARX-47: the character the sheet shows: the selection while it is a picker
 * option, else the first own one (null = none). FR-DICE-77's roll bar follows the same rule.
 */
export function shownSheetId(
  options: readonly PickerOption[],
  selectedId: string | null,
): string | null {
  const hit = options.find((o) => o.id === selectedId) ?? options.find((o) => o.group === "own");
  return hit?.id ?? null;
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

/** FR-CHARX-113: a breakdown key: an override key, or the two stored numbers of the stat row. */
export type BreakdownKey = OverrideKey | "ac" | "init";

const PROF_WORD: Readonly<Record<SkillProficiency, string>> = {
  proficient: "proficiency",
  expertise: "expertise",
};

/**
 * FR-CHARX-113: the breakdown Tooltip of one number on Main, from the derivation's own terms:
 * "Stealth +10 · DEX +4 · expertise +6", "Dexterity save +4 · DEX +4", "Passive Perception 15 ·
 * 10 + Perception +5". An overridden number reads "Name value · Derived … · Override: …"
 * (`overrideTooltip`). AC and Initiative are stored, so their value alone. Null when the number
 * isn't on this sheet (no scores, no spellcasting).
 */
export function breakdownText(
  stats: AbilityStats & { ac?: number; initBonus?: number },
  key: BreakdownKey,
): string | null {
  if (key === "ac") return stats.ac === undefined ? null : `Armor Class ${stats.ac}`;
  if (key === "init")
    return stats.initBonus === undefined ? null : `Initiative ${signed(stats.initBonus)}`;
  const value = sheetValue(stats, key);
  if (value === null) return null;
  const plain = key === "spellDc" || key.startsWith("passive.");
  const head = `${breakdownName(key)} ${plain ? value : signed(value)}`;
  const over = overrideTooltip(stats, key);
  if (over) return `${head} · ${over}`;
  const pb = proficiencyBonus(stats);
  const mod = (a: Ability) =>
    `${a.toUpperCase()} ${signed(abilityMod(stats.abilities?.[a] ?? 10))}`;
  const [group, name] = key.split(".") as [string, string];
  const terms: string[] = [];
  if (key === "proficiency")
    terms.push("level" in stats ? `level ${stats.level}` : `CR ${stats.cr}`);
  else if (key === "spellAttack" || key === "spellDc") {
    const a = stats.spellcasting?.ability ?? "wis";
    if (key === "spellDc") terms.push("8");
    terms.push(`proficiency ${signed(pb)}`, mod(a));
  } else if (group === "check") {
    terms.push(mod(name as Ability), `score ${stats.abilities?.[name as Ability]}`);
  } else if (group === "save") {
    terms.push(mod(name as Ability));
    if (stats.saveProficiencies?.includes(name as Ability)) terms.push(`proficiency ${signed(pb)}`);
  } else if (group === "skill") {
    const p = stats.skills?.[name as Skill];
    terms.push(mod(SKILL_ABILITY[name as Skill]));
    if (p) terms.push(`${PROF_WORD[p]} ${signed(pb * (p === "expertise" ? 2 : 1))}`);
  } else {
    const bonus = sheetValue(stats, `skill.${name as PassiveSkill}`) ?? 0;
    terms.push(`10 + ${SKILL_NAMES[name as PassiveSkill]} ${signed(bonus)}`);
  }
  return [head, ...terms].join(" · ");
}

function breakdownName(key: OverrideKey): string {
  if (key === "proficiency") return "Proficiency";
  if (key === "spellAttack") return "Spell attack";
  if (key === "spellDc") return "Spell save DC";
  const [group, name] = key.split(".") as [string, string];
  if (group === "check") return `${ABILITY_NAMES[name as Ability]} check`;
  if (group === "save") return `${ABILITY_NAMES[name as Ability]} save`;
  if (group === "skill") return SKILL_NAMES[name as Skill];
  return `Passive ${SKILL_NAMES[name as PassiveSkill]}`;
}

/** FR-CHARX-115: which tab-strip arrows show (an end with hidden tabs); 1 px of rounding slack. */
export function tabArrows(
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number,
): { prev: boolean; next: boolean } {
  const max = scrollWidth - clientWidth;
  if (max <= 1) return { prev: false, next: false };
  return { prev: scrollLeft > 1, next: scrollLeft < max - 1 };
}

/**
 * FR-CHARX-115: how far a wheel turn scrolls the tab strip sideways; null = leave it to the
 * browser (a sideways gesture already, or nothing to scroll).
 */
export function wheelScroll(deltaX: number, deltaY: number, overflows: boolean): number | null {
  if (!overflows || Math.abs(deltaY) <= Math.abs(deltaX)) return null;
  return deltaY;
}

/** FR-CHARX-115: one arrow press scrolls the strip this far. */
export const TAB_ARROW_STEP_PX = 120;

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
/**
 * FR-CHARX-56: an attack row in view mode: name + "+1" Badge (bonus > 0); numbers with the bonus
 * folded in, one chunk per part so the line wraps between parts ("+8 · 2d6+5 slashing",
 * "+ 2d6 fire").
 */
export interface AttackRowView {
  name: string;
  badge: string | null;
  parts: string[];
}

export function attackRowView(a: Attack): AttackRowView {
  const bonus = a.bonus ?? 0;
  const base = withDamageBonus(a.damage, bonus);
  return {
    name: a.name,
    badge: bonus > 0 ? `+${bonus}` : null,
    parts: [
      `${signed(a.toHit + bonus)} · ${a.damageType ? `${base} ${a.damageType}` : base}`,
      ...(a.extraDamage ?? []).map((x) => `+ ${x.damage} ${x.type}`),
    ],
  };
}

/** FR-CHARX-56: the Magic Select (none, +1 … +3). */
export const MAGIC_OPTIONS = Array.from({ length: ATTACK_BONUS_MAX + 1 }, (_, n) => ({
  value: n,
  label: n === 0 ? "No magic" : `Magic +${n}`,
}));

/** FR-CHARX-56: "Add damage type" only while the row has fewer than two extra parts. */
export const canAddExtraPart = (a: Pick<Attack, "extraDamage">): boolean =>
  (a.extraDamage?.length ?? 0) < EXTRA_DAMAGE_MAX;

export const EXTRA_DICE_HINT = "Use NdM+K: up to 6d12+10";
export const EXTRA_TYPE_HINT = "Pick a damage type";

/** An extra part as typed in the editor (dice text, type or none yet). */
export interface ExtraPartDraft {
  damage: string;
  type: string | null;
}

/**
 * FR-CHARX-56: the client mirror of FR-CHARX-54 for one extra part: the part to store, or the
 * inline error ("7d6" → dice hint; no type → type hint). Nothing is sent while it errors.
 */
export function extraPart(d: ExtraPartDraft): { part: ExtraDamage } | { error: string } {
  const damage = d.damage.trim();
  if (!EXTRA_DAMAGE_RE.test(damage)) return { error: EXTRA_DICE_HINT };
  if (!d.type || !(DAMAGE_TYPES as readonly string[]).includes(d.type)) {
    return { error: EXTRA_TYPE_HINT };
  }
  return { part: ExtraDamage.parse({ damage, type: d.type }) };
}

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

/** FR-CHARX-48: what stays pinned: the whole header + tab strip, or name row + tab strip. */
export type PinnedPart = "full" | "compact";

/** Pixels the full header must shrink below half the body before compact turns full again. */
export const PIN_HYSTERESIS_PX = 16;

/**
 * FR-CHARX-48: the full header (name row, badges, buttons, picker, `header` sections) + tab
 * strip stay pinned while they take at most half the window body; else only the name row and
 * the tab strip ("compact"). `fullPx` is the full part's height wherever it currently sits.
 * The hysteresis keeps a scrollbar-width reflow from flipping it back and forth. Not measured
 * yet (body 0) → unchanged.
 */
export function pinnedPart(fullPx: number, bodyPx: number, current: PinnedPart): PinnedPart {
  if (bodyPx <= 0) return current;
  const room = bodyPx - (current === "compact" ? PIN_HYSTERESIS_PX : 0);
  return fullPx * 2 <= room ? "full" : "compact";
}

/** A pip click (CHARX §7): click = use one, Shift+click = restore one. */
export const pipDelta = (shiftKey: boolean) => (shiftKey ? -1 : 1);

/** FR-CHARX-58: a feature's uses left of max, "2 / 3 left", "−1 / 3 left" below zero. */
export const usesLeftText = (left: number, max: number) => `${leftText(left)} / ${max} left`;

/** FR-CHARX-58: the overspent Badge's Tooltip ("1 use more than the maximum — …"). */
export const overspentTip = (left: number) =>
  `${-left} ${left === -1 ? "use" : "uses"} more than the maximum — check with your DM`;

/**
 * FR-CHARX-58, MOD FR-MOD-59: the question before spending a use the row doesn't have (`left` ≤
 * 0): "No Rage uses left (0 / 3). Rage anyway? → −1 / 3" + the confirm label `‹verb› anyway`; at
 * the floor (−9) only "Rage is at −9 / 3 — reset it first", no confirm.
 */
export function overspendAsk(
  name: string,
  left: number,
  max: number,
  verb: string,
): { text: string; confirm: string | null } {
  if (left <= -FEATURE_OVERSPEND_MAX) {
    return { text: `${name} is at ${leftText(left)} / ${max} — reset it first`, confirm: null };
  }
  return {
    text: `No ${name} uses left (${leftText(left)} / ${max}). ${verb} anyway? → ${leftText(left - 1)} / ${max}`,
    confirm: `${verb} anyway`,
  };
}

/** FR-CHARX-33: the read-only wallet line; missing record = all zero. */
export function walletLine(w: Coins | undefined): string {
  return (w && formatCoins(w)) || "0 gp";
}

/**
 * FR-CHARX-49 (sprint 4, OQ-FOG-51): absent senses = Normal vision (no `visionFt`, 999 ft),
 * darkvision 0, both switches off.
 */
export const NORMAL_SENSES: Senses = { darkvisionFt: 0, seesMagicalDarkness: false };
/** Stored 0 / 0: no vision at all (sprint 3's default). */
export const NO_SENSES: Senses = { visionFt: 0, darkvisionFt: 0, seesMagicalDarkness: false };

/**
 * FR-CHARX-50 / -53: the Senses line's parts. Vision first (sprint 4): absent "Vision normal", a
 * stored value "Vision 30 ft", a stored 0 "No vision"; zero / false other parts omitted.
 */
export function sensesParts(senses: Senses | undefined): string[] {
  const s = senses ?? NORMAL_SENSES;
  const vision =
    s.visionFt === undefined
      ? "Vision normal"
      : s.visionFt > 0
        ? `Vision ${s.visionFt} ft`
        : "No vision";
  return [
    vision,
    s.darkvisionFt > 0 ? `Darkvision ${s.darkvisionFt} ft` : null,
    s.seesMagicalDarkness ? "Sees through magical darkness" : null,
    s.seesInvisible ? "Sees invisible" : null,
  ].filter((p): p is string => p !== null);
}

/** The line after "Senses": parts joined by " · " (vision is always there, sprint 4). */
export const sensesText = (senses: Senses | undefined): string => sensesParts(senses).join(" · ");

/**
 * The whole `senses` object for `char.edit` (FR-CHARX-49): the shown value with `patch` applied;
 * `visionFt: undefined` in the patch = Normal (the key is omitted, clearing a stored value). A
 * player never sends `seesInvisible` (absent = the stored value; changing it is DM only,
 * FR-CHARX-53).
 */
export function sensesEdit(
  senses: Senses | undefined,
  patch: Partial<Senses>,
  client: "dm" | "player",
): Senses {
  const { seesInvisible, visionFt, ...rest } = { ...NORMAL_SENSES, ...senses, ...patch };
  const out: Senses = visionFt === undefined ? rest : { visionFt, ...rest };
  return client === "dm" ? { ...out, seesInvisible: seesInvisible ?? false } : out;
}
