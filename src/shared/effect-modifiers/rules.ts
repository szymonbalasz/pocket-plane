// Pure effect-modifier rules shared by server and clients (FR-MOD-02, -04, -06, -11, -17, -18,
// -24, -25): which modifiers a roll picks up, a creature's active modifiers, toggle state, preset
// lists; tier 2: mode hints and the final mode, bonus-die groups, effective AC, defense presets.
import { type BuiltinPreset, builtinPresets } from "./presets";
import type {
  BuiltinPresetKey,
  EffectPresetRecord,
  Modifier,
  RollKind,
  RollSel,
  RollSubject,
} from "./schemas";

/** What a selector is matched against (a `RollSubject` without its creature). */
export type RollShape = Pick<RollSubject, "roll" | "ability" | "via">;

/**
 * FR-MOD-02: same roll kind; `abilities` (save / check) needs the roll's ability in the list (a
 * death save has none, so only selectors without `abilities` match it); `via` (attack / damage)
 * needs the same `via`. A skill check is a `check` of its ability; a concentration save a `con`
 * save; healing is never `damage` (callers pass no subject for it).
 */
export function matches(sel: RollSel | { roll: "ac" }, s: RollShape): boolean {
  if (sel.roll !== s.roll) return false;
  if ("abilities" in sel && sel.abilities) {
    if (s.ability === undefined || !sel.abilities.includes(s.ability)) return false;
  }
  if ("via" in sel && sel.via && sel.via !== s.via) return false;
  return true;
}

/** A creature: a character (PC) or a monster combatant (CBTX target ref). */
export type CreatureRef = { characterId: string } | { combatantId: string };

/** The effect fields the rules read; ended / seq are absent on players' redacted rows. */
export interface ModEffect {
  id: string;
  /** The part's label (tier 2 hints, AC parts, defense labels); absent → "". */
  label?: string | null;
  targetCharacterId: string | null;
  targetCombatantId: string | null;
  modifiers?: readonly Modifier[];
  endedAt?: string | null;
  seq?: number;
}

export interface ActiveMod<E extends ModEffect = ModEffect> {
  effect: E;
  modifier: Modifier;
  /** Index in the effect's list. */
  index: number;
}

/**
 * FR-MOD-04: modifiers of the creature's active effects (`endedAt` null): a PC → effects on the
 * character; a monster → effects on the combatant. Ordered by effect `seq` (input order where
 * absent), then index.
 */
export function activeMods<E extends ModEffect>(
  effects: readonly E[],
  creature: CreatureRef,
): ActiveMod<E>[] {
  const mine = effects
    .map((e, i) => ({ e, i }))
    .filter(({ e }) =>
      "characterId" in creature
        ? e.targetCharacterId === creature.characterId
        : e.targetCombatantId === creature.combatantId,
    )
    .filter(({ e }) => (e.endedAt ?? null) === null)
    .sort((a, b) => (a.e.seq ?? a.i) - (b.e.seq ?? b.i) || a.i - b.i);
  return mine.flatMap(({ e }) =>
    (e.modifiers ?? []).map((modifier, index) => ({ effect: e, modifier, index })),
  );
}

/** FR-MOD-14: the active modifiers a roll picks up. */
export const matchingMods = <E extends ModEffect>(
  effects: readonly E[],
  creature: CreatureRef,
  s: RollShape,
): ActiveMod<E>[] =>
  activeMods(effects, creature).filter(
    (m) => m.modifier.kind !== "defense" && matches(m.modifier.on, s),
  );

/**
 * FR-MOD-14: bonus dice of a `dice` part; doubled dice count on a crit's damage (5e). Flat
 * values never double.
 */
export function partDice(dice: string, s: { roll: RollKind; crit?: boolean }): string {
  if (!(s.crit && s.roll === "damage")) return dice;
  const [n, m] = dice.split("d");
  return `${Number(n) * 2}d${m}`;
}

