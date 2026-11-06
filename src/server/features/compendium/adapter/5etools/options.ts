// FR-CMPX-30–33: 5etools character options → reference entries: feats, races (subraces merged
// with their race, "Elf (High)"), backgrounds, class options (`optionalfeatures.json`). Text first:
// the facts a card shows (prerequisite, ability scores, size, speed) and the entries as
// markdown-lite. Nothing here is automated on a sheet. Pure.
import {
  ENTRY_TEXT_MAX,
  NAME_MAX,
  type OPTION_TYPES,
  SHORT_TEXT_MAX,
} from "@shared/compendium/schemas";
import { slugify } from "../text";
import { asNum, asStr, isRaw, nameOf, type Raw, rawList, sourceOf, strings } from "./raw";
import type { Run } from "./run";
import { entriesToMarkdown, renderTags, type Warn } from "./text";

type OptionKind = "feat" | "race" | "background" | "option";
export type Replaces = (kind: OptionKind, record: Raw) => string[];

const ABILITY: Readonly<Record<string, string>> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};
const ABILITY_KEYS = Object.keys(ABILITY);
const abbr = (k: string) => (ABILITY[k] ? k.charAt(0).toUpperCase() + k.slice(1) : k);
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const titleCase = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six"];
const count = (n: number) => NUMBER_WORDS[n] ?? String(n);

function ordinal(n: number) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

// ---------- ability scores ----------

/** `{from, count?, amount?}` → "+1 to one of Str, Dex"; all six → "+1 to any one". */
function chooseText(choose: Raw): string {
  const weighted = isRaw(choose.weighted) ? choose.weighted : null;
  if (weighted) {
    const weights = Array.isArray(weighted.weights)
      ? weighted.weights.filter((w): w is number => typeof w === "number")
      : [];
    return weights.length > 0
      ? `${weights.map(signed).join(" and ")} to different scores of your choice`
      : "Scores of your choice";
  }
  const from = strings(choose.from);
  const n = asNum(choose.count) ?? 1;
  const amount = asNum(choose.amount) ?? 1;
  const which =
    from.length === 0 || ABILITY_KEYS.every((k) => from.includes(k))
      ? `any ${count(n)}`
      : n === 1
        ? from.map(abbr).join(" or ")
        : `${count(n)} of ${from.map(abbr).join(", ")}`;
  return `${signed(amount)} to ${which}`;
}

function abilityObject(a: Raw): string {
  const parts: string[] = [];
  for (const k of ABILITY_KEYS) {
    const n = asNum(a[k]);
    if (n !== undefined) parts.push(`${abbr(k)} ${signed(n)}`);
  }
  if (isRaw(a.choose)) parts.push(chooseText(a.choose));
  return parts.join(", ");
}

/** 5etools `ability` (a list of alternatives) → "Dex +2, Int +1"; VRGR lineage → its rule. */
export function abilityText(ability: unknown, lineage?: unknown): string | undefined {
  const alts = rawList(ability).map(abilityObject).filter(Boolean);
  if (alts.length > 0) return alts.join("; or ");
  if (lineage !== undefined && lineage !== false) {
    return "+2 to one score and +1 to another, or +1 to three scores";
  }
  return undefined;
}

/** Race + subrace ability lists → one: fixed scores add, a choice is kept (FR-CMPX-32). */
function mergeAbility(race: unknown, sub: unknown, overwrite: boolean): unknown {
  const r = rawList(race);
  const s = rawList(sub);
  if (overwrite || r.length === 0) return s.length > 0 ? s : r;
  if (s.length === 0) return r;
  if (r.length !== 1 || s.length !== 1) return s;
  const out: Raw = { ...(r[0] as Raw) };
  for (const [k, v] of Object.entries(s[0] as Raw)) {
    const prev = asNum(out[k]);
    out[k] = prev !== undefined && typeof v === "number" ? prev + v : v;
  }
  return [out];
}

