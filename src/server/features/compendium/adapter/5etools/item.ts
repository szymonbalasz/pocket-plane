// FR-CMPX-10: `items.json` + base items + generic variants ("+1 Weapon", not expanded) + item
// groups (one entry each) → `item` entries. Pure.
import {
  ENTRY_TEXT_MAX,
  type EntryDraftOf,
  NAME_MAX,
  SHORT_TEXT_MAX,
} from "@shared/compendium/schemas";
import { slugify } from "../text";
import { asNum, asStr, isRaw, nameOf, type Raw, rawList, refKey, strings } from "./raw";
import type { Run } from "./run";
import { entriesToMarkdown, renderTags, type Warn } from "./text";

const TYPE_LABEL: Readonly<Record<string, string>> = {
  $A: "Treasure (art object)",
  $C: "Treasure (coinage)",
  $G: "Treasure (gemstone)",
  A: "Ammunition",
  AF: "Ammunition",
  AIR: "Airship",
  AT: "Artisan's tools",
  EM: "Eldritch machine",
  EXP: "Explosive",
  FD: "Food and drink",
  G: "Adventuring gear",
  GS: "Gaming set",
  GV: "Generic variant",
  HA: "Heavy armor",
  INS: "Instrument",
  LA: "Light armor",
  M: "Melee weapon",
  MA: "Medium armor",
  MNT: "Mount",
  OTH: "Other",
  P: "Potion",
  R: "Ranged weapon",
  RD: "Rod",
  RG: "Ring",
  S: "Shield",
  SC: "Scroll",
  SCF: "Spellcasting focus",
  SHP: "Vehicle (water)",
  SPC: "Vehicle (space)",
  T: "Tools",
  TAH: "Tack and harness",
  TG: "Trade good",
  VEH: "Vehicle (land)",
  WD: "Wand",
};
const PROPERTY: Readonly<Record<string, string>> = {
  "2H": "two-handed",
  A: "ammunition",
  AF: "ammunition (futuristic)",
  BF: "burst fire",
  F: "finesse",
  H: "heavy",
  L: "light",
  LD: "loading",
  R: "reach",
  RLD: "reload",
  S: "special",
  T: "thrown",
  V: "versatile",
  Vst: "vestige",
};
const DAMAGE_TYPE: Readonly<Record<string, string>> = {
  A: "acid",
  B: "bludgeoning",
  C: "cold",
  F: "fire",
  L: "lightning",
  N: "necrotic",
  O: "force",
  P: "piercing",
  R: "radiant",
  S: "slashing",
  T: "thunder",
  Y: "psychic",
  I: "poison",
};
/** What a magic item inherits from its `baseItem` when it doesn't say. */
const FROM_BASE = [
  "type",
  "weaponCategory",
  "dmg1",
  "dmg2",
  "dmgType",
  "property",
  "range",
  "ac",
  "strength",
  "stealth",
  "weight",
];

export const typeCode = (v: unknown) => (asStr(v) ?? "").split("|")[0] ?? "";

/** Category from the type code, in the spec's order (FR-CMPX-10). */
function categoryOf(code: string, rarity: string): EntryDraftOf<"item">["facets"]["category"] {
  if (code === "M" || code === "R") return "weapon";
  if (["LA", "MA", "HA", "S"].includes(code)) return "armor";
  return rarity && rarity !== "none" && rarity !== "unknown" ? "magic" : "gear";
}

function typeLabel(i: Raw, code: string) {
  if (code === "M" || code === "R") {
    const cat = asStr(i.weaponCategory);
    const kind = code === "M" ? "melee weapon" : "ranged weapon";
    return cat ? `${cat.charAt(0).toUpperCase()}${cat.slice(1)} ${kind}` : TYPE_LABEL[code];
  }
  if (TYPE_LABEL[code]) return TYPE_LABEL[code];
  if (i.wondrous === true) return i.tattoo === true ? "Wondrous item (tattoo)" : "Wondrous item";
  if (i.staff === true) return "Staff";
  if (i.poison === true) return "Poison";
  return "Item";
}

