// 5etools adapter (compendium-expansion X1, ADR-0074, ADR-0015): the DM's own extracted folder →
// book list and per-book import records. The server maps a source key to files itself; nothing
// here takes a path from a client. Bump `ADAPTER_VERSION_5ET` on any mapping change (FR-CMPX-03).
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  type CompendiumKind,
  entryNameKey,
  NAME_MAX,
  REPLACES_MAX,
  ReplacedRef,
} from "@shared/compendium/schemas";
import { bundledSource } from "../../sources";
import { slugify } from "../text";
import { type CopyResult, resolveCopies } from "./copy";
import { mapGroup, mapItem, mapVariant } from "./item";
import { mapMonster } from "./monster";
import { asStr, isRaw, nameOf, type Raw, rawList, refKey, sourceOf } from "./raw";
import {
  type BookLabels,
  type FolderData,
  FolderError,
  type ReadText,
  readFolder,
  readFromDir,
  readLabels,
} from "./read";
import { clipTo, type FiveEtoolsResult, Run } from "./run";
import { mapSpell } from "./spell";

export { tokenPath } from "./art";
export { FolderError } from "./read";
export type { FiveEtoolsResult } from "./run";

export const ADAPTER_VERSION_5ET = "2";
export const SRD_SOURCE_KEY = "srd-5.1";

type BookKind = Extract<CompendiumKind, "monster" | "spell" | "item">;

/** FR-CMPX-02: `5et-<abbr lower>`. */
export const bookKey = (abbr: string) => `5et-${abbr.toLowerCase()}`;

/** FR-CMPX-03: SHA-256 of the release + the mapping's version; no 90 MB hash. */
export const bookVersion = (release: string) =>
  createHash("sha256").update(`${release}\0${ADAPTER_VERSION_5ET}`).digest("hex");

// ---------- FR-CMPX-02 / -03: the book list ----------

export interface BookInfo {
  key: string;
  abbr: string;
  name: string;
  counts: Record<BookKind, number>;
}

export type BookList =
  | { state: "not-found"; path: string; issues?: string[] }
  | {
      state: "ready";
      path: string;
      /** `changelog.json`'s last `ver`, as shown in the panel. */
      release: string;
      /** The `version` of every book's source (FR-CMPX-03). */
      version: string;
      books: BookInfo[];
    };

