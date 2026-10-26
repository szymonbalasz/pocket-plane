// Pure combat-extras reads over the synced store, both clients (CBTX §7). No feature logic: the
// server decides; clients render what they receive (players: the redaction, FR-CBTX-31/32).
import { deathStateOf, effectName, roundsLeft } from "@shared/combat-extras/rules";
import { EFFECT_TYPE, type EffectView } from "@shared/combat-extras/schemas";
import { COMBATANT_TYPE, type CombatantView } from "@shared/combat-tracker/schemas";
import { matchingMods } from "@shared/effect-modifiers/rules";
import { type DeathState, ENTITY_TYPE } from "@shared/entities/schemas";
import type { RecordStore } from "@shared/protocol/store";

/** A creature in the store: a monster's combatant or a PC's character. */
export type CreatureRef = { combatantId: string } | { characterId: string };

export const creatureOf = (c: Pick<CombatantView, "id" | "kind" | "entityId">): CreatureRef =>
  c.kind === "pc" && c.entityId ? { characterId: c.entityId } : { combatantId: c.id };

/** Active effects the viewer holds, oldest first (players never receive ended ones). */
export function activeEffects(store: RecordStore): EffectView[] {
  return (Object.values(store.records[EFFECT_TYPE] ?? {}) as EffectView[])
    .filter((e) => !e.endedAt)
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || (a.id < b.id ? -1 : 1));
}

export function effectsOn(effects: readonly EffectView[], ref: CreatureRef): EffectView[] {
  return effects.filter((e) =>
    "combatantId" in ref
      ? e.targetCombatantId === ref.combatantId
      : e.targetCharacterId === ref.characterId,
  );
}

/** Concentration first, then conditions, then custom, each oldest first. */
const KIND_ORDER = { concentration: 0, condition: 1, custom: 2 } as const;
export const chipOrder = (effects: readonly EffectView[]) =>
  [...effects].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);

/** Chip text: "Frightened", "Exhaustion 2", "Bless 3r", "Concentrating: Bless 10r". */
export function chipText(e: EffectView, round: number | null): string {
  const left = e.endsRound != null && round !== null ? ` ${roundsLeft(e.endsRound, round)}r` : "";
  return `${effectName(e)}${left}`;
}

/**
 * FR-CBTX-46 (G1) compact Initiative-row label: concentration = its label ("Bless"; the icon and
 * the Tooltip say "Concentrating"), condition = its name ("Exh 2" for exhaustion), custom = label
 * + "3r".
 */
export function chipLabel(e: EffectView, round: number | null): string {
  const { label, rounds } = chipParts(e, round);
  return rounds === null ? label : `${label} ${rounds}r`;
}

/** `chipLabel` in two parts, so a tight chip cuts the label and keeps the rounds (BL-08). */
export function chipParts(
  e: EffectView,
  round: number | null,
): { label: string; rounds: number | null } {
  if (e.kind === "concentration") return { label: e.label ?? "", rounds: null };
  if (e.kind === "condition") {
    return {
      label: e.condition === "exhaustion" ? `Exh ${e.level ?? 1}` : effectName(e),
      rounds: null,
    };
  }
  const rounds = e.endsRound != null && round !== null ? roundsLeft(e.endsRound, round) : null;
  return { label: effectName(e), rounds };
}

/**
 * One Initiative-row effect chip at most this wide, px; longer labels end in an ellipsis. Not
 * trigger chips: whole or icon-only (FR-CBTX-58).
 */
export const CHIP_MAX_W = 96;
/** Width kept for the "+N" chip when some chips don't fit, px. */
export const MORE_W = 30;

/**
 * FR-CBTX-46: how many whole chips fit `room` (the name line's width left after the full name),
 * in order; all fit → all, else as many as leave room for "+N". `gap` between chips.
 */
export function fitChips(widths: readonly number[], room: number, gap = 2): number {
  const end = (n: number) =>
    widths.slice(0, n).reduce((s, w) => s + w, 0) + Math.max(0, n - 1) * gap;
  if (end(widths.length) <= room) return widths.length;
  let n = 0;
  while (n < widths.length && end(n + 1) + gap + MORE_W <= room) n++;
  return n;
}

/**
 * BL-08: tighter Initiative-row chips before "+N". Tier 0 = FR-CBTX-46's compact chip (≤ 96 px);
 * tier 1 cuts long labels (ellipsis) at 72 px and keeps "3r"; tier 2 also drops the unit ("3")
 * at 60 px. One tier per row.
 */
