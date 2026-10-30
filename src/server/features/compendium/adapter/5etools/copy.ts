// FR-CMPX-05: `_copy` + `_mod` (and `_templates`) resolved before mapping, recursively, across
// books. Pure. An unknown mode, a missing base or a loop → that record fails; a mod whose target
// isn't there is a note and the record stays. Files are untrusted: mods work on plain JSON copies
// and `__proto__`-style paths are refused.
import { type Ability, abilityMod, SIZES, SKILL_ABILITY } from "@shared/entities/schemas";
import { asNum, asStr, isRaw, nameOf, type Raw, rawList, refKey, sourceOf, strings } from "./raw";

/** Base props a copy takes only if `_preserve` names them (or `*`). */
const NEEDS_PRESERVE = new Set([
  "altArt",
  "basicRules",
  "dragonCastingColor",
  "environment",
  "familiar",
  "hasFluff",
  "hasFluffImages",
  "hasToken",
  "legendaryGroup",
  "otherSources",
  "page",
  "reprintedAs",
  "soundClip",
  "srd",
  "variant",
  "_versions",
]);
/** What a `_mod` key `*` means: every block list and header. */
const STAR_PROPS = [
  "action",
  "bonus",
  "reaction",
  "trait",
  "legendary",
  "mythic",
  "variant",
  "spellcasting",
  "actionHeader",
  "bonusHeader",
  "reactionHeader",
  "legendaryHeader",
  "mythicHeader",
];
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

class CopyError extends Error {}

type Note = (message: string) => void;
type Mode = (out: Raw, prop: string, info: Raw, note: Note) => void;

const toArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
const arrayAt = (out: Raw, prop: string): unknown[] => {
  const v = out[prop];
  return Array.isArray(v) ? v : [];
};
const clone = <T>(v: T): T => structuredClone(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function mapStrings(v: unknown, fn: (s: string) => string): unknown {
  if (typeof v === "string") return fn(v);
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, fn));
  if (isRaw(v)) {
    const out: Raw = {};
    for (const [k, x] of Object.entries(v)) if (!UNSAFE_KEYS.has(k)) out[k] = mapStrings(x, fn);
    return out;
  }
  return v;
}

/** The array index `replace` means: a name, a plain string, `{index}` or `{regex}`. */
function findTarget(list: unknown[], replace: unknown): number {
  if (typeof replace === "string") {
    return list.findIndex((x) => x === replace || (isRaw(x) && x.name === replace));
  }
  if (isRaw(replace)) {
    const index = asNum(replace.index);
    if (index !== undefined) return index < list.length ? index : -1;
    const regex = asStr(replace.regex);
    if (regex !== undefined) {
      const re = new RegExp(regex, asStr(replace.flags) ?? "");
      return list.findIndex((x) => re.test(typeof x === "string" ? x : isRaw(x) ? nameOf(x) : ""));
    }
  }
  return -1;
}

const replaceArr: Mode = (out, prop, info, note) => {
  const list = [...arrayAt(out, prop)];
  const at = findTarget(list, info.replace);
  if (at < 0) return note(`replaceArr: no target in ${prop}`);
  list.splice(at, 1, ...toArray(clone(info.items)));
  out[prop] = list;
};

const removeArr: Mode = (out, prop, info, note) => {
  let list = arrayAt(out, prop);
  for (const name of toArray(info.names)) {
    const next = list.filter((x) => !(x === name || (isRaw(x) && x.name === name)));
    if (next.length === list.length) note(`removeArr: no target in ${prop}`);
    list = next;
  }
  for (const item of toArray(info.items)) {
    const next = list.filter((x) => !same(x, item));
    if (next.length === list.length) note(`removeArr: no target in ${prop}`);
    list = next;
  }
  out[prop] = list;
};

