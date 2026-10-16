// Open5e v1 adapter (FR-CMP-05, ADR-0015): recorded responses → import records. Pure: no I/O,
// no clock, no ids. Keeps only `document__slug = wotc-srd` (class archetypes too, defence in
// depth: the recorder already filtered). A field that doesn't fit is dropped with a warning;
// the record stays. Bump `ADAPTER_VERSION` on any mapping change (FR-CMP-04).
import {
  BLOCK_TEXT_MAX,
  BLOCKS_MAX,
  type CompendiumKind,
  EntryDraft,
  type EntryDraftOf,
  MATERIAL_MAX,
  META_TEXT_MAX,
  type MonsterMeta,
  SRD_CLASSES,
  type SrdClass,
  type StatBlockSection,
  StatBlockSection as StatBlockSectionSchema,
} from "@shared/compendium/schemas";
import { CreatureSenses } from "@shared/compendium/senses";
import { hpAverage, normalizeHpFormula, parseHpFormula } from "@shared/entities/hp-formula";
import {
  ABILITIES,
  type Ability,
  ATTACKS_MAX,
  Attack,
  abilityMod,
  DAMAGE_TYPES,
  MonsterStatBlock,
  SIZES,
} from "@shared/entities/schemas";
import { z } from "zod";
import { slugify, splitSections, toMarkdownLite } from "./text";

export const ADAPTER_VERSION = "1";
export const SRD_DOCUMENT_SLUG = "wotc-srd";

export const OPEN5E_ENDPOINTS = [
  "monsters",
  "spells",
  "magicitems",
  "weapons",
  "armor",
  "conditions",
  "classes",
] as const;
export type Open5eEndpoint = (typeof OPEN5E_ENDPOINTS)[number];
/** Recorded responses: each endpoint's `results`, concatenated. */
export type Open5eResponses = Partial<Record<Open5eEndpoint, readonly unknown[]>>;

/** Creature definition written next to a monster entry (FR-CMP-03): entities' `{name, statBlock}`. */
export interface MonsterDefinition {
  name: string;
  /** Entities' creature core + `senses` (V0, seams S6). */
  statBlock: MonsterStatBlock & { senses?: CreatureSenses };
}

export type AdapterRecord =
  | {
      kind: "monster";
      sourceKey: string;
      data: EntryDraftOf<"monster">;
      definition: MonsterDefinition;
    }
  | { kind: Exclude<CompendiumKind, "monster">; sourceKey: string; data: EntryDraft };

export interface AdapterWarning {
  /** `<kind>/<slug>` when known, else `<endpoint>#<index>`. */
  sourceKey: string;
  field: string;
  message: string;
}

export interface AdapterResult {
  records: AdapterRecord[];
  warnings: AdapterWarning[];
  /** Non-`wotc-srd` records (and archetypes) skipped. */
  skipped: number;
  counts: Record<CompendiumKind, number>;
}

// ---------- raw Open5e shapes (only the fields we read) ----------