// ---------- prerequisites ----------

function levelPart(v: unknown): string {
  const n = asNum(v);
  if (n !== undefined) return `${ordinal(n)} level`;
  if (!isRaw(v)) return "";
  const level = asNum(v.level);
  const cls = isRaw(v.class) ? asStr(v.class.name) : undefined;
  const sub = isRaw(v.subclass) ? asStr(v.subclass.name) : undefined;
  const who = [cls, sub ? `(${sub})` : undefined].filter(Boolean).join(" ");
  if (level === undefined) return who;
  return who ? `${ordinal(level)}-level ${who}` : `${ordinal(level)} level`;
}

const refName = (ref: string) =>
  titleCase(renderTags(ref.split("|")[2] || ref.split("|")[0] || ""));

function spellPart(ref: string) {
  const [name = "", mark] = ref.split("#");
  const shown = titleCase(name.split("/")[0] ?? name);
  return mark === "c" ? `${shown} cantrip` : `${shown} spell`;
}

function proficiencyPart(p: Raw): string {
  return Object.entries(p)
    .map(([k, v]) => {
      const what = typeof v === "string" ? v : "";
      if (k === "armor") return `${what} armor`;
      if (k === "weapon") return `${what} weapons`;
      if (k === "weaponGroup") return `${what} weapons`;
      return what || k;
    })
    .join(" and ");
}

/** One prerequisite object (all its parts apply) → words; unknown parts are named, not dropped. */
function prerequisitePart(p: Raw, warn: Warn): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(p)) {
    switch (k) {
      case "level":
        out.push(levelPart(v));
        break;
      case "race":
        out.push(
          rawList(v)
            .map((r) => {
              const name = titleCase(asStr(r.name) ?? "");
              const sub = asStr(r.subrace);
              return sub ? `${name} (${titleCase(sub)})` : name;
            })
            .join(" or "),
        );
        break;
      case "ability":
        out.push(
          rawList(v)
            .map((a) =>
              Object.entries(a)
                .map(([s, n]) => `${ABILITY[s] ?? s} ${String(n)} or higher`)
                .join(" and "),
            )
            .join(" or "),
        );
        break;
      case "spellcasting":
      case "spellcasting2020":
        if (v === true) out.push("The ability to cast at least one spell");
        break;
      case "spellcastingFeature":
        if (v === true) out.push("Spellcasting or Pact Magic feature");
        break;
      case "spellcastingPrepared":
        if (v === true) out.push("Spellcasting feature with prepared spells");
        break;
      case "psionics":
        if (v === true) out.push("Psionic Talent feature or Wild Talent feat");
        break;
      case "proficiency":
        out.push(
          rawList(v)
            .map((x) => `Proficiency with ${proficiencyPart(x)}`)
            .join(" or "),
        );
        break;
      case "feat":
        out.push(`${strings(v).map(refName).join(" or ")} feat`);
        break;
      case "background":
        out.push(
          `${rawList(v)
            .map((b) => titleCase(asStr(b.name) ?? ""))
            .join(" or ")} background`,
        );
        break;
      case "spell":
        out.push(strings(v).map(spellPart).join(" or "));
        break;
      case "item":
        out.push(strings(v).map(renderTags).join(" or "));
        break;
      case "pact":
        if (typeof v === "string") out.push(`Pact of the ${v}`);
        break;
      case "patron":
        if (typeof v === "string") out.push(`${v} patron`);
        break;
      case "campaign":
        out.push(`${strings(v).join(" or ")} campaign`);
        break;
      case "other":
        if (typeof v === "string") out.push(renderTags(v));
        break;
      case "otherSummary":
        if (isRaw(v) && typeof v.entry === "string") out.push(renderTags(v.entry));
        break;
      case "note":
        break;
      default:
        warn("prerequisite", `"${k}" not understood; left out`);
    }
  }
  return out.filter(Boolean).join(", ");
}

