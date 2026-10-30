// FR-CMPX-07 / -08: a resolved 5etools monster → entry + creature definition (FR-CMP-03, -05).
// No numeric HP or AC → the entry alone. Pure; a field that doesn't fit is dropped or clipped with
// a warning and the record stays.
import {
  BLOCK_NAME_MAX,
  BLOCK_TEXT_MAX,
  BLOCKS_MAX,
  isValidArtPath,
  META_TEXT_MAX,
  type MonsterMeta,
  NAME_MAX,
  ordinal,
  type StatBlockSection,
} from "@shared/compendium/schemas";
import { hpAverage, normalizeHpFormula, parseHpFormula } from "@shared/entities/hp-formula";
import {
  ABILITIES,
  ATTACKS_MAX,
  Attack,
  abilityMod,
  CR_VALUES,
  CREATURE_TYPES,
  type CreatureType,
  DAMAGE_RE,
  DAMAGE_TYPES,
  ENTITY_NAME_MAX,
  EntityName,
  MonsterStatBlock,
  type Senses,
  Senses as SensesSchema,
  type SIZES,
} from "@shared/entities/schemas";
import { slugify } from "../text";
import { tokenPath } from "./art";
import { asNum, asStr, isRaw, nameOf, type Raw, rawList, refKey, strings } from "./raw";
import type { Run } from "./run";
import { entriesToMarkdown, rawStrings, renderTags, type Warn } from "./text";

const ATTACK_NAME_MAX = 40;
const SIZE_CODES: Readonly<Record<string, (typeof SIZES)[number]>> = {
  T: "tiny",
  S: "small",
  M: "medium",
  L: "large",
  H: "huge",
  G: "gargantuan",
};
const ALIGNMENT: Readonly<Record<string, string>> = {
  L: "lawful",
  N: "neutral",
  NX: "neutral",
  NY: "neutral",
  C: "chaotic",
  G: "good",
  E: "evil",
  U: "unaligned",
  A: "any alignment",
};
const FREQ_LABEL: readonly [string, string][] = [
  ["daily", "day"],
  ["rest", "rest"],
  ["weekly", "week"],
  ["monthly", "month"],
  ["yearly", "year"],
];

const DAMAGE_TYPE_RE = new RegExp(`\\b(${DAMAGE_TYPES.join("|")})\\s+damage\\b`, "i");
const ATK_TAG = /\{@atk\s/;
const HIT_TAG = /\{@hit\s+([+-]?\d+)[^}]*\}/;
const DAMAGE_TAG = /\{@damage\s+([^}|]+)[^}]*\}/g;
const FIRST_TERM = /^\d+d\d+(?:[+-]\d+(?![d\d]))?/;