const str = z.string().nullish();
const Doc = z.looseObject({ slug: z.string().min(1), name: z.string(), document__slug: str });
const RawBlock = z.looseObject({
  name: z.string(),
  desc: z.string().nullish(),
  attack_bonus: z.number().nullish(),
  damage_dice: str,
  damage_bonus: z.number().nullish(),
});
const RawMonster = Doc.extend({
  size: z.string(),
  type: z.string(),
  subtype: str,
  alignment: str,
  armor_class: z.number(),
  armor_desc: str,
  hit_points: z.number(),
  hit_dice: str,
  speed: z.record(z.string(), z.unknown()).nullish(),
  strength: z.number(),
  dexterity: z.number(),
  constitution: z.number(),
  intelligence: z.number(),
  wisdom: z.number(),
  charisma: z.number(),
  strength_save: z.number().nullish(),
  dexterity_save: z.number().nullish(),
  constitution_save: z.number().nullish(),
  intelligence_save: z.number().nullish(),
  wisdom_save: z.number().nullish(),
  charisma_save: z.number().nullish(),
  skills: z.record(z.string(), z.number()).nullish(),
  damage_vulnerabilities: str,
  damage_resistances: str,
  damage_immunities: str,
  condition_immunities: str,
  senses: str,
  languages: str,
  challenge_rating: z.string(),
  actions: z.array(RawBlock).nullish(),
  bonus_actions: z.array(RawBlock).nullish(),
  reactions: z.array(RawBlock).nullish(),
  special_abilities: z.array(RawBlock).nullish(),
  legendary_desc: str,
  legendary_actions: z.array(RawBlock).nullish(),
});
const RawSpell = Doc.extend({
  desc: z.string(),
  higher_level: str,
  range: z.string(),
  components: z.string(),
  material: str,
  can_be_cast_as_ritual: z.boolean(),
  duration: z.string(),
  requires_concentration: z.boolean(),
  casting_time: z.string(),
  level_int: z.number(),
  school: z.string(),
  spell_lists: z.array(z.string()).nullish(),
});
const RawMagicItem = Doc.extend({
  type: z.string(),
  desc: z.string(),
  rarity: str,
  requires_attunement: str,
});
const RawWeapon = Doc.extend({
  category: z.string(),
  cost: str,
  damage_dice: str,
  damage_type: str,
  weight: str,
  properties: z.array(z.string()).nullish(),
});
const RawArmor = Doc.extend({
  category: z.string(),
  ac_string: str,
  strength_requirement: z.number().nullish(),
  cost: str,
  weight: str,
  stealth_disadvantage: z.boolean().nullish(),
});
const RawCondition = Doc.extend({ desc: z.string() });
const RawArchetype = Doc.extend({ desc: z.string() });
const RawClass = Doc.extend({
  desc: z.string(),
  table: str,
  archetypes: z.array(z.unknown()).nullish(),
});

// ---------- helpers ----------

class Run {
  records: AdapterRecord[] = [];
  warnings: AdapterWarning[] = [];
  skipped = 0;
  warn(sourceKey: string, field: string, message: string) {
    this.warnings.push({ sourceKey, field, message });
  }
}

const isSrd = (r: unknown) =>
  typeof r === "object" &&
  r !== null &&
  "document__slug" in r &&
  r.document__slug === SRD_DOCUMENT_SLUG;