/** `prerequisite` (a list of alternatives) → "Dexterity 13 or higher"; none → undefined. */
export function prerequisiteText(pre: unknown, warn: Warn): string | undefined {
  const alts = rawList(pre)
    .map((p) => prerequisitePart(p, warn))
    .filter(Boolean);
  return alts.length > 0 ? alts.join("; or ") : undefined;
}

// ---------- size and speed ----------

const SIZES: Readonly<Record<string, string>> = {
  T: "Tiny",
  S: "Small",
  M: "Medium",
  L: "Large",
  H: "Huge",
  G: "Gargantuan",
  V: "Varies",
};

export function sizeText(size: unknown): string | undefined {
  const words = strings(size).map((s) => SIZES[s] ?? s);
  return words.length > 0 ? words.join(" or ") : undefined;
}

export function speedText(speed: unknown): string | undefined {
  const n = asNum(speed);
  if (n !== undefined) return `${n} ft.`;
  if (!isRaw(speed)) return undefined;
  const walk = asNum(speed.walk);
  const parts = walk !== undefined ? [`${walk} ft.`] : [];
  for (const mode of ["burrow", "climb", "fly", "swim"]) {
    const v = speed[mode];
    const m = asNum(v);
    if (m !== undefined) parts.push(`${mode} ${m} ft.`);
    else if (v === true) parts.push(`${mode} equal to your walking speed`);
  }
  return parts.length > 0 ? parts.join(", ") : undefined;
}

// ---------- the records ----------

const OPTION_TYPE_OF: Readonly<Record<string, (typeof OPTION_TYPES)[number]>> = {
  EI: "Eldritch Invocation",
  MM: "Metamagic",
  AI: "Artificer Infusion",
  AS: "Arcane Shot",
  ED: "Elemental Discipline",
  RN: "Rune",
  PB: "Pact Boon",
};

/** `featureType` code → the filter's type: `FS:*` fighting styles, `MV:*` maneuvers. */
export function optionType(code: string): (typeof OPTION_TYPES)[number] {
  if (code.startsWith("FS:")) return "Fighting Style";
  if (code.startsWith("MV")) return "Maneuver";
  return OPTION_TYPE_OF[code] ?? "Other";
}

interface Common {
  c: Run;
  kind: OptionKind;
  name: string;
  raw: Raw;
  replaces: Replaces;
}

function begin(c: Run, kind: OptionKind, rawName: string) {
  const name = rawName.trim();
  const key = `${kind}/${slugify(name)}`;
  const warn: Warn = (field, message) => c.warn(key, field, message);
  return { name, key, warn };
}

const short = (c: Run, key: string, field: string, s: string | undefined) =>
  s ? { [field]: c.clip(key, `body.${field}`, s, SHORT_TEXT_MAX) } : {};

function push(
  { c, kind, name, raw, replaces }: Common,
  key: string,
  facets: Record<string, unknown>,
  body: Record<string, unknown>,
) {
  const refs = replaces(kind, raw);
  c.push({
    kind,
    sourceKey: key,
    // zod checks the shape in `push` (FR-CMPX-11): a record that doesn't fit is skipped there.
    data: { kind, name: c.clip(key, "name", name, NAME_MAX), facets, body } as never,
    ...(refs.length > 0 ? { replaces: refs } : {}),
  });
}

/** FR-CMPX-31: a feat; its ability increase leads the text. */
export function mapFeat(c: Run, f: Raw, replaces: Replaces) {
  const { name, key, warn } = begin(c, "feat", nameOf(f));
  const asi = abilityText(f.ability);
  const text = [
    asi ? `**Ability Score Increase.** ${asi} (to a maximum of 20).` : "",
    entriesToMarkdown(f.entries, warn),
  ]
    .filter(Boolean)
    .join("\n\n");
  push(
    { c, kind: "feat", name, raw: f, replaces },
    key,
    {},
    {
      ...short(c, key, "prerequisite", prerequisiteText(f.prerequisite, warn)),
      text: c.clip(key, "body.text", text, ENTRY_TEXT_MAX),
    },
  );
}