export interface MonsterEnv {
  groups: ReadonlyMap<string, Raw>;
  exists: (relPath: string) => boolean;
  replaces: (kind: "monster", record: Raw) => string[];
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- facets and numbers ----------

function sizeOf(c: Run, key: string, m: Raw) {
  const codes = Array.isArray(m.size) ? strings(m.size) : strings([m.size]);
  const size = SIZE_CODES[codes[0] ?? ""];
  if (!size) {
    c.warn(key, "size", "No known size; medium used");
    return "medium";
  }
  if (codes.length > 1) c.warn(key, "size", "Several sizes; first used");
  return size;
}

function crOf(c: Run, key: string, m: Raw) {
  const raw = isRaw(m.cr) ? m.cr.cr : m.cr;
  if (typeof raw === "string" && (CR_VALUES as readonly string[]).includes(raw)) return raw;
  c.warn(key, "cr", "No known CR; 0 used");
  return "0";
}

function typeText(c: Run, key: string, m: Raw) {
  const inner = isRaw(m.type) ? m.type.type : m.type;
  if (typeof inner === "string") return inner.toLowerCase();
  const choose = isRaw(inner) ? strings(inner.choose) : [];
  if (choose[0]) {
    c.warn(key, "type", "A choice of types; first used");
    return choose[0].toLowerCase();
  }
  c.warn(key, "type", "No type");
  return "unknown";
}

function creatureType(c: Run, key: string, t: string) {
  if ((CREATURE_TYPES as readonly string[]).includes(t)) return t as CreatureType;
  if (t !== "unknown") c.warn(key, "statBlock.type", "Not an SRD creature type; dropped");
  return undefined;
}

/** The first numeric AC; anything else → none (FR-CMPX-08). */
function acOf(m: Raw) {
  const first = Array.isArray(m.ac) ? m.ac[0] : m.ac;
  return asNum(first) ?? (isRaw(first) ? asNum(first.ac) : undefined);
}

function armorNote(m: Raw): string | undefined {
  if (!Array.isArray(m.ac)) return undefined;
  const parts: string[] = [];
  for (const [i, a] of m.ac.entries()) {
    if (!isRaw(a)) {
      if (i > 0 && typeof a === "number") parts.push(String(a));
      continue;
    }
    const from = strings(a.from).map(renderTags).join(", ");
    if (from) parts.push(from);
    const cond = asStr(a.condition);
    if (cond) parts.push(renderTags(`${i > 0 ? `${asNum(a.ac) ?? ""} ` : ""}${cond}`).trim());
    if (asStr(a.special)) parts.push(renderTags(asStr(a.special) as string));
  }
  return parts.join("; ") || undefined;
}

function hpFormula(c: Run, key: string, raw: string | undefined, hp: number) {
  if (!raw) return undefined;
  const f = normalizeHpFormula(raw);
  if (parseHpFormula(f) && hpAverage(f) === hp) return f;
  c.warn(key, "statBlock.hpFormula", `"${f}" doesn't fit HP ${hp}; dropped`);
  return undefined;
}

function speedText(speed: unknown) {
  if (!isRaw(speed)) return undefined;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(speed)) {
    const n = asNum(v) ?? (isRaw(v) ? asNum(v.number) : undefined);
    if (n === undefined) continue;
    const cond =
      isRaw(v) && asStr(v.condition) ? ` ${renderTags(asStr(v.condition) as string)}` : "";
    const hover = k === "fly" && speed.canHover === true ? " (hover)" : "";
    parts.push(k === "walk" ? `${n} ft.${cond}` : `${k} ${n} ft.${hover}${cond}`);
  }
  return parts.join(", ") || undefined;
}

const walkSpeed = (m: Raw) => {
  if (!isRaw(m.speed)) return undefined;
  const w = m.speed.walk;
  return asNum(w) ?? (isRaw(w) ? asNum(w.number) : undefined);
};

function darkvision(c: Run, key: string, senses: string): Senses | undefined {
  const r = /darkvision\s+(\d+)\s*ft/i.exec(senses);
  if (!r) return undefined;
  // FR-CHARX-49 (OQ-CHARX-30): no `visionFt` = Normal vision (999 ft).
  const s = { darkvisionFt: Number(r[1]), seesMagicalDarkness: false };
  if (SensesSchema.safeParse(s).success) return s;
  c.warn(key, "statBlock.senses", `Darkvision ${r[1]} ft doesn't fit; dropped`);
  return undefined;
}

// ---------- attacks (FR-CMPX-07, OQ-CMPX-03 A) ----------

function attacks(c: Run, key: string, actions: readonly Raw[]) {
  const out: Attack[] = [];
  for (const [i, a] of actions.entries()) {
    const text = rawStrings(a.entries).join("\n");
    if (!ATK_TAG.test(text)) continue;
    const hit = HIT_TAG.exec(text);
    const tags = [...text.matchAll(DAMAGE_TAG)];
    const first = tags[0];
    if (!hit || !first) continue;
    const field = `attacks[${i}]`;
    const dice = (first[1] ?? "").replace(/\s+/g, "").replace(/−/g, "-");
    const term = FIRST_TERM.exec(dice)?.[0] ?? dice;
    if (!DAMAGE_RE.test(term)) {
      c.warn(key, field, `Damage "${dice}" doesn't fit; attack dropped`);
      continue;
    }
    if (tags.length > 1 || term !== dice) c.warn(key, field, "Further damage kept as text only");
    const start = (first.index ?? 0) + first[0].length;
    const type = DAMAGE_TYPE_RE.exec(text.slice(start, tags[1]?.index))?.[1]?.toLowerCase();
    const attack = {
      name: c.clip(key, field, renderTags(nameOf(a)).replace(/\*/g, "").trim(), ATTACK_NAME_MAX),
      toHit: Number(hit[1]),
      damage: term,
      ...(type ? { damageType: type } : {}),
    };
    if (!Attack.safeParse(attack).success) c.warn(key, field, "Doesn't fit; dropped");
    else if (out.length >= ATTACKS_MAX) c.warn(key, field, `More than ${ATTACKS_MAX}; dropped`);
    else out.push(attack as Attack);
  }
  return out;
}