const nonEmpty = (s: string | null | undefined) => {
  const t = s?.trim();
  return t ? t : undefined;
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/** Optional text that must fit `max`: too long → dropped with a warning. */
function fit(c: Run, key: string, field: string, value: string | undefined, max: number) {
  if (value === undefined || value.length <= max) return value;
  c.warn(key, field, `Longer than ${max} characters; dropped`);
  return undefined;
}

function sections(c: Run, key: string, field: string, raw: readonly z.infer<typeof RawBlock>[]) {
  const out: StatBlockSection[] = [];
  raw.forEach((b, i) => {
    const s = { name: b.name.trim(), text: toMarkdownLite(b.desc ?? "") };
    if (!StatBlockSectionSchema.safeParse(s).success) {
      c.warn(key, `${field}[${i}]`, "Name or text too long; dropped");
    } else if (out.length >= BLOCKS_MAX) {
      c.warn(key, `${field}[${i}]`, `More than ${BLOCKS_MAX} entries; dropped`);
    } else out.push(s);
  });
  return out;
}

function parse<T extends z.ZodType>(
  c: Run,
  schema: T,
  raw: unknown,
  where: string,
): z.infer<T> | null {
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  c.warn(where, "", `Unreadable record: ${r.error.issues[0]?.message ?? "invalid"}`);
  return null;
}

function push(c: Run, rec: AdapterRecord) {
  const r = EntryDraft.safeParse(rec.data);
  if (!r.success) {
    for (const i of r.error.issues) c.warn(rec.sourceKey, i.path.join("."), i.message);
    return;
  }
  c.records.push(rec);
}

// ---------- monsters → entry + creature core ----------

const SAVE_KEYS: Record<Ability, keyof z.infer<typeof RawMonster>> = {
  str: "strength_save",
  dex: "dexterity_save",
  con: "constitution_save",
  int: "intelligence_save",
  wis: "wisdom_save",
  cha: "charisma_save",
};
const ABILITY_ABBR: Record<Ability, string> = {
  str: "Str",
  dex: "Dex",
  con: "Con",
  int: "Int",
  wis: "Wis",
  cha: "Cha",
};

const DAMAGE_TYPE_RE = new RegExp(`\\b(${DAMAGE_TYPES.join("|")})\\s+damage\\b`, "i");
const DICE_TERM_RE = /^(\d+d\d+)/;

function attacks(c: Run, key: string, raw: readonly z.infer<typeof RawBlock>[]) {
  const out: Attack[] = [];
  for (const [i, a] of raw.entries()) {
    if (a.attack_bonus == null || !a.damage_dice) continue;
    const field = `attacks[${i}]`;
    const dice = a.damage_dice.replace(/\s+/g, "");
    const first = DICE_TERM_RE.exec(dice)?.[1];
    if (!first) {
      c.warn(key, field, `Damage "${a.damage_dice}" not dice; attack dropped`);
      continue;
    }
    if (first !== dice) c.warn(key, field, `Extra damage "${dice}" kept as text only`);
    const bonus = a.damage_bonus ?? 0;
    const hit = (a.desc ?? "").split(/Hit:/i)[1] ?? "";
    const type = DAMAGE_TYPE_RE.exec(hit)?.[1]?.toLowerCase();
    const attack = {
      name: a.name.trim(),
      toHit: a.attack_bonus,
      damage: bonus === 0 ? first : `${first}${signed(bonus)}`,
      ...(type ? { damageType: type } : {}),
    };
    if (!Attack.safeParse(attack).success) c.warn(key, field, "Doesn't fit; dropped");
    else if (out.length >= ATTACKS_MAX) c.warn(key, field, "More than 20 attacks; dropped");
    else out.push(attack as Attack);
  }
  return out;
}

function hpFormula(c: Run, key: string, m: z.infer<typeof RawMonster>) {
  if (!m.hit_dice) return undefined;
  let f = normalizeHpFormula(m.hit_dice);
  const p = parseHpFormula(f);
  if (p && !/[+-]/.test(f)) {
    const k = p.count * abilityMod(m.constitution);
    if (k !== 0) f = `${f}${signed(k)}`;
  }
  if (parseHpFormula(f) && hpAverage(f) === m.hit_points) return f;
  c.warn(key, "statBlock.hpFormula", `"${m.hit_dice}" doesn't fit HP ${m.hit_points}; dropped`);
  return undefined;
}

function darkvision(c: Run, key: string, senses: string | undefined) {
  const m = /darkvision\s+(\d+)\s*ft/i.exec(senses ?? "");
  if (!m) return undefined;
  const s = { visionFt: 0, darkvisionFt: Number(m[1]), seesMagicalDarkness: false };
  if (CreatureSenses.safeParse(s).success) return s;
  c.warn(key, "statBlock.senses", `Darkvision ${m[1]} ft doesn't fit; dropped`);
  return undefined;
}

function speedText(speed: Record<string, unknown> | null | undefined) {
  if (!speed) return undefined;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(speed)) {
    if (typeof v !== "number") continue;
    const hover = k === "fly" && speed.hover === true ? " (hover)" : "";
    parts.push(k === "walk" ? `${v} ft.` : `${k} ${v} ft.${hover}`);
  }
  const notes = typeof speed.notes === "string" ? speed.notes : "";
  return nonEmpty([parts.join(", "), notes].filter(Boolean).join(" "));
}