/**
 * FR-MOD-11: a toggle is on iff its `activeEffectId` names an active effect (one ended by any
 * CBTX rule reads as off). `effects` = the store's (players' hold active ones only).
 */
export function toggleOn(
  preset: Pick<EffectPresetRecord, "activeEffectId">,
  effects: readonly Pick<ModEffect, "id" | "endedAt">[],
): boolean {
  const id = preset.activeEffectId;
  if (id === null) return false;
  return effects.some((e) => e.id === id && (e.endedAt ?? null) === null);
}

/** One entry of the DM's preset list (FR-MOD-06, -28). */
export type PresetChoice =
  | { source: "builtin"; key: BuiltinPresetKey; preset: BuiltinPreset }
  | { source: "customised"; key: BuiltinPresetKey; preset: EffectPresetRecord }
  | { source: "campaign"; key: null; preset: EffectPresetRecord };

/**
 * FR-MOD-06 / -28: built-ins in their order (a campaign row with that key replaces one, marked
 * "Customised"), then campaign presets by `seq`. Character presets are not listed.
 */
export function presetChoices(rows: readonly EffectPresetRecord[]): PresetChoice[] {
  const campaign = rows.filter((r) => r.characterId === null).sort((a, b) => a.seq - b.seq);
  const byKey = new Map(campaign.filter((r) => r.key !== null).map((r) => [r.key, r]));
  const out: PresetChoice[] = builtinPresets().map((b): PresetChoice => {
    const row = byKey.get(b.key);
    return row
      ? { source: "customised", key: b.key, preset: row }
      : { source: "builtin", key: b.key, preset: b };
  });
  for (const r of campaign)
    if (r.key === null) out.push({ source: "campaign", key: null, preset: r });
  return out;
}

/** A list entry's stable value: the built-in key (also when customised), else the preset id. */
export const choiceValue = (c: PresetChoice): string =>
  c.source === "campaign" ? c.preset.id : c.key;

/** The campaign row behind an entry (customised or campaign), else null (a plain built-in). */
export const choiceRowId = (c: PresetChoice): string | null =>
  c.source === "builtin" ? null : c.preset.id;

/** FR-MOD-17 (tier 2): one advantage / disadvantage source of a roll. */
export interface ModeHint<E extends ModEffect = ModEffect> {
  effect: E;
  mode: "advantage" | "disadvantage";
}

/**
 * FR-MOD-17: the creature's active `mode` modifiers matching the roll, one hint per modifier
 * (seq, index order). The server's `modes()` and the client's preview (R2) read the same list.
 */
export const modeHints = <E extends ModEffect>(
  effects: readonly E[],
  creature: CreatureRef,
  s: RollShape,
): ModeHint<E>[] =>
  matchingMods(effects, creature, s).flatMap(({ effect, modifier: m }) =>
    m.kind === "mode" ? [{ effect, mode: m.mode }] : [],
  );

export type FinalMode = "normal" | "advantage" | "disadvantage";

/**
 * FR-MOD-17 (5e): the roller's mode (Shift / Ctrl) combined with every hint: any advantage and
 * any disadvantage → normal; else the one present; none → normal.
 */
export function combineModes(
  roller: FinalMode,
  hints: readonly { mode: "advantage" | "disadvantage" }[],
): FinalMode {
  const all = [...(roller === "normal" ? [] : [roller]), ...hints.map((h) => h.mode)];
  const adv = all.includes("advantage");
  const dis = all.includes("disadvantage");
  if (adv && dis) return "normal";
  return adv ? "advantage" : dis ? "disadvantage" : "normal";
}

/**
 * FR-MOD-18 (tier 2): the physical group key of a bonus-die part. One group per effect:
 * `e:<effectId>`; an effect with several dice parts on one roll keys each by its modifier index
 * (`e:<effectId>.<index>`). The tray (R2) and the server derive keys from this one function.
 */
export function bonusDieKey(effectId: string, index: number, several: boolean): string {
  return several ? `e:${effectId}.${index}` : `e:${effectId}`;
}