// ---------- text ----------

function section(c: Run, key: string, field: string, name: string, text: string): StatBlockSection {
  return {
    name: c.clip(key, `${field}.name`, name, BLOCK_NAME_MAX),
    text: c.clip(key, `${field}.text`, text, BLOCK_TEXT_MAX),
  };
}

function capBlocks(c: Run, key: string, field: string, list: StatBlockSection[]) {
  if (list.length <= BLOCKS_MAX) return list;
  c.warn(key, field, `More than ${BLOCKS_MAX} entries; clipped`);
  return list.slice(0, BLOCKS_MAX);
}

function sections(c: Run, key: string, field: string, raw: unknown, warn: Warn) {
  return rawList(raw).map((b, i) => {
    const name = renderTags(nameOf(b)).replace(/\*/g, "").trim() || cap(field);
    return section(c, key, `${field}[${i}]`, name, entriesToMarkdown(b.entries ?? b.entry, warn));
  });
}

const spellName = (s: unknown) => {
  if (typeof s === "string") return renderTags(s);
  return isRaw(s) && s.hidden !== true ? renderTags(asStr(s.entry) ?? "") : "";
};
const spellList = (v: unknown) =>
  (Array.isArray(v) ? v : [v]).map(spellName).filter(Boolean).join(", ");

function levelLine(level: string, slot: Raw) {
  const list = spellList(slot.spells);
  if (!list) return null;
  if (level === "0") return `Cantrips (at will): ${list}`;
  const n = ordinal(Number(level));
  const lower = asNum(slot.lower);
  const slots = asNum(slot.slots);
  const label =
    lower !== undefined && lower !== Number(level) ? `${ordinal(lower)}–${n} level` : `${n} level`;
  const each = lower !== undefined && lower !== Number(level) ? `${n}-level ` : "";
  return `${label}${slots !== undefined ? ` (${slots} ${each}slot${slots === 1 ? "" : "s"})` : ""}: ${list}`;
}

/** `{"1e": […], "2": […]}` → "2/day: …", "1/day each: …". */
function freqLines(freq: unknown, unit: string) {
  if (!isRaw(freq)) return [];
  return Object.entries(freq)
    .sort(([a], [b]) => Number.parseInt(b, 10) - Number.parseInt(a, 10))
    .flatMap(([k, list]) => {
      const names = spellList(list);
      const n = Number.parseInt(k, 10);
      return names ? [`${n}/${unit}${k.endsWith("e") ? " each" : ""}: ${names}`] : [];
    });
}

/** FR-CMPX-07: header, then "At will: …", "1/day each: …", "1st level (4 slots): …". */
function spellcastingTraits(c: Run, key: string, m: Raw, warn: Warn) {
  return rawList(m.spellcasting).map((sc, i) => {
    const hidden = new Set(strings(sc.hidden));
    const lines: string[] = [];
    const add = (k: string, label: string) => {
      const names = hidden.has(k) ? "" : spellList(sc[k] ?? []);
      if (names) lines.push(`${label}: ${names}`);
    };
    add("constant", "Constant");
    add("will", "At will");
    add("ritual", "Rituals");
    for (const [k, unit] of FREQ_LABEL) {
      if (!hidden.has(k)) lines.push(...freqLines(sc[k], unit));
    }
    if (isRaw(sc.spells) && !hidden.has("spells")) {
      for (const level of Object.keys(sc.spells).sort((a, b) => Number(a) - Number(b))) {
        const slot = sc.spells[level];
        const line = isRaw(slot) ? levelLine(level, slot) : null;
        if (line) lines.push(line);
      }
    }
    const header = entriesToMarkdown(sc.headerEntries, warn);
    const footer = entriesToMarkdown(sc.footerEntries, warn);
    const text = [header, lines.join("\n"), footer].filter(Boolean).join("\n\n");
    const name = renderTags(nameOf(sc)) || "Spellcasting";
    return section(c, key, `spellcasting[${i}]`, name, text);
  });
}