function monster(c: Run, raw: unknown, i: number) {
  const m = parse(c, RawMonster, raw, `monsters#${i}`);
  if (!m) return;
  const key = `monster/${slugify(m.slug)}`;
  const size = m.size.toLowerCase();
  if (!(SIZES as readonly string[]).includes(size)) return c.warn(key, "size", "Unknown size");
  const abilities = {
    str: m.strength,
    dex: m.dexterity,
    con: m.constitution,
    int: m.intelligence,
    wis: m.wisdom,
    cha: m.charisma,
  };
  const saves = ABILITIES.filter((a) => m[SAVE_KEYS[a]] != null);
  const walk = m.speed?.walk;
  const sb: Record<string, unknown> = {
    size,
    ac: m.armor_class,
    hpMax: m.hit_points,
    hpFormula: hpFormula(c, key, m),
    initBonus: abilityMod(m.dexterity),
    speed: typeof walk === "number" ? walk : undefined,
    abilities,
    saveProficiencies: saves.length > 0 ? saves : undefined,
    attacks: attacks(c, key, m.actions ?? []),
    cr: m.challenge_rating,
  };
  for (const k of Object.keys(sb)) if (sb[k] === undefined) delete sb[k];
  // Drop optional fields that don't fit; a required one failing drops the record.
  for (let pass = 0; pass < 5; pass++) {
    const r = MonsterStatBlock.safeParse(sb);
    if (r.success) break;
    const bad = new Set(r.error.issues.map((x) => String(x.path[0] ?? "")));
    const optional = ["hpFormula", "speed", "abilities", "saveProficiencies"];
    const required = [...bad].filter((b) => !optional.includes(b));
    if (required.length > 0) {
      return c.warn(key, `statBlock.${required.join(",")}`, "Doesn't fit the creature core");
    }
    for (const b of bad) {
      c.warn(key, `statBlock.${b}`, "Doesn't fit; dropped");
      delete sb[b];
      if (b === "abilities") delete sb.saveProficiencies;
    }
  }
  const senses = darkvision(c, key, m.senses ?? undefined);
  const statBlock = { ...(sb as MonsterStatBlock), ...(senses ? { senses } : {}) };

  const savesText = ABILITIES.flatMap((a) => {
    const v = m[SAVE_KEYS[a]];
    return typeof v === "number" ? [`${ABILITY_ABBR[a]} ${signed(v)}`] : [];
  }).join(", ");
  const skillsText = Object.entries(m.skills ?? {})
    .map(([k, v]) => `${cap(k.replace(/_/g, " "))} ${signed(v)}`)
    .join(", ");
  const metaRaw: Record<keyof MonsterMeta, string | undefined> = {
    subtype: nonEmpty(m.subtype),
    alignment: nonEmpty(m.alignment),
    armorNote: nonEmpty(m.armor_desc),
    speedText: speedText(m.speed),
    savesText: nonEmpty(savesText),
    skillsText: nonEmpty(skillsText),
    vulnerabilities: nonEmpty(m.damage_vulnerabilities),
    resistances: nonEmpty(m.damage_resistances),
    immunities: nonEmpty(m.damage_immunities),
    conditionImmunities: nonEmpty(m.condition_immunities),
    senses: nonEmpty(m.senses),
    languages: nonEmpty(m.languages),
  };
  const meta: MonsterMeta = {};
  for (const [k, v] of Object.entries(metaRaw) as [keyof MonsterMeta, string | undefined][]) {
    const f = fit(c, key, `body.meta.${k}`, v, META_TEXT_MAX);
    if (f !== undefined) meta[k] = f;
  }
  const legendary = m.legendary_actions?.length
    ? {
        intro:
          fit(
            c,
            key,
            "body.legendary.intro",
            toMarkdownLite(m.legendary_desc ?? ""),
            BLOCK_TEXT_MAX,
          ) ?? "",
        actions: sections(c, key, "legendary", m.legendary_actions),
      }
    : undefined;
  const name = m.name.trim();
  push(c, {
    kind: "monster",
    sourceKey: key,
    data: {
      kind: "monster",
      name,
      facets: {
        cr: m.challenge_rating,
        type: m.type.toLowerCase(),
        size: size as MonsterStatBlock["size"],
      },
      body: {
        meta,
        traits: sections(c, key, "traits", m.special_abilities ?? []),
        actions: sections(c, key, "actions", m.actions ?? []),
        bonusActions: sections(c, key, "bonusActions", m.bonus_actions ?? []),
        reactions: sections(c, key, "reactions", m.reactions ?? []),
        ...(legendary ? { legendary } : {}),
      },
    },
    definition: { name, statBlock },
  });
}

// ---------- spells, items, conditions ----------

const classOf = (name: string): SrdClass | undefined =>
  SRD_CLASSES.find((k) => k.toLowerCase() === name.trim().toLowerCase());