/** FR-CMPX-33: a background, its entries as they are (proficiencies list, feature, tables). */
export function mapBackground(c: Run, b: Raw, replaces: Replaces) {
  const { name, key, warn } = begin(c, "background", nameOf(b));
  push(
    { c, kind: "background", name, raw: b, replaces },
    key,
    {},
    { text: c.clip(key, "body.text", entriesToMarkdown(b.entries, warn), ENTRY_TEXT_MAX) },
  );
}

/** FR-CMPX-33: a class option (`optionalfeature`), typed for the filter. */
export function mapOption(c: Run, o: Raw, replaces: Replaces) {
  const { name, key, warn } = begin(c, "option", nameOf(o));
  const codes = strings(o.featureType);
  const types = [...new Set(codes.map(optionType))];
  push(
    { c, kind: "option", name, raw: o, replaces },
    key,
    { types: types.length > 0 ? types : ["Other"] },
    {
      ...short(c, key, "prerequisite", prerequisiteText(o.prerequisite, warn)),
      text: c.clip(key, "body.text", entriesToMarkdown(o.entries, warn), ENTRY_TEXT_MAX),
    },
  );
}

/** A trait an `overwrite`-tagged subrace entry replaces, by name (5etools merge). */
const overwriteOf = (e: unknown) =>
  isRaw(e) && isRaw(e.data) ? asStr(e.data.overwrite) : undefined;

/** Race + subrace → one race (5etools' merge, FR-CMPX-32): traits in order, overwrites in place. */
export function mergeSubrace(race: Raw, sub: Raw): Raw {
  const overwrite = isRaw(sub.overwrite) ? sub.overwrite : {};
  const entries = Array.isArray(race.entries) ? [...race.entries] : [];
  for (const e of Array.isArray(sub.entries) ? sub.entries : []) {
    const target = overwriteOf(e);
    const at = target
      ? entries.findIndex((x) => isRaw(x) && asStr(x.name)?.toLowerCase() === target.toLowerCase())
      : -1;
    if (at >= 0) entries[at] = e;
    else entries.push(e);
  }
  return {
    ...race,
    ability: mergeAbility(race.ability, sub.ability, overwrite.ability === true),
    ...(sub.speed !== undefined ? { speed: sub.speed } : {}),
    ...(sub.size !== undefined ? { size: sub.size } : {}),
    entries,
  };
}

/** FR-CMPX-32: a race (or a race merged with a subrace, `parent` set). */
export function mapRace(c: Run, r: Raw, replaces: Replaces, sub?: { parent: string; raw: Raw }) {
  const { name, key, warn } = begin(c, "race", nameOf(r));
  push(
    { c, kind: "race", name, raw: sub?.raw ?? r, replaces },
    key,
    sub ? { parent: c.clip(key, "facets.parent", sub.parent, NAME_MAX) } : {},
    {
      ...short(c, key, "abilities", abilityText(r.ability, r.lineage)),
      ...short(c, key, "size", sizeText(r.size)),
      ...short(c, key, "speed", speedText(r.speed)),
      text: c.clip(key, "body.text", entriesToMarkdown(r.entries, warn), ENTRY_TEXT_MAX),
    },
  );
}

/** "Elf (High)": a subrace's entry name; its own `name` may be absent (then it folds in). */
export const subraceName = (s: Raw) => `${asStr(s.raceName) ?? ""} (${nameOf(s).trim()})`;

/** The race a subrace belongs to. */
export const subraceParent = (s: Raw) => ({
  name: asStr(s.raceName) ?? "",
  source: asStr(s.raceSource) ?? sourceOf(s),
});