function namedList(raw: unknown, warn: Warn) {
  return rawList(raw)
    .map((b) => {
      const text = entriesToMarkdown(b.entries ?? b.entry, warn);
      const name = renderTags(nameOf(b));
      return name ? `**${name}.** ${text}` : text;
    })
    .join("\n\n");
}

/** Mythic, lair actions, regional effects → one trait each (FR-CMPX-07). */
function extraTraits(c: Run, key: string, m: Raw, group: Raw | undefined, warn: Warn) {
  const out: StatBlockSection[] = [];
  const add = (name: string, text: string) => {
    if (text) out.push(section(c, key, name, name, text));
  };
  add(
    "Mythic Actions",
    [entriesToMarkdown(m.mythicHeader, warn), namedList(m.mythic, warn)]
      .filter(Boolean)
      .join("\n\n"),
  );
  if (group) {
    add("Lair Actions", entriesToMarkdown(group.lairActions, warn));
    add("Regional Effects", entriesToMarkdown(group.regionalEffects, warn));
    add("Mythic Encounter", entriesToMarkdown(group.mythicEncounter, warn));
  }
  return out;
}

function alignmentCodes(list: readonly string[]): string {
  if (list.length === 1) return ALIGNMENT[list[0] ?? ""] ?? "";
  if (list.length === 2) return list.map((a) => ALIGNMENT[a] ?? "").join(" ");
  const has = (a: string) => list.includes(a);
  if (list.length === 3 && has("NX") && has("NY") && has("N")) return "any neutral alignment";
  if (list.length === 4) {
    if (!has("L") && !has("NX")) return "any chaotic alignment";
    if (!has("G") && !has("NY")) return "any evil alignment";
    if (!has("C") && !has("NX")) return "any lawful alignment";
    if (!has("E") && !has("NY")) return "any good alignment";
  }
  if (list.length === 5) {
    for (const [code, word] of [
      ["G", "good"],
      ["E", "evil"],
      ["L", "lawful"],
      ["C", "chaotic"],
    ]) {
      if (!has(code as string)) return `any non-${word} alignment`;
    }
  }
  return "any alignment";
}

function alignmentText(m: Raw) {
  const raw = Array.isArray(m.alignment) ? m.alignment : [];
  const text = raw.every((a) => typeof a === "string")
    ? alignmentCodes(strings(raw))
    : rawList(raw)
        .map((a) => {
          const base = asStr(a.special) ?? alignmentCodes(strings(a.alignment));
          const chance = asNum(a.chance);
          const note = asStr(a.note);
          return `${base}${chance ? ` (${chance}%)` : ""}${note ? ` (${note})` : ""}`;
        })
        .join(" or ");
  return text ? `${asStr(m.alignmentPrefix) ?? ""}${text}` : undefined;
}

/** `resist` / `immune` / `vulnerable` / `conditionImmune`: strings and `{<prop>: […], note}` groups. */
function damageList(v: unknown, prop: string): string | undefined {
  if (!Array.isArray(v)) return undefined;
  const parts: string[] = [];
  const plain: string[] = [];
  for (const x of v) {
    if (typeof x === "string") plain.push(renderTags(x));
    else if (isRaw(x)) {
      if (asStr(x.special)) {
        parts.push(renderTags(asStr(x.special) as string));
        continue;
      }
      const inner = damageList(x[prop], prop) ?? "";
      const pre = asStr(x.preNote);
      const note = asStr(x.note);
      parts.push(
        [pre, inner, note]
          .filter(Boolean)
          .map((p) => renderTags(p as string))
          .join(" "),
      );
    }
  }
  if (plain.length > 0) parts.unshift(plain.join(", "));
  return parts.join("; ") || undefined;
}