const replaceTxt: Mode = (out, prop, info) => {
  const list = out[prop];
  if (!Array.isArray(list)) return;
  const re = new RegExp(asStr(info.replace) ?? "", `g${asStr(info.flags) ?? ""}`);
  const swap = (s: string) => s.replace(re, asStr(info.with) ?? "");
  const props = Array.isArray(info.props)
    ? info.props
    : [null, "entries", "headerEntries", "footerEntries"];
  out[prop] = list.map((item) => {
    if (typeof item === "string") return props.includes(null) ? swap(item) : item;
    if (!isRaw(item)) return item;
    const next = { ...item };
    for (const p of props) {
      if (typeof p === "string" && next[p] !== undefined) next[p] = mapStrings(next[p], swap);
    }
    return next;
  });
};

function setPath(root: Raw, path: string[], value: unknown) {
  let at = root;
  for (const [i, seg] of path.entries()) {
    if (UNSAFE_KEYS.has(seg)) throw new CopyError(`Refused path segment "${seg}"`);
    if (i === path.length - 1) {
      at[seg] = value;
      return;
    }
    const next = at[seg];
    if (isRaw(next)) at = next;
    else {
      const made: Raw = {};
      at[seg] = made;
      at = made;
    }
  }
}

const setProp: Mode = (out, prop, info) => {
  const path = (asStr(info.prop) ?? "").split(".").filter(Boolean);
  setPath(out, prop === "*" || prop === "_" ? path : [prop, ...path], clone(info.value));
};

function scalarOn(out: Raw, prop: string, info: Raw, apply: (n: number) => number) {
  const target = prop === "_" ? out : out[prop];
  if (!isRaw(target)) return;
  const name = asStr(info.prop) ?? "*";
  for (const k of name === "*" ? Object.keys(target) : [name]) {
    const v = target[k];
    const n = Number(v);
    if (v === undefined || typeof v === "boolean" || isRaw(v) || Number.isNaN(n)) continue;
    const next = apply(n);
    target[k] = typeof v === "string" ? `${next >= 0 ? "+" : ""}${next}` : next;
  }
}

const scalarAddProp: Mode = (out, prop, info) =>
  scalarOn(out, prop, info, (n) => n + (asNum(info.scalar) ?? 0));
const scalarMultProp: Mode = (out, prop, info) =>
  scalarOn(out, prop, info, (n) => {
    const v = n * (asNum(info.scalar) ?? 1);
    return info.floor === true ? Math.floor(v) : v;
  });

const scalarInTags = (tag: "hit" | "dc"): Mode => {
  const re = new RegExp(`\\{@${tag} (-?\\d+)\\}`, "g");
  return (out, prop, info) => {
    const add = asNum(info.scalar) ?? 0;
    out[prop] = mapStrings(out[prop], (s) =>
      s.replace(re, (_, n: string) => `{@${tag} ${Number(n) + add}}`),
    );
  };
};

// ---------- spellcasting ----------

const SPELL_LISTS = ["constant", "will", "ritual"];
const SPELL_FREQS = ["daily", "rest", "weekly", "monthly", "yearly", "recharge", "legendary"];
const firstCaster = (out: Raw) => {
  const sc = rawList(out.spellcasting)[0];
  if (!sc) throw new CopyError("No spellcasting to change");
  return sc;
};

const addSpells: Mode = (out, _prop, info) => {
  const sc = firstCaster(out);
  if (isRaw(info.spells)) {
    const levels: Raw = isRaw(sc.spells) ? sc.spells : {};
    sc.spells = levels;
    for (const [level, add] of Object.entries(info.spells)) {
      if (!isRaw(add)) continue;
      const old = isRaw(levels[level]) ? levels[level] : {};
      levels[level] = { ...old, ...add, spells: [...strings(old.spells), ...strings(add.spells)] };
    }
  }
  for (const k of SPELL_LISTS) {
    if (Array.isArray(info[k])) sc[k] = [...arrayAt(sc, k), ...info[k]];
  }
  for (const k of SPELL_FREQS) {
    const add = info[k];
    if (!isRaw(add)) continue;
    const freq: Raw = isRaw(sc[k]) ? sc[k] : {};
    sc[k] = freq;
    for (const [when, list] of Object.entries(add)) {
      freq[when] = [...arrayAt(freq, when), ...toArray(list)];
    }
  }
};