export const CHIP_TIERS = [
  { cap: CHIP_MAX_W, unit: true },
  { cap: 72, unit: true },
  { cap: 60, unit: false },
] as const;

/** A chip's natural widths, px: `full` with "3r", `short` with "3" (equal when untimed). */
export interface ChipWidths {
  full: number;
  short: number;
}

export const tierWidths = (chips: readonly ChipWidths[], tier: number): number[] => {
  const t = CHIP_TIERS[tier] ?? CHIP_TIERS[0];
  return chips.map((c) => Math.min(t.unit ? c.full : c.short, t.cap));
};

/**
 * BL-08 fit rule: the first tier at which every chip fits `room`; when none does, the first tier
 * showing the most whole chips (then "+N", `fitChips`).
 */
export function fitChipTiers(
  chips: readonly ChipWidths[],
  room: number,
  gap = 2,
): { n: number; tier: number } {
  let best = { n: -1, tier: 0 };
  for (let tier = 0; tier < CHIP_TIERS.length; tier++) {
    const n = fitChips(tierWidths(chips, tier), room, gap);
    if (n === chips.length) return { n, tier };
    if (n > best.n) best = { n, tier };
  }
  return best;
}

/** `fitChipRow`'s pick: `n` effect chips shown at `tier`, the rest in "+N" (triggers never). */
export interface ChipRowFit {
  n: number;
  tier: number;
  /** Trigger chips icon-only (⚡ + uses). */
  icons: boolean;
  /** Even icon-only with every effect folded the triggers don't fit: a second line. */
  wrap: boolean;
}

/**
 * FR-CBTX-54 (OQ-CBTX-27 B, BL-26): a compact row's effect chips (`ChipWidths` per BL-08 tier)
 * then its trigger chips (`full` = name, `short` = icon-only) in `room`. In order: (1) effect
 * chips tighten (`fitChipTiers`) next to full trigger chips; (2) trigger chips go icon-only;
 * (3) effect chips fold into "+N", last first; (4) a trigger never folds: the row wraps.
 * `nameCut`: the name beside the chips is cut (the chip line holds its minimum width, e.g. after a
 * hidden row's eye-off icon): the chips take the second line too, so the name is never cut (#182).
 */
export function fitChipRow(
  effects: readonly ChipWidths[],
  triggers: readonly ChipWidths[],
  room: number,
  gap = 2,
  nameCut = false,
): ChipRowFit {
  if (nameCut && effects.length + triggers.length > 0) {
    return { n: 0, tier: 0, icons: triggers.length > 0, wrap: true };
  }
  // The room the trigger chips take after the effect chips (or "+N"), gap included.
  const after = (ws: readonly number[]) =>
    ws.length === 0
      ? 0
      : ws.reduce((s, w) => s + w, 0) + (ws.length - 1) * gap + (effects.length > 0 ? gap : 0);
  if (triggers.length === 0)
    return { ...fitChipTiers(effects, room, gap), icons: false, wrap: false };
  const fullRoom = room - after(triggers.map((t) => t.full));
  const full = fitChipTiers(effects, fullRoom, gap);
  if (fullRoom >= 0 && full.n === effects.length) return { ...full, icons: false, wrap: false };
  const iconRoom = room - after(triggers.map((t) => t.short));
  const icon = fitChipTiers(effects, iconRoom, gap);
  const fits = icon.n === effects.length ? iconRoom >= 0 : icon.n > 0 || MORE_W <= iconRoom;
  return fits ? { ...icon, icons: true, wrap: false } : { n: 0, tier: 0, icons: true, wrap: true };
}

/** An Initiative row's name line at natural widths, px (FR-CBTX-57). */
export interface NameLineWidths {
  line: number;
  name: number;
  /** The name's longest word; absent = the name is one word (its width is `name`). */
  word?: number;
  /** Beside the name, never moved: the hidden eye-off, the skip icon. */
  marks: readonly number[];
  /** The side chip (Ally / Enemy, never folds); 0 = none. */
  side: number;
  /** The Moved cell while it shares the line; 0 = none. */
  end: number;
  /** The row has effect or trigger chips. */
  chips: boolean;
}

