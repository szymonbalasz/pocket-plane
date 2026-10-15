// Pure combat-extras reads over the synced store, both clients (CBTX §7). No feature logic: the
// server decides; clients render what they receive (players: the redaction, FR-CBTX-31/32).
import { deathStateOf, effectName, roundsLeft } from "@shared/combat-extras/rules";
import { EFFECT_TYPE, type EffectView } from "@shared/combat-extras/schemas";
import type { CombatantView } from "@shared/combat-tracker/schemas";
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
  if (e.kind === "concentration") return e.label ?? "";
  if (e.kind === "condition") {
    if (e.condition === "exhaustion") return `Exh ${e.level ?? 1}`;
    return effectName(e);
  }
  return chipText(e, round);
}

/** One Initiative-row chip at most this wide, px; longer labels end in an ellipsis. */
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

/** FR-CBTX-19: from the counters when held (DM, owner), else the redacted `deathState`. */
export function deathStateFor(c: CharacterView | undefined): DeathState | null {
  if (!c) return null;
  if (typeof c.hpCurrent === "number") {
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