/** Runs `edit` over each spell list a `{spells, will, daily…}` mod names. */
function eachSpellList(
  sc: Raw,
  info: Raw,
  edit: (list: unknown[], change: unknown[], where: string) => unknown[],
) {
  if (isRaw(info.spells) && isRaw(sc.spells)) {
    for (const [level, change] of Object.entries(info.spells)) {
      const slot = sc.spells[level];
      if (isRaw(slot)) slot.spells = edit(arrayAt(slot, "spells"), toArray(change), level);
    }
  }
  for (const k of SPELL_LISTS) {
    if (Array.isArray(info[k])) sc[k] = edit(arrayAt(sc, k), info[k], k);
  }
  for (const k of SPELL_FREQS) {
    const freq = sc[k];
    if (!isRaw(info[k]) || !isRaw(freq)) continue;
    for (const [when, change] of Object.entries(info[k])) {
      freq[when] = edit(arrayAt(freq, when), toArray(change), `${k}.${when}`);
    }
  }
}

const replaceSpells: Mode = (out, _prop, info, note) => {
  eachSpellList(firstCaster(out), info, (list, change, where) => {
    const next = [...list];
    for (const c of rawList(change)) {
      const at = next.indexOf(c.replace);
      if (at < 0) note(`replaceSpells: no target in ${where}`);
      else next.splice(at, 1, ...toArray(c.with));
    }
    return next;
  });
};

const removeSpells: Mode = (out, _prop, info, note) => {
  eachSpellList(firstCaster(out), info, (list, change, where) => {
    const next = list.filter((s) => !change.includes(s));
    if (next.length === list.length) note(`removeSpells: no target in ${where}`);
    return next;
  });
};

// ---------- derived numbers (templates and `addSkills`) ----------

const crNumber = (out: Raw) => {
  const cr = isRaw(out.cr) ? out.cr.cr : out.cr;
  if (typeof cr !== "string") return 0;
  const [a, b] = cr.split("/");
  return b ? Number(a) / Number(b) : Number(a) || 0;
};
/** Proficiency bonus by CR: 2 up to CR 4, then one more every four. */
const proficiency = (out: Raw) => Math.max(2, Math.ceil(crNumber(out) / 4) + 1);
const modOf = (out: Raw, ability: string) => abilityMod(asNum(out[ability]) ?? 10);
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

const addSkills: Mode = (out, _prop, info) => {
  if (!isRaw(info.skills)) return;
  const skills: Raw = isRaw(out.skill) ? out.skill : {};
  out.skill = skills;
  for (const [skill, times] of Object.entries(info.skills)) {
    const camel = skill.replace(/ (\w)/g, (_, c: string) => c.toUpperCase()) as string;
    const ability = (SKILL_ABILITY as Record<string, Ability | undefined>)[camel];
    if (!ability) continue;
    const total = (asNum(times) ?? 1) * proficiency(out) + modOf(out, ability);
    const old = Number(skills[skill]);
    if (Number.isNaN(old) || old < total) skills[skill] = signed(total);
  }
};

const addSenses: Mode = (out, _prop, info) => {
  const senses = strings(out.senses);
  for (const s of rawList(toArray(info.senses))) {
    const type = asStr(s.type);
    const range = asNum(s.range);
    if (!type || range === undefined) continue;
    const at = senses.findIndex((x) => x.toLowerCase().startsWith(type.toLowerCase()));
    const next = `${type} ${range} ft.`;
    if (at < 0) senses.push(next);
    else if (Number(/(\d+)/.exec(senses[at] ?? "")?.[1] ?? 0) < range) senses[at] = next;
  }
  out.senses = senses;
};