/** Pure: the data's books with their counts, labelled, by name. */
export function describeBooks(data: FolderData, labels: BookLabels): BookInfo[] {
  const counts = new Map<string, Record<BookKind, number>>();
  const add = (list: readonly Raw[], kind: BookKind) => {
    for (const r of list) {
      const abbr = sourceOf(r);
      const row = counts.get(abbr) ?? { monster: 0, spell: 0, item: 0 };
      row[kind]++;
      counts.set(abbr, row);
    }
  };
  add(data.monsters, "monster");
  add(data.spells, "spell");
  for (const l of [data.items, data.itemGroups, data.baseItems, data.variants]) add(l, "item");
  return [...counts]
    .map(([abbr, c]) => ({
      key: bookKey(abbr),
      abbr,
      name: clipTo(labels.names.get(abbr) ?? abbr, NAME_MAX),
      counts: c,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.abbr.localeCompare(b.abbr));
}

export interface ReadOptions {
  /** Test seam (FR-CMPX-04); default reads the folder. */
  readText?: ReadText;
}

export function listBooks(dir: string, options: ReadOptions = {}): BookList {
  const read = options.readText ?? readFromDir(dir);
  // FR-CMPX-01: no `data/books.json` → `not-found`.
  try {
    read("data/books.json");
  } catch {
    return { state: "not-found", path: dir };
  }
  try {
    const labels = readLabels(read);
    return {
      state: "ready",
      path: dir,
      release: labels.release,
      version: bookVersion(labels.release),
      books: describeBooks(readFolder(read), labels),
    };
  } catch (e) {
    if (e instanceof FolderError) return { state: "not-found", path: dir, issues: e.issues };
    throw e;
  }
}

// ---------- FR-CMPX-13: replaces ----------

/** Kind + name (case-insensitive, either apostrophe) → the SRD's `sourceKey`. */
export type SrdIndex = ReadonlyMap<string, string>;

const srdName = (kind: string, name: string) => `${kind}\0${entryNameKey(name).replace(/’/g, "'")}`;

/** An SRD entry's other names: "Crossbow, hand", "Succubus/Incubus", "Stone of Good Luck (Luckstone)". */
function srdAliases(name: string): string[] {
  const out = name.split("/");
  const comma = /^([^,]+), (.+)$/.exec(name);
  if (comma) out.push(`${comma[2]} ${comma[1]}`, comma[1] as string);
  if (name.includes(" (")) out.push(name.slice(0, name.indexOf(" (")));
  return out;
}

export function srdIndexOf(
  records: readonly { kind: string; sourceKey: string; data: { name: string } }[],
): SrdIndex {
  const out = new Map<string, string>();
  for (const r of records) out.set(srdName(r.kind, r.data.name), r.sourceKey);
  for (const r of records) {
    for (const alias of srdAliases(r.data.name)) {
      const k = srdName(r.kind, alias);
      if (!out.has(k)) out.set(k, r.sourceKey);
    }
  }
  return out;
}

/** The name, then its family ("Ioun Stone (Agility)" → "Ioun Stone"), then "Leather Armor" → "Leather". */
function findSrd(srd: SrdIndex, kind: string, name: string) {
  const family = name.includes(" (") ? name.slice(0, name.indexOf(" (")) : name;
  for (const t of [name, family, family.replace(/ armor$/i, "")]) {
    const key = srd.get(srdName(kind, t));
    if (key) return key;
  }
  return undefined;
}

let bundledSrd: SrdIndex | undefined;
function defaultSrdIndex(): SrdIndex {
  bundledSrd ??= srdIndexOf(bundledSource(SRD_SOURCE_KEY).adapted.records);
  return bundledSrd;
}

/** `reprintedAs` is `"Name|SRC"` or `{uid: "Name|SRC"}`. */
function reprintTargets(r: Raw): string[] {
  const list = Array.isArray(r.reprintedAs) ? r.reprintedAs : [];
  return list.flatMap((t) => {
    const uid = typeof t === "string" ? t : isRaw(t) ? asStr(t.uid) : undefined;
    const [name, source] = (uid ?? "").split("|");
    return name && source ? [refKey(name, source)] : [];
  });
}

/** A copy that takes its base's `reprintedAs` (`_preserve`) names the reprint only once resolved. */
function keepsReprint(r: Raw) {
  const preserve = isRaw(r._copy) && isRaw(r._copy._preserve) ? r._copy._preserve : {};
  return preserve["*"] === true || preserve.reprintedAs === true;
}

/** Reprint's `refKey` per kind → the refs of the older entries that name it. */
function reprintIndex(kind: BookKind, all: readonly Raw[]) {
  const out = new Map<string, string[]>();
  for (const older of all) {
    for (const target of reprintTargets(older)) {
      const ref = `${bookKey(sourceOf(older))}:${kind}/${slugify(nameOf(older))}`;
      out.set(target, [...(out.get(target) ?? []), ref]);
    }
  }
  return out;
}

/** The import refuses a whole book over a bad ref or more than 20: dropped or clipped here. */
function fitRefs(c: Run, key: string, refs: readonly string[]) {
  const unique = [...new Set(refs)].filter((ref) => {
    const ok = ReplacedRef.safeParse(ref).success;
    if (!ok) c.warn(key, "replaces", "Older entry gives no usable ref; dropped");
    return ok;
  });
  if (unique.length <= REPLACES_MAX) return unique;
  c.warn(key, "replaces", `More than ${REPLACES_MAX} refs; clipped`);
  return unique.slice(0, REPLACES_MAX);
}

function replacer(c: Run, kind: BookKind, all: readonly Raw[], srd: SrdIndex) {
  const reprints = reprintIndex(kind, all);
  return (_kind: BookKind, r: Raw): string[] => {
    const refs = [...(reprints.get(refKey(nameOf(r), sourceOf(r))) ?? [])];
    if (r.srd === true || typeof r.srd === "string") {
      const name = typeof r.srd === "string" ? r.srd : nameOf(r);
      const key = findSrd(srd, kind, name);
      if (key) refs.push(`${SRD_SOURCE_KEY}:${key}`);
      else c.warn(`${kind}/${slugify(nameOf(r))}`, "replaces", "SRD entry not found; no ref");
    }
    return fitRefs(c, `${kind}/${slugify(nameOf(r))}`, refs);
  };
}

// ---------- the book ----------

export interface AdaptEnv {
  /** Does this folder-relative file exist? (FR-CMPX-23; injected so the core stays pure.) */
  exists: (relPath: string) => boolean;
  srd?: SrdIndex;
}

function copyWarnings(c: Run, kind: BookKind, r: CopyResult, abbr: string) {
  for (const f of r.failures) {
    if (f.source === abbr) c.skip(`${kind}/${slugify(f.name)}`, "_copy", f.message);
  }
  for (const rec of r.records) {
    if (sourceOf(rec) !== abbr) continue;
    for (const note of r.notes.get(refKey(nameOf(rec), sourceOf(rec))) ?? []) {
      c.warn(`${kind}/${slugify(nameOf(rec))}`, "_copy", note);
    }
  }
}

/** Pure: one book of already-read data → import records. */
export function adaptBookData(data: FolderData, abbr: string, env: AdaptEnv): FiveEtoolsResult {
  const c = new Run();
  const srd = env.srd ?? defaultSrdIndex();
  for (const where of data.unreadable) c.skip(where, "", "Unreadable record");

  // Only this book's copies (and any that keep a base's `reprintedAs`) are resolved: one pass over
  // the whole folder per book is what would add up across many books.
  const wanted = (r: Raw) => sourceOf(r) === abbr || keepsReprint(r);
  const monsters = resolveCopies(data.monsters, data.monsterTemplates, wanted);
  copyWarnings(c, "monster", monsters, abbr);
  const groups = resolveCopies(data.legendaryGroups);
  const monsterEnv = {
    groups: new Map(groups.records.map((g) => [refKey(nameOf(g), sourceOf(g)), g])),
    exists: env.exists,
    replaces: replacer(c, "monster", [...data.monsters, ...monsters.records], srd),
  };
  for (const m of monsters.records) if (sourceOf(m) === abbr) mapMonster(c, m, monsterEnv);

  const spellEnv = {
    classes: data.spellClasses,
    replaces: replacer(c, "spell", data.spells, srd),
  };
  for (const s of data.spells) if (sourceOf(s) === abbr) mapSpell(c, s, spellEnv);

  const rawItems = [...data.items, ...data.baseItems];
  const items = resolveCopies(rawItems, [], wanted);
  copyWarnings(c, "item", items, abbr);
  const bases = new Map(rawList(data.baseItems).map((b) => [refKey(nameOf(b), sourceOf(b)), b]));
  const allItems = [...rawItems, ...items.records, ...data.variants, ...data.itemGroups];
  const itemEnv = {
    bases,
    shared: new Map(data.itemEntries.map((e) => [refKey(nameOf(e), sourceOf(e)), e])),
    replaces: replacer(c, "item", allItems, srd),
  };
  for (const i of items.records) if (sourceOf(i) === abbr) mapItem(c, i, itemEnv);
  for (const g of data.itemGroups) if (sourceOf(g) === abbr) mapGroup(c, g, itemEnv);
  for (const v of data.variants) if (sourceOf(v) === abbr) mapVariant(c, v, itemEnv);
  return c.result();
}

export interface AdaptOptions extends ReadOptions, Partial<AdaptEnv> {}

/**
 * One book of the folder → `{records, warnings, skipped, counts}`. Reads every file of FR-CMPX-04
 * (a `_copy` base can sit in any book); throws `FolderError` on a malformed one (§11: nothing is
 * written for that book).
 */
export function adaptBook(dir: string, abbr: string, options: AdaptOptions = {}): FiveEtoolsResult {
  const read = options.readText ?? readFromDir(dir);
  return adaptBookData(readFolder(read), abbr, {
    exists: options.exists ?? ((rel) => existsSync(path.join(dir, rel))),
    ...(options.srd ? { srd: options.srd } : {}),
  });
}