function signedMap(v: unknown) {
  if (!isRaw(v)) return undefined;
  const parts = Object.entries(v).flatMap(([k, x]) =>
    typeof x === "string" ? [`${cap(k)} ${x}`] : [],
  );
  return parts.join(", ") || undefined;
}

function subtypeText(m: Raw) {
  if (!isRaw(m.type)) return undefined;
  const tags = (Array.isArray(m.type.tags) ? m.type.tags : []).flatMap((t) => {
    if (typeof t === "string") return [t];
    return isRaw(t) ? [[asStr(t.prefix), asStr(t.tag)].filter(Boolean).join(" ")] : [];
  });
  const swarm = SIZE_CODES[asStr(m.type.swarmSize) ?? ""];
  return [...(swarm ? [`swarm of ${swarm}`] : []), ...tags].join(", ") || undefined;
}

function sensesText(m: Raw) {
  const senses = strings(m.senses).map(renderTags);
  const passive = asNum(m.passive);
  if (passive !== undefined) senses.push(`passive Perception ${passive}`);
  return senses.join(", ") || undefined;
}

function metaOf(c: Run, key: string, m: Raw): MonsterMeta {
  const raw: Record<keyof MonsterMeta, string | undefined> = {
    subtype: subtypeText(m),
    alignment: alignmentText(m),
    armorNote: armorNote(m),
    speedText: speedText(m.speed),
    savesText: signedMap(m.save),
    skillsText: signedMap(m.skill),
    vulnerabilities: damageList(m.vulnerable, "vulnerable"),
    resistances: damageList(m.resist, "resist"),
    immunities: damageList(m.immune, "immune"),
    conditionImmunities: damageList(m.conditionImmune, "conditionImmune"),
    senses: sensesText(m),
    languages: strings(m.languages).map(renderTags).join(", ") || undefined,
  };
  const meta: MonsterMeta = {};
  for (const [k, v] of Object.entries(raw) as [keyof MonsterMeta, string | undefined][]) {
    if (v) meta[k] = c.clip(key, `body.meta.${k}`, v, META_TEXT_MAX);
  }
  return meta;
}

// ---------- the record ----------

function statBlockOf(c: Run, key: string, m: Raw, size: string, cr: string, type: string) {
  const ac = acOf(m);
  const hp = isRaw(m.hp) ? asNum(m.hp.average) : undefined;
  if (ac === undefined || hp === undefined) {
    c.warn(key, "definition", "No numeric HP or AC; entry only");
    return null;
  }
  const scores = Object.fromEntries(ABILITIES.map((a) => [a, asNum(m[a])]));
  const hasScores = ABILITIES.every((a) => scores[a] !== undefined);
  const saves = isRaw(m.save) ? ABILITIES.filter((a) => isRaw(m.save) && m.save[a] != null) : [];
  const sb: Record<string, unknown> = {
    size,
    ac,
    hpMax: hp,
    hpFormula: hpFormula(c, key, isRaw(m.hp) ? asStr(m.hp.formula) : undefined, hp),
    initBonus: abilityMod(asNum(m.dex) ?? 10),
    speed: walkSpeed(m),
    abilities: hasScores ? scores : undefined,
    saveProficiencies: hasScores && saves.length > 0 ? saves : undefined,
    attacks: attacks(c, key, rawList(m.action)),
    cr,
    type: creatureType(c, key, type),
  };
  for (const k of Object.keys(sb)) if (sb[k] === undefined) delete sb[k];
  // Drop optional fields that don't fit; a required one failing leaves the entry alone.
  for (let pass = 0; pass < 5; pass++) {
    const r = MonsterStatBlock.safeParse(sb);
    if (r.success) break;
    const bad = new Set(r.error.issues.map((x) => String(x.path[0] ?? "")));
    const optional = ["hpFormula", "speed", "abilities", "saveProficiencies", "type"];
    const required = [...bad].filter((b) => !optional.includes(b));
    if (required.length > 0) {
      c.warn(key, `statBlock.${required.join(",")}`, "Doesn't fit the creature core; entry only");
      return null;
    }
    for (const b of bad) {
      c.warn(key, `statBlock.${b}`, "Doesn't fit; dropped");
      delete sb[b];
      if (b === "abilities") delete sb.saveProficiencies;
    }
  }
  const senses = darkvision(c, key, strings(m.senses).map(renderTags).join(", "));
  return { ...(sb as MonsterStatBlock), ...(senses ? { senses } : {}) };
}