const maxSize: Mode = (out, _prop, info) => {
  const codes = SIZES.map((s) => s.charAt(0).toUpperCase());
  const max = codes.indexOf(asStr(info.max) ?? "");
  if (max < 0) return;
  out.size = strings(out.size).map((s) => (codes.indexOf(s) > max ? (codes[max] ?? s) : s));
};

const prefixSuffix: Mode = (out, _prop, info) => {
  const prop = asStr(info.prop);
  if (!prop || UNSAFE_KEYS.has(prop) || typeof out[prop] !== "string") return;
  out[prop] = `${asStr(info.prefix) ?? ""}${out[prop]}${asStr(info.suffix) ?? ""}`;
};

const MODES: Readonly<Record<string, Mode>> = {
  appendArr: (out, prop, info) => {
    out[prop] = [...arrayAt(out, prop), ...toArray(clone(info.items))];
  },
  prependArr: (out, prop, info) => {
    out[prop] = [...toArray(clone(info.items)), ...arrayAt(out, prop)];
  },
  insertArr: (out, prop, info) => {
    const list = [...arrayAt(out, prop)];
    list.splice(asNum(info.index) ?? list.length, 0, ...toArray(clone(info.items)));
    out[prop] = list;
  },
  appendIfNotExistsArr: (out, prop, info) => {
    const list = [...arrayAt(out, prop)];
    for (const item of toArray(clone(info.items))) {
      if (!list.some((x) => same(x, item))) list.push(item);
    }
    out[prop] = list;
  },
  replaceArr,
  replaceOrAppendArr: (out, prop, info, note) => {
    if (findTarget(arrayAt(out, prop), info.replace) >= 0) replaceArr(out, prop, info, note);
    else out[prop] = [...arrayAt(out, prop), ...toArray(clone(info.items))];
  },
  removeArr,
  replaceTxt,
  setProp,
  scalarAddProp,
  scalarMultProp,
  scalarAddHit: scalarInTags("hit"),
  scalarAddDc: scalarInTags("dc"),
  addSpells,
  replaceSpells,
  removeSpells,
  addSkills,
  addSenses,
  maxSize,
  prefixSuffixStringProp: prefixSuffix,
  // No XP in the creature core.
  scalarMultXp: () => {},
};

function applyMod(out: Raw, prop: string, info: unknown, note: Note) {
  if (info === "remove") {
    delete out[prop];
    return;
  }
  const mode = isRaw(info) ? asStr(info.mode) : undefined;
  const fn = mode !== undefined && Object.hasOwn(MODES, mode) ? MODES[mode] : undefined;
  if (!isRaw(info) || !fn) throw new CopyError(`Unknown _mod mode "${mode ?? String(info)}"`);
  fn(out, prop, info, note);
}

// ---------- `<$…$>` template placeholders ----------

const shortName = (out: Raw, title: boolean) => {
  const short = out.shortName;
  const name = typeof short === "string" ? short : nameOf(out);
  if (out.isNamedCreature === true) return name.split(" ")[0] ?? name;
  return `${title ? "The" : "the"} ${short === true ? name : name.toLowerCase()}`;
};

const PLACEHOLDER = /<\$(\w+?)(?:__([^$]*))?\$>/g;

function placeholder(out: Raw, what: string, arg: string | undefined): string {
  const ability = arg ?? "";
  switch (what) {
    case "name":
      return nameOf(out);
    case "short_name":
      return shortName(out, false);
    case "title_short_name":
      return shortName(out, true);
    case "spell_dc":
      return String(8 + proficiency(out) + modOf(out, ability));
    case "to_hit":
      return signed(proficiency(out) + modOf(out, ability));
    case "damage_mod": {
      const m = modOf(out, ability);
      return m === 0 ? "" : ` ${m > 0 ? "+" : "-"} ${Math.abs(m)}`;
    }
    case "damage_avg": {
      const [dice = "0", abi = ""] = ability.split("+");
      return String(Math.floor(Number(dice) + modOf(out, abi)));
    }
    default:
      return "";
  }
}

// ---------- resolving ----------