/** FR-MOD-18: a roll's bonus-die groups, in part order (the tray asks one per group). */
export interface BonusDieGroup<E extends ModEffect = ModEffect> {
  key: string;
  effect: E;
  index: number;
  /** "1d4", doubled on a crit's damage (`partDice`). */
  dice: string;
  sign: 1 | -1;
}

export function bonusDieGroups<E extends ModEffect>(
  effects: readonly E[],
  creature: CreatureRef,
  s: RollShape & { crit?: boolean },
): BonusDieGroup<E>[] {
  const dice = matchingMods(effects, creature, s).filter((m) => m.modifier.kind === "dice");
  const perEffect = new Map<string, number>();
  for (const m of dice) perEffect.set(m.effect.id, (perEffect.get(m.effect.id) ?? 0) + 1);
  return dice.flatMap(({ effect, modifier: m, index }) =>
    m.kind === "dice"
      ? [
          {
            key: bonusDieKey(effect.id, index, (perEffect.get(effect.id) ?? 0) > 1),
            effect,
            index,
            dice: partDice(m.dice, s),
            sign: m.sign,
          },
        ]
      : [],
  );
}

/** FR-MOD-24: one AC part of a creature's effective AC. */
export interface AcPart {
  effectId: string;
  label: string;
  value: number;
}

/**
 * FR-MOD-24 (tier 2): effective AC = stored AC + Σ `flat` on `ac` of the creature's active
 * effects; `parts` name them ("AC 17 (15 + 2 Shield of Faith)").
 */
export function effectiveAc(
  stored: number,
  effects: readonly ModEffect[],
  creature: CreatureRef,
): { ac: number; parts: AcPart[] } {
  const parts = activeMods(effects, creature).flatMap(({ effect, modifier: m }) =>
    m.kind === "flat" && m.on.roll === "ac"
      ? [{ effectId: effect.id, label: effect.label ?? "", value: m.value }]
      : [],
  );
  return { ac: stored + parts.reduce((s, p) => s + p.value, 0), parts };
}

export type DefenseLevel = "resistance" | "vulnerability" | "immunity";
/** FR-MOD-25: the preset behind a multiplier; `both` = resistance and vulnerability. */
export type DefensePreset = DefenseLevel | "both";

/**
 * FR-MOD-25 (tier 2): the creature's defense against a damage type from its active `defense`
 * modifiers: immunity → None; resistance and vulnerability → `both` (Normal); else the one
 * present. `label` names the effects behind the result ("Rage"), deduplicated, in seq order.
 * Null when none applies (or the type is unknown / null).
 */
export function defenseFor(
  effects: readonly ModEffect[],
  creature: CreatureRef,
  damageType: string | null,
): { level: DefensePreset; label: string } | null {
  if (damageType === null) return null;
  const hits = activeMods(effects, creature).flatMap(({ effect, modifier: m }) =>
    m.kind === "defense" && (m.types as readonly string[]).includes(damageType)
      ? [{ level: m.level, label: effect.label ?? "" }]
      : [],
  );
  const pick = (want: (l: DefenseLevel) => boolean) => [
    ...new Set(hits.filter((h) => want(h.level)).map((h) => h.label)),
  ];
  if (hits.some((h) => h.level === "immunity")) {
    return { level: "immunity", label: pick((l) => l === "immunity").join(", ") };
  }
  const res = hits.some((h) => h.level === "resistance");
  const vul = hits.some((h) => h.level === "vulnerability");
  if (!res && !vul) return null;
  const level: DefensePreset = res && vul ? "both" : res ? "resistance" : "vulnerability";
  return { level, label: pick(() => true).join(", ") };
}

/** FR-MOD-25: the popup's multiplier preset for a defense (`both` → Normal). */
export const DEFENSE_MULTIPLIER = {
  immunity: "none",
  resistance: "half",
  vulnerability: "double",
  both: "normal",
} as const satisfies Record<DefensePreset, string>;