/** `fitNameLine`'s pick. */
export interface NameLineFit {
  /**
   * The name wraps onto two lines (no "…"), between words, and inside a word only when that word
   * is wider than the line: the name alone is wider than the line, or it fits but not with its
   * marks while its longest word does (the marks stay beside it, FR-CBTX-57).
   */
  nameWrap: boolean;
  /**
   * The name fits but not with its marks, and neither does its longest word: the marks leave the
   * name's line (to the next one, before the side chip), so a word that fits on its own line never
   * breaks (sprint 6 CP2, note 3).
   */
  marksWrap: boolean;
  /** The side chip and every chip take a second line under the name. */
  split: boolean;
  /** The chips' room (FR-CBTX-54's steps run against it); 0 without chips. */
  room: number;
}

/**
 * FR-CBTX-57 (BL-43): the room for chips on the name line = the line − the name's natural width −
 * the fixed parts on it (marks, side chip, Moved) − the gaps. If the name and its fixed parts
 * don't fit with at least a "+N" chip's room, the side chip and the chips move to a second line
 * (the marks stay beside the name), where the chips get the line after the side chip (and after
 * Moved too when the name wraps: Moved then follows the chips). A name wider than the line wraps; a
 * name that fits but not with its marks wraps between words when its longest word and the marks
 * fit (T3, 2026-10-26: "Goblin Lurker" exactly filling its line under Gilt & Stone), else it keeps
 * its line and the marks move down.
 */
export function fitNameLine(w: NameLineWidths, gap = 4): NameLineFit {
  const head = w.name + w.marks.reduce((s, m) => s + gap + m, 0);
  const side = w.side > 0 ? w.side + gap : 0;
  const end = w.end > 0 ? w.end + gap : 0;
  const markW = head - w.name;
  const tooWide = w.name > w.line;
  // Fits alone but not with its marks: break between words if the longest word keeps them beside.
  const crowded = !tooWide && head > w.line;
  const nameWrap = tooWide || (crowded && (w.word ?? w.name) + markW <= w.line);
  const marksWrap = crowded && !nameWrap;
  const room = w.line - head - side - end - gap;
  const moves = w.side > 0 || w.chips;
  const split =
    moves && (nameWrap || marksWrap || head + side + end > w.line || (w.chips && room < MORE_W));
  if (!w.chips) return { nameWrap, marksWrap, split, room: 0 };
  // Marks moved down: they lead the second line, before the side chip.
  const marks = marksWrap ? markW : 0;
  const below = w.line - side - marks - (nameWrap ? end : 0);
  return { nameWrap, marksWrap, split, room: Math.max(0, split ? below : room) };
}

/** "N rounds left" (sheet chips). */
export function roundsLeftText(e: EffectView, round: number | null): string | null {
  if (e.endsRound == null || round === null) return null;
  const n = roundsLeft(e.endsRound, round);
  return `${n} round${n === 1 ? "" : "s"} left`;
}

interface CharacterView {
  id: string;
  name?: string;
  ownerPlayerId?: string;
  hpCurrent?: number;
  tempHp?: number;
  deathSuccesses?: number;
  deathFailures?: number;
  deathState?: DeathState | null;
  statBlock?: { hpMax?: number };
}

export function characterOf(store: RecordStore, id: string): CharacterView | undefined {
  return store.records[ENTITY_TYPE]?.[id] as CharacterView | undefined;
}

/**
 * FR-CBTX-19: from the counters when held (DM, owner), else the redacted `deathState` (other
 * players hold `hpCurrent` too since ADR-0063, but never the counters).
 */
export function deathStateFor(c: CharacterView | undefined): DeathState | null {
  if (!c) return null;
  if (typeof c.hpCurrent === "number" && typeof c.deathSuccesses === "number") {
    return deathStateOf(c.hpCurrent, c.deathSuccesses ?? 0, c.deathFailures ?? 0);
  }
  return c.deathState ?? null;
}

/** Counters when the viewer holds them (DM, owner). */
export function countersFor(c: CharacterView | undefined) {
  if (!c || typeof c.deathSuccesses !== "number" || typeof c.deathFailures !== "number") {
    return null;
  }
  return { successes: c.deathSuccesses, failures: c.deathFailures };
}

/** FR-CBTX-25 client copy: a PC whose character is dead skips turns. */
export function deadPc(store: RecordStore, c: Pick<CombatantView, "kind" | "entityId">): boolean {
  return (
    c.kind === "pc" && !!c.entityId && deathStateFor(characterOf(store, c.entityId)) === "dead"
  );
}

export const DEATH_LABEL: Record<DeathState, string> = {
  dying: "Dying",
  stable: "Stable",
  dead: "Dead",
};