/** A variant's "any …": `requires` as words. */
function requiresLabel(i: Raw) {
  const words = rawList(i.requires).flatMap((r) => {
    if (r.weapon === true) return ["weapon"];
    if (r.armor === true) return ["armor"];
    const code = typeCode(r.type);
    if (code && TYPE_LABEL[code]) return [TYPE_LABEL[code].toLowerCase()];
    const named = Object.keys(r).find((k) => r[k] === true);
    return named ? [named] : [];
  });
  const unique = [...new Set(words)];
  return unique.length > 0 ? `Any ${unique.join(" or ")}` : "Generic variant";
}

function attunementNote(i: Raw) {
  const a = i.reqAttune;
  if (a === true) return "requires attunement";
  if (a === "optional") return "attunement optional";
  return typeof a === "string" ? `requires attunement ${renderTags(a)}` : undefined;
}

function costText(i: Raw) {
  const cp = asNum(i.value);
  if (cp === undefined) return undefined;
  if (cp >= 100 && cp % 100 === 0) return `${cp / 100} gp`;
  if (cp >= 10 && cp % 10 === 0) return `${cp / 10} sp`;
  return `${cp} cp`;
}

function damageText(i: Raw) {
  const dice = asStr(i.dmg1) ?? asNum(i.dmg1)?.toString();
  if (!dice) return undefined;
  const type = DAMAGE_TYPE[asStr(i.dmgType) ?? ""];
  return [dice, type].filter(Boolean).join(" ");
}

function propertiesText(i: Raw) {
  const out = (Array.isArray(i.property) ? i.property : []).flatMap((p) => {
    const code = isRaw(p) ? asStr(p.uid) : asStr(p);
    const label = PROPERTY[(code ?? "").split("|")[0] ?? ""];
    if (!label) return [];
    if (label === "versatile" && i.dmg2) return [`versatile (${String(i.dmg2)})`];
    if (label === "ammunition" || label === "thrown") {
      return i.range ? [`${label} (range ${String(i.range)})`] : [label];
    }
    return [label];
  });
  return out.join(", ") || undefined;
}

function acText(i: Raw, code: string) {
  const ac = asNum(i.ac);
  if (ac === undefined) return undefined;
  if (code === "S") return `+${ac}`;
  if (code === "LA") return `${ac} + Dex modifier`;
  if (code === "MA") {
    const max = i.dexterityMax === undefined ? 2 : asNum(i.dexterityMax);
    return max === undefined ? `${ac} + Dex modifier` : `${ac} + Dex modifier (max ${max})`;
  }
  return String(ac);
}

function armorNotes(i: Raw) {
  const str = i.strength;
  return [
    typeof str === "string" || typeof str === "number" ? `Requires Strength ${str}.` : "",
    i.stealth === true ? "Disadvantage on Dexterity (Stealth) checks." : "",
  ].filter(Boolean);
}

const TEMPLATE_VAR = /\{=(\w+)(?:\/(\w+))?\}/g;

/** A variant's `{=bonusWeapon}` / `{=baseName/l}`: not expanded, so "the weapon" stands in. */
function fillVariantVars(v: unknown, i: Raw): unknown {
  if (typeof v === "string") {
    return v.replace(TEMPLATE_VAR, (_, name: string, mod?: string) => {
      if (name === "baseName") {
        const word = i.__base === "armor" ? "armor" : i.__base === "item" ? "item" : "weapon";
        if (mod === "a" || mod === "at") return word === "armor" ? word : `a ${word}`;
        return word;
      }
      if (name === "dmgType") return "the weapon's";
      const value = i[name];
      return typeof value === "string" || typeof value === "number" ? String(value) : "";
    });
  }
  if (Array.isArray(v)) return v.map((x) => fillVariantVars(x, i));
  if (isRaw(v)) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillVariantVars(x, i)]));
  }
  return v;
}