function spell(c: Run, raw: unknown, i: number) {
  const s = parse(c, RawSpell, raw, `spells#${i}`);
  if (!s) return;
  const classes = [...new Set((s.spell_lists ?? []).flatMap((n) => classOf(n) ?? []))].sort();
  const key = `spell/${slugify(s.slug)}`;
  const material = fit(c, key, "body.material", nonEmpty(s.material), MATERIAL_MAX);
  const higherLevel = nonEmpty(s.higher_level);
  push(c, {
    kind: "spell",
    sourceKey: key,
    data: {
      kind: "spell",
      name: s.name.trim(),
      facets: {
        level: s.level_int,
        school: s.school.toLowerCase() as EntryDraftOf<"spell">["facets"]["school"],
        classes,
        concentration: s.requires_concentration,
        ritual: s.can_be_cast_as_ritual,
      },
      body: {
        castingTime: s.casting_time,
        range: s.range,
        components: s.components,
        ...(material ? { material } : {}),
        duration: s.duration,
        text: toMarkdownLite(s.desc),
        ...(higherLevel ? { higherLevel: toMarkdownLite(higherLevel) } : {}),
      },
    },
  });
}

const optional = <K extends string>(k: K, v: string | undefined) =>
  (v ? { [k]: v } : {}) as Partial<Record<K, string>>;

function magicItem(c: Run, raw: unknown, i: number) {
  const m = parse(c, RawMagicItem, raw, `magicitems#${i}`);
  if (!m) return;
  const att = nonEmpty(m.requires_attunement);
  push(c, {
    kind: "item",
    sourceKey: `item/${slugify(m.slug)}`,
    data: {
      kind: "item",
      name: m.name.trim(),
      facets: {
        category: "magic",
        ...optional("rarity", nonEmpty(m.rarity)?.toLowerCase()),
        attunement: att !== undefined,
      },
      body: { typeLine: att ? `${m.type} (${att})` : m.type, text: toMarkdownLite(m.desc) },
    },
  });
}

/** "Martial Melee Weapons" → "Martial melee weapon". */
const typeLine = (category: string) => cap(category.toLowerCase().replace(/s$/, ""));

function weapon(c: Run, raw: unknown, i: number) {
  const w = parse(c, RawWeapon, raw, `weapons#${i}`);
  if (!w) return;
  const dice = nonEmpty(w.damage_dice);
  const damage =
    dice && dice !== "0" ? [dice, nonEmpty(w.damage_type)].filter(Boolean).join(" ") : undefined;
  push(c, {
    kind: "item",
    sourceKey: `item/${slugify(w.slug)}`,
    data: {
      kind: "item",
      name: w.name.trim(),
      facets: { category: "weapon", attunement: false },
      body: {
        typeLine: typeLine(w.category),
        ...optional("cost", nonEmpty(w.cost)),
        ...optional("weight", nonEmpty(w.weight)),
        ...optional("damage", damage),
        ...optional("properties", nonEmpty((w.properties ?? []).join(", "))),
        text: "",
      },
    },
  });
}

function armor(c: Run, raw: unknown, i: number) {
  const a = parse(c, RawArmor, raw, `armor#${i}`);
  if (!a) return;
  const notes = [
    a.strength_requirement ? `Requires Strength ${a.strength_requirement}.` : "",
    a.stealth_disadvantage ? "Disadvantage on Dexterity (Stealth) checks." : "",
  ].filter(Boolean);
  push(c, {
    kind: "item",
    sourceKey: `item/${slugify(a.slug)}`,
    data: {
      kind: "item",
      name: a.name.trim(),
      facets: { category: "armor", attunement: false },
      body: {
        typeLine: typeLine(a.category),
        ...optional("cost", nonEmpty(a.cost)),
        ...optional("weight", nonEmpty(a.weight)),
        ...optional("ac", nonEmpty(a.ac_string)),
        text: notes.join(" "),
      },
    },
  });
}

function condition(c: Run, raw: unknown, i: number) {
  const x = parse(c, RawCondition, raw, `conditions#${i}`);
  if (!x) return;
  push(c, {
    kind: "condition",
    sourceKey: `condition/${slugify(x.slug)}`,
    data: {
      kind: "condition",
      name: x.name.trim(),
      facets: {},
      body: { text: toMarkdownLite(x.desc) },
    },
  });
}

// ---------- classes → features ----------