function artPathOf(c: Run, key: string, m: Raw, exists: (p: string) => boolean) {
  const p = tokenPath(m);
  if (!isValidArtPath(p)) {
    c.warn(key, "artPath", "Token path not allowed; none");
    return null;
  }
  if (exists(p)) return p;
  c.warn(key, "artPath", "Token file missing; none");
  return null;
}

/** No stat block, or a name entities refuse → no `definition`: one bad row must not fail the book. */
function definitionOf(c: Run, key: string, rawName: string, statBlock: MonsterStatBlock | null) {
  if (!statBlock) return {};
  const name = c.clip(key, "definition.name", rawName, ENTITY_NAME_MAX);
  if (EntityName.safeParse(name).success) return { definition: { name, statBlock } };
  c.warn(key, "definition.name", "Name doesn't fit a creature; entry only");
  return {};
}

export function mapMonster(c: Run, m: Raw, env: MonsterEnv) {
  const rawName = nameOf(m).trim();
  const key = `monster/${slugify(rawName)}`;
  const warn: Warn = (field, message) => c.warn(key, field, message);
  const name = c.clip(key, "name", rawName, NAME_MAX);
  const size = sizeOf(c, key, m);
  const cr = crOf(c, key, m);
  const type = typeText(c, key, m);
  const statBlock = statBlockOf(c, key, m, size, cr, type);

  const ref = isRaw(m.legendaryGroup) ? m.legendaryGroup : undefined;
  const group = ref ? env.groups.get(refKey(nameOf(ref), asStr(ref.source) ?? "")) : undefined;
  if (ref && !group) c.warn(key, "legendaryGroup", "Group not found");

  const traits = [
    ...sections(c, key, "traits", m.trait, warn),
    ...spellcastingTraits(c, key, m, warn),
    ...extraTraits(c, key, m, group, warn),
  ];
  const reactionHeader = entriesToMarkdown(m.reactionHeader, warn);
  const reactions = [
    ...(reactionHeader ? [section(c, key, "reactions.header", "Reactions", reactionHeader)] : []),
    ...sections(c, key, "reactions", m.reaction, warn),
  ];
  const legendaryActions = sections(c, key, "legendary", m.legendary, warn);
  const count = asNum(m.legendaryActions) ?? 3;
  const legendaryIntro =
    entriesToMarkdown(m.legendaryHeader, warn) || `Can take ${count} legendary actions.`;

  const replaces = env.replaces("monster", m);
  c.push({
    kind: "monster",
    sourceKey: key,
    data: {
      kind: "monster",
      name,
      facets: {
        cr,
        type: type.slice(0, 40),
        size: size as MonsterStatBlock["size"],
      },
      body: {
        meta: metaOf(c, key, m),
        traits: capBlocks(c, key, "traits", traits),
        actions: capBlocks(c, key, "actions", sections(c, key, "actions", m.action, warn)),
        bonusActions: capBlocks(c, key, "bonusActions", sections(c, key, "bonus", m.bonus, warn)),
        reactions: capBlocks(c, key, "reactions", reactions),
        ...(legendaryActions.length > 0
          ? {
              legendary: {
                intro: c.clip(key, "body.legendary.intro", legendaryIntro, BLOCK_TEXT_MAX),
                actions: capBlocks(c, key, "legendary", legendaryActions),
              },
            }
          : {}),
      },
    },
    ...definitionOf(c, key, rawName, statBlock),
    artPath: artPathOf(c, key, m, env.exists),
    ...(replaces.length > 0 ? { replaces } : {}),
  });
}