function applyCopy(rec: Raw, base: Raw, templates: Map<string, Raw>, note: Note): Raw {
  const meta = rec._copy as Raw;
  const out = clone(rec);
  delete out._copy;
  const preserve = isRaw(meta._preserve) ? meta._preserve : {};
  const mods: [string, unknown][] = isRaw(meta._mod) ? Object.entries(clone(meta._mod)) : [];
  for (const ref of rawList(meta._templates)) {
    const t = templates.get(refKey(nameOf(ref), sourceOf(ref)));
    if (!t) throw new CopyError("Missing template");
    const apply = isRaw(t.apply) ? t.apply : {};
    if (isRaw(apply._root)) {
      for (const [k, v] of Object.entries(apply._root)) {
        if (!UNSAFE_KEYS.has(k) && out[k] === undefined) out[k] = clone(v);
      }
    }
    if (isRaw(apply._mod)) mods.push(...Object.entries(clone(apply._mod)));
  }
  for (const [k, v] of Object.entries(clone(base))) {
    if (UNSAFE_KEYS.has(k) || k === "_copy" || out[k] !== undefined) continue;
    if (NEEDS_PRESERVE.has(k) && !preserve["*"] && !preserve[k]) continue;
    out[k] = v;
  }
  for (const [k, v] of Object.entries(out)) if (v === null) delete out[k];
  for (const [prop, infos] of mods) {
    for (const info of toArray(infos)) {
      if (prop === "*") {
        for (const p of STAR_PROPS) if (out[p] !== undefined) applyMod(out, p, info, note);
      } else applyMod(out, prop, info, note);
    }
  }
  return mapStrings(out, (s) =>
    s.includes("<$")
      ? s.replace(PLACEHOLDER, (_, what: string, arg?: string) => placeholder(out, what, arg))
      : s,
  ) as Raw;
}

export interface CopyFailure {
  name: string;
  source: string;
  message: string;
}

export interface CopyResult {
  /** Input order; failed records left out. */
  records: Raw[];
  failures: CopyFailure[];
  /** Per resolved record's `refKey`: mods that found no target. */
  notes: Map<string, string[]>;
}

/** The `wanted` records' `_copy` resolved; bases may sit in any file (`records` holds them all). */
export function resolveCopies(
  records: readonly Raw[],
  templates: readonly Raw[] = [],
  wanted: (r: Raw) => boolean = () => true,
): CopyResult {
  const byRef = new Map(records.map((r) => [refKey(nameOf(r), sourceOf(r)), r]));
  const tpl = new Map(templates.map((t) => [refKey(nameOf(t), sourceOf(t)), t]));
  const done = new Map<Raw, Raw>();
  const notes = new Map<string, string[]>();

  const resolve = (rec: Raw, path: Set<Raw>): Raw => {
    const hit = done.get(rec);
    if (hit) return hit;
    if (!isRaw(rec._copy)) {
      done.set(rec, rec);
      return rec;
    }
    if (path.has(rec)) throw new CopyError("_copy loop");
    const baseRaw = byRef.get(refKey(nameOf(rec._copy), sourceOf(rec._copy)));
    if (!baseRaw) throw new CopyError("_copy base not found");
    const base = resolve(baseRaw, new Set(path).add(rec));
    const key = refKey(nameOf(rec), sourceOf(rec));
    const out = applyCopy(rec, base, tpl, (m) => notes.set(key, [...(notes.get(key) ?? []), m]));
    done.set(rec, out);
    return out;
  };

  const out: Raw[] = [];
  const failures: CopyFailure[] = [];
  for (const rec of records) {
    if (!wanted(rec)) continue;
    try {
      out.push(resolve(rec, new Set()));
    } catch (e) {
      if (!(e instanceof CopyError || e instanceof SyntaxError || e instanceof TypeError)) throw e;
      failures.push({ name: nameOf(rec), source: sourceOf(rec), message: e.message });
    }
  }
  return { records: out, failures, notes };
}
