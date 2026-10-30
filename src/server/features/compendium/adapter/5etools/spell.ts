// FR-CMPX-09: a 5etools spell → `spell` entry. Classes outside the SRD twelve are dropped with a
// warning (OQ-CMPX-06 A). Pure.
import {
  ENTRY_TEXT_MAX,
  type EntryDraftOf,
  MATERIAL_MAX,
  NAME_MAX,
  SHORT_TEXT_MAX,
  SRD_CLASSES,
  type SrdClass,
} from "@shared/compendium/schemas";
import { slugify } from "../text";
import { asNum, asStr, isRaw, nameOf, type Raw, rawList, sourceOf } from "./raw";
import type { Run } from "./run";
import { entriesToMarkdown, renderTags, type Warn } from "./text";

const SCHOOLS: Readonly<Record<string, EntryDraftOf<"spell">["facets"]["school"]>> = {
  A: "abjuration",
  C: "conjuration",
  D: "divination",
  E: "enchantment",
  V: "evocation",
  I: "illusion",
  N: "necromancy",
  T: "transmutation",
};

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

function castingTime(time: unknown) {
  return rawList(time)
    .map((t) => {
      const n = asNum(t.number) ?? 1;
      const unit = asStr(t.unit) ?? "";
      const label = plural(n, unit === "bonus" ? "bonus action" : unit);
      const cond = asStr(t.condition);
      return cond ? `${label}, ${renderTags(cond)}` : label;
    })
    .join(" or ");
}

function rangeText(range: unknown) {
  if (!isRaw(range)) return "";
  const dist = isRaw(range.distance) ? range.distance : {};
  const unit = asStr(dist.type) ?? "";
  const amount = asNum(dist.amount);
  const words =
    amount === undefined ? "" : `${amount} ${amount === 1 ? unit.replace(/s$/, "") : unit}`;
  switch (range.type) {
    case "point":
      if (unit === "self") return "Self";
      if (unit === "touch") return "Touch";
      if (unit === "sight") return "Sight";
      if (unit === "unlimited") return "Unlimited";
      return words;
    case "special":
      return "Special";
    case "radius":
    case "sphere":
    case "cone":
    case "line":
    case "cube":
    case "hemisphere":
    case "emanation":
      return `Self (${amount ?? ""}-${unit.replace(/s$/, "").replace("feet", "foot")} ${range.type})`;
    default:
      return asStr(range.type) ?? "";
  }
}

function componentsText(c: unknown) {
  if (!isRaw(c)) return { components: "", material: undefined };
  const letters = [c.v ? "V" : "", c.s ? "S" : "", c.m ? "M" : "", c.r ? "R" : ""].filter(Boolean);
  const m = c.m;
  const material = typeof m === "string" ? m : isRaw(m) ? asStr(m.text) : undefined;
  return { components: letters.join(", "), material: material && renderTags(material) };
}

function durationText(duration: unknown) {
  return rawList(duration)
    .map((d) => {
      if (d.type === "instant") return "Instantaneous";
      if (d.type === "permanent") {
        const ends = Array.isArray(d.ends) ? d.ends : [];
        const words = ends.map((e) =>
          e === "dispel" ? "dispelled" : e === "trigger" ? "triggered" : "",
        );
        const until = words.filter(Boolean).join(" or ");
        return until ? `Until ${until}` : "Permanent";
      }
      if (d.type === "special") return "Special";
      const t = isRaw(d.duration) ? d.duration : {};
      const span = plural(asNum(t.amount) ?? 1, asStr(t.type) ?? "");
      if (d.concentration === true) return `Concentration, up to ${span}`;
      return t.upTo === true ? `Up to ${span}` : span;
    })
    .join(" or ");
}

/** `spells/sources.json`: book → spell name → `{class, classVariant}`. */
export type SpellClassLookup = Readonly<Record<string, unknown>>;

function classesOf(c: Run, key: string, s: Raw, lookup: SpellClassLookup) {
  const book = lookup[sourceOf(s)];
  const row = isRaw(book) ? book[nameOf(s)] : undefined;
  if (!isRaw(row)) return [];
  const out = new Set<SrdClass>();
  for (const k of rawList(row.class).concat(rawList(row.classVariant))) {
    const name = asStr(k.name)?.trim().toLowerCase() ?? "";
    const srd = SRD_CLASSES.find((x) => x.toLowerCase() === name);
    if (srd) out.add(srd);
    else c.warn(key, "classes", `"${asStr(k.name) ?? ""}" isn't an SRD class; dropped`);
  }
  return [...out].sort();
}

const short = (c: Run, key: string, field: string, s: string) =>
  c.clip(key, field, s, SHORT_TEXT_MAX);

export function mapSpell(
  c: Run,
  s: Raw,
  env: { classes: SpellClassLookup; replaces: (kind: "spell", record: Raw) => string[] },
) {
  const rawName = nameOf(s).trim();
  const key = `spell/${slugify(rawName)}`;
  const warn: Warn = (field, message) => c.warn(key, field, message);
  const school = SCHOOLS[asStr(s.school) ?? ""];
  const level = asNum(s.level);
  if (!school || level === undefined) {
    return c.skip(key, "facets", "Unknown school or level");
  }
  const { components, material } = componentsText(s.components);
  const durations = rawList(s.duration);
  const meta = isRaw(s.meta) ? s.meta : {};
  // The field's own "At Higher Levels" name is the view's label (as Open5e's `higher_level`).
  const higher = rawList(s.entriesHigherLevel).flatMap((e) =>
    e.entries === undefined ? [] : [entriesToMarkdown(e.entries, warn)],
  );
  const higherLevel = higher.join("\n\n");
  const replaces = env.replaces("spell", s);
  c.push({
    kind: "spell",
    sourceKey: key,
    data: {
      kind: "spell",
      name: c.clip(key, "name", rawName, NAME_MAX),
      facets: {
        level,
        school,
        classes: classesOf(c, key, s, env.classes),
        concentration: durations.some((d) => d.concentration === true),
        ritual: meta.ritual === true,
      },
      body: {
        castingTime: short(c, key, "body.castingTime", castingTime(s.time)),
        range: short(c, key, "body.range", rangeText(s.range)),
        components: short(c, key, "body.components", components),
        ...(material ? { material: c.clip(key, "body.material", material, MATERIAL_MAX) } : {}),
        duration: short(c, key, "body.duration", durationText(s.duration)),
        text: c.clip(key, "body.text", entriesToMarkdown(s.entries, warn), ENTRY_TEXT_MAX),
        ...(higherLevel
          ? { higherLevel: c.clip(key, "body.higherLevel", higherLevel, ENTRY_TEXT_MAX) }
          : {}),
      },
    },
    ...(replaces.length > 0 ? { replaces } : {}),
  });
}