const LEVEL_RE = /\b(?:at|reach)\s+(\d{1,2})(?:st|nd|rd|th)\s+level\b/i;

/** Feature name → first level in the class table's Features column. */
function tableLevels(table: string | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  const rows = (table ?? "").split("\n").map((l) => l.split("|").map((s) => s.trim()));
  const col = rows[0]?.findIndex((h) => h.toLowerCase() === "features") ?? -1;
  if (col < 0) return out;
  for (const cells of rows) {
    const level = /^(\d{1,2})(?:st|nd|rd|th)$/.exec(cells[1] ?? "")?.[1];
    if (!level) continue;
    for (const f of (cells[col] ?? "").split(",")) {
      const n = f
        .replace(/\(.*?\)/g, "")
        .trim()
        .toLowerCase();
      if (n && !out.has(n)) out.set(n, Number(level));
    }
  }
  return out;
}

/** FR-CMP-05: "At / Beginning at / Starting at Nth level" in the first paragraph, else the table. */
function featureLevel(text: string, name: string, table: Map<string, number>) {
  const first = text.trim().split(/\n\s*\n/)[0] ?? "";
  const m = LEVEL_RE.exec(first);
  if (m) return Number(m[1]);
  return table.get(name.toLowerCase());
}

function features(c: Run, raw: unknown, i: number) {
  const k = parse(c, RawClass, raw, `classes#${i}`);
  if (!k) return;
  const className = classOf(k.name);
  const classSlug = slugify(k.slug);
  if (!className) return c.warn(`feature/${classSlug}`, "className", "Not an SRD class");
  const table = tableLevels(k.table);
  const byKey = new Map<string, EntryDraftOf<"feature">>();
  const order: string[] = [];
  const add = (name: string, rawText: string, subclass?: string, levelHint?: number) => {
    const key = `feature/${classSlug}/${slugify(name)}`;
    const text = toMarkdownLite(rawText);
    const prev = byKey.get(key);
    if (prev) {
      // Same heading twice in one class (Warlock's invocation list): one entry.
      prev.body.text = `${prev.body.text}\n\n${text}`;
      return;
    }
    const level = levelHint ?? featureLevel(rawText, name, table);
    byKey.set(key, {
      kind: "feature",
      name,
      facets: { className, ...(subclass ? { subclass } : {}), ...(level ? { level } : {}) },
      body: { text },
    });
    order.push(key);
  };
  for (const s of splitSections(k.desc, 3).sections) add(s.heading, s.text);
  for (const [j, rawA] of (k.archetypes ?? []).entries()) {
    if (!isSrd(rawA)) {
      c.skipped++;
      continue;
    }
    const a = parse(c, RawArchetype, rawA, `feature/${classSlug}#archetype${j}`);
    if (!a) continue;
    const split = splitSections(a.desc, 5);
    if (nonEmpty(split.intro)) add(a.name.trim(), split.intro, a.name.trim());
    for (const s of split.sections) add(s.heading, s.text, a.name.trim());
  }
  for (const key of order) push(c, { kind: "feature", sourceKey: key, data: byKey.get(key)! });
}

// ---------- entry point ----------

const MAPPERS: Record<Open5eEndpoint, (c: Run, raw: unknown, i: number) => void> = {
  monsters: monster,
  spells: spell,
  magicitems: magicItem,
  weapons: weapon,
  armor,
  conditions: condition,
  classes: features,
};

export function adaptOpen5e(responses: Open5eResponses): AdapterResult {
  const c = new Run();
  for (const endpoint of OPEN5E_ENDPOINTS) {
    for (const [i, raw] of (responses[endpoint] ?? []).entries()) {
      if (isSrd(raw)) MAPPERS[endpoint](c, raw, i);
      else c.skipped++;
    }
  }
  const seen = new Set<string>();
  const records = c.records.filter((r) => {
    if (!seen.has(r.sourceKey)) return seen.add(r.sourceKey);
    c.warn(r.sourceKey, "sourceKey", "Duplicate; later record dropped");
    return false;
  });
  const counts = { monster: 0, spell: 0, item: 0, condition: 0, feature: 0 };
  for (const r of records) counts[r.kind]++;
  return { records, warnings: c.warnings, skipped: c.skipped, counts };
}