/** "Goblin 2" → {base "Goblin", suffix " 2"}; no trailing number → suffix "". */
export function splitNumbered(name: string): { base: string; suffix: string } {
  const m = / \d+$/.exec(name);
  return m ? { base: name.slice(0, m.index), suffix: m[0] } : { base: name, suffix: "" };
}

/**
 * FR-CBTX-36 / FR-MOD-09 duration hint (P3 glitch 9): an effect ends at the start of its anchor's
 * turn in round N; anchor = the source, else the turn combatant, else each target's own (the
 * server's rule, FR-CBTX-05).
 */
export function endsHint(o: {
  sourceName: string | null;
  turnName: string | null;
  targetNames: readonly string[];
  endsRound: number;
}): string {
  const one = o.targetNames.length === 1 ? (o.targetNames[0] ?? null) : null;
  const who = o.sourceName ?? o.turnName ?? one;
  return who
    ? `Ends at the start of ${who}'s turn, round ${o.endsRound}`
    : `Ends at the start of each target's turn, round ${o.endsRound}`;
}

/**
 * FR-CBTX-42 dialog line (P3 glitch 9): "d20 + 4 + 1d4 Bless vs DC 10": the save bonus, then the
 * dice / flat parts of the creature's active effects a Constitution save picks up (FR-MOD-14,
 * what the server's roll hook adds; display only).
 */
export function concentrationSaveText(
  bonus: number,
  effects: readonly EffectView[],
  ref: CreatureRef,
  dc: number | null,
): string {
  const sign = (n: number) => (n < 0 ? "−" : "+");
  const parts = [`d20 ${sign(bonus)} ${Math.abs(bonus)}`];
  for (const { effect, modifier: m } of matchingMods(effects, ref, {
    roll: "save",
    ability: "con",
  })) {
    const label = effect.label ? ` ${effect.label}` : "";
    if (m.kind === "dice") parts.push(`${sign(m.sign)} ${m.dice}${label}`);
    else if (m.kind === "flat") parts.push(`${sign(m.value)} ${Math.abs(m.value)}${label}`);
  }
  return `${parts.join(" ")} vs DC ${dc ?? "?"}`;
}

/**
 * FR-CBTX-59 (sprint 7): the concentration chip's Tooltip, "Concentrating: Conjure Elemental ·
 * 10 rounds left" (untimed: no rounds).
 */
export function concTooltip(e: EffectView, round: number | null): string {
  const left = roundsLeftText(e, round);
  return left ? `${effectName(e)} · ${left}` : effectName(e);
}

/**
 * FR-CBTX-60 (OQ-CBTX-30 A): who gets the chip's menu: the DM, or the player who owns the
 * concentrating PC; anyone else (or a monster's concentration for a player) none.
 */
export function concMenuFor(store: RecordStore, e: EffectView): "dm" | "owner" | null {
  const you = store.you;
  if (you?.role === "dm") return "dm";
  if (!you?.playerId || !e.targetCharacterId) return null;
  return characterOf(store, e.targetCharacterId)?.ownerPlayerId === you.playerId ? "owner" : null;
}

/**
 * FR-CBTX-60: what ends with a concentration, from the viewer's store only: its linked effects
 * ("Bless on Mira", FR-CBTX-10) and linked summons ("Fire Elemental 3", FR-CBT-120). Players
 * receive neither link (FR-CBTX-31, FR-CBT-116), so for them it is empty.
 */
export function concEndsWith(store: RecordStore, e: EffectView): string[] {
  const combatants = Object.values(store.records[COMBATANT_TYPE] ?? {}) as (CombatantView & {
    concentrationEffectId?: string | null;
    active?: boolean;
  })[];
  const nameOf = (x: EffectView) =>
    x.targetCharacterId
      ? characterOf(store, x.targetCharacterId)?.name
      : combatants.find((c) => c.id === x.targetCombatantId)?.name;
  const linked = activeEffects(store)
    .filter((x) => x.id !== e.id && x.concentrationId === e.id)
    .map((x) => {
      const on = nameOf(x);
      return on ? `${effectName(x)} on ${on}` : effectName(x);
    });
  const summons = combatants
    .filter((c) => c.active !== false && c.concentrationEffectId === e.id)
    .sort((a, b) => ((a as { seq?: number }).seq ?? 0) - ((b as { seq?: number }).seq ?? 0))
    .map((c) => c.name);
  return [...linked, ...summons];
}