const ITEM_ENTRY = /^\{#itemEntry ([^|}]+)(?:\|([^}]*))?\}$/;
const ENTRY_VAR = /\{\{item\.(\w+)\}\}/g;

/** `{#itemEntry name|source}` → that shared text, its `{{item.x}}` filled from this item. */
function expandItemEntries(v: unknown, i: Raw, shared: ReadonlyMap<string, Raw>): unknown {
  if (!Array.isArray(v)) return v;
  return v.flatMap((e) => {
    const m = typeof e === "string" ? ITEM_ENTRY.exec(e) : null;
    if (!m) return [e];
    const t = shared.get(refKey(m[1] ?? "", m[2] ?? ""));
    if (!t) return [];
    return strings(t.entriesTemplate).map((s) =>
      s.replace(ENTRY_VAR, (_, k: string) => {
        const x = i[k];
        return Array.isArray(x) ? strings(x).join(" and ") : typeof x === "string" ? x : "";
      }),
    );
  });
}

export interface ItemEnv {
  bases: ReadonlyMap<string, Raw>;
  shared: ReadonlyMap<string, Raw>;
  replaces: (kind: "item", record: Raw) => string[];
}

function withBase(i: Raw, bases: ReadonlyMap<string, Raw>) {
  const ref = asStr(i.baseItem);
  if (!ref) return i;
  const [name = "", source = ""] = ref.split("|");
  const base = bases.get(refKey(name, source));
  if (!base) return i;
  const out = { ...i };
  for (const k of FROM_BASE) if (out[k] === undefined && base[k] !== undefined) out[k] = base[k];
  return out;
}

function pushItem(
  c: Run,
  i: Raw,
  env: ItemEnv,
  shape: { typeLine: string; extraText?: string[]; entries: unknown },
) {
  const rawName = nameOf(i).trim();
  const key = `item/${slugify(rawName)}`;
  const warn: Warn = (field, message) => c.warn(key, field, message);
  const code = typeCode(i.type);
  const rarity = (asStr(i.rarity) ?? "").toLowerCase();
  const att = attunementNote(i);
  const text = [
    entriesToMarkdown(expandItemEntries(shape.entries, i, env.shared), warn),
    entriesToMarkdown(i.additionalEntries, warn),
    ...(shape.extraText ?? []),
    armorNotes(i).join(" "),
  ]
    .filter(Boolean)
    .join("\n\n");
  const line = att ? `${shape.typeLine} (${att})` : shape.typeLine;
  const optional = (field: string, v: string | undefined) =>
    v ? { [field]: c.clip(key, `body.${field}`, v, SHORT_TEXT_MAX) } : {};
  const replaces = env.replaces("item", i);
  c.push({
    kind: "item",
    sourceKey: key,
    data: {
      kind: "item",
      name: c.clip(key, "name", rawName, NAME_MAX),
      facets: {
        category: categoryOf(code, rarity),
        ...(rarity && rarity !== "none" && rarity !== "unknown" ? { rarity } : {}),
        attunement: i.reqAttune !== undefined && i.reqAttune !== false,
      },
      body: {
        typeLine: c.clip(key, "body.typeLine", line, SHORT_TEXT_MAX),
        ...optional("cost", costText(i)),
        ...optional("weight", asNum(i.weight) === undefined ? undefined : `${asNum(i.weight)} lb.`),
        ...optional("damage", damageText(i)),
        ...optional("properties", propertiesText(i)),
        ...optional("ac", acText(i, code)),
        text: c.clip(key, "body.text", text, ENTRY_TEXT_MAX),
      },
    },
    ...(replaces.length > 0 ? { replaces } : {}),
  } as Parameters<Run["push"]>[0]);
}

/** A row of `items.json` or `items-base.json`. */
export function mapItem(c: Run, raw: Raw, env: ItemEnv) {
  const i = withBase(raw, env.bases);
  pushItem(c, i, env, {
    typeLine: typeLabel(i, typeCode(i.type)) ?? "Item",
    entries: i.entries,
  });
}

/** A generic variant, flattened by `readFolder` (its `inherits` on top), as one entry. */
export function mapVariant(c: Run, v: Raw, env: ItemEnv) {
  const base = rawList(v.requires).some((r) => r.armor === true || /A$/.test(typeCode(r.type)))
    ? "armor"
    : rawList(v.requires).some((r) => r.weapon === true || r.sword === true || r.axe === true)
      ? "weapon"
      : "item";
  const filled = { ...v, __base: base };
  pushItem(c, { ...v, type: "GV" }, env, {
    typeLine: requiresLabel(v),
    entries: fillVariantVars(v.entries, filled),
  });
}

/** An item group: its own text, plus the members' names when it has none of its own. */
export function mapGroup(c: Run, g: Raw, env: ItemEnv) {
  const members = strings(g.items).map((m) => m.split("|")[0] ?? m);
  pushItem(c, withBase(g, env.bases), env, {
    typeLine: typeLabel(g, typeCode(g.type)) ?? "Item",
    entries: g.entries,
    extraText: members.length > 0 ? [`Includes: ${members.join(", ")}.`] : [],
  });
}
