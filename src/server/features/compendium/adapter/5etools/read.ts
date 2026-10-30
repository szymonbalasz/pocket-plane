// FR-CMPX-04: the folder's I/O, read only what's needed, JSON parse only, parsed per call and
// dropped after. Every file name comes from the repo or an index whose values are checked: a path
// never leaves `data/`. A malformed file fails the whole call with issues (§11).
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { isRaw, type Raw } from "./raw";

export class FolderError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join("; "));
    this.name = "FolderError";
  }
}

export type ReadText = (relPath: string) => string;

export const readFromDir =
  (dir: string): ReadText =>
  (relPath) =>
    readFileSync(path.join(dir, relPath), "utf8");

const INDEX_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/;
/** `{name, source}` is all that's checked at read; mapping validates the output. */
const Named = z.looseObject({ name: z.string().min(1), source: z.string().min(1) });

export interface FolderData {
  monsters: Raw[];
  monsterTemplates: Raw[];
  legendaryGroups: Raw[];
  spells: Raw[];
  /** `spells/sources.json`: book → spell name → classes. */
  spellClasses: Raw;
  items: Raw[];
  itemGroups: Raw[];
  baseItems: Raw[];
  /** `items-base.json`'s shared `{#itemEntry}` texts. */
  itemEntries: Raw[];
  /** `magicvariants.json`, flattened: `inherits` on top of the variant. */
  variants: Raw[];
  /** Rows dropped at read: file + position only, nothing of the row. */
  unreadable: string[];
}

function parseJson(read: ReadText, rel: string, optional = false): unknown {
  let text: string;
  try {
    text = read(rel);
  } catch {
    if (optional) return undefined;
    throw new FolderError([`${rel}: missing or unreadable`]);
  }
  try {
    return JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new FolderError([`${rel}: not valid JSON`]);
  }
}

function objectAt(read: ReadText, rel: string, optional = false): Raw {
  const v = parseJson(read, rel, optional);
  if (v === undefined) return {};
  if (!isRaw(v)) throw new FolderError([`${rel}: not an object`]);
  return v;
}

function rows(doc: Raw, field: string, rel: string, unreadable: string[], named = true): Raw[] {
  const v = doc[field];
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new FolderError([`${rel}: "${field}" is not a list`]);
  const out: Raw[] = [];
  for (const [i, row] of v.entries()) {
    if (named ? Named.safeParse(row).success : isRaw(row)) out.push(row as Raw);
    else unreadable.push(`${rel}#${i}`);
  }
  return out;
}

/** An index file: source → file name, each checked before it's read. */
function indexFiles(read: ReadText, folder: string): string[] {
  const rel = `data/${folder}/index.json`;
  return Object.values(objectAt(read, rel)).map((f) => {
    if (typeof f !== "string" || !INDEX_FILE.test(f)) {
      throw new FolderError([`${rel}: bad file name`]);
    }
    return `data/${folder}/${f}`;
  });
}

function flattenVariant(v: Raw): Raw {
  const inherits = isRaw(v.inherits) ? v.inherits : {};
  return { ...v, ...inherits, entries: inherits.entries ?? v.entries };
}

export function readFolder(read: ReadText): FolderData {
  const unreadable: string[] = [];
  const monsters = indexFiles(read, "bestiary").flatMap((rel) =>
    rows(objectAt(read, rel), "monster", rel, unreadable),
  );
  const spells = indexFiles(read, "spells").flatMap((rel) =>
    rows(objectAt(read, rel), "spell", rel, unreadable),
  );
  const tplRel = "data/bestiary/template.json";
  const lgRel = "data/bestiary/legendarygroups.json";
  const itemsRel = "data/items.json";
  const baseRel = "data/items-base.json";
  const variantsRel = "data/magicvariants.json";
  const items = objectAt(read, itemsRel);
  const base = objectAt(read, baseRel);
  const variants = rows(objectAt(read, variantsRel), "magicvariant", variantsRel, unreadable, false)
    .map(flattenVariant)
    .filter((v, i) => {
      if (Named.safeParse(v).success) return true;
      unreadable.push(`${variantsRel}#${i}`);
      return false;
    });
  return {
    monsters,
    monsterTemplates: rows(objectAt(read, tplRel, true), "monsterTemplate", tplRel, unreadable),
    legendaryGroups: rows(objectAt(read, lgRel), "legendaryGroup", lgRel, unreadable),
    spells,
    spellClasses: objectAt(read, "data/spells/sources.json"),
    items: rows(items, "item", itemsRel, unreadable),
    itemGroups: rows(items, "itemGroup", itemsRel, unreadable),
    baseItems: rows(base, "baseitem", baseRel, unreadable),
    itemEntries: rows(base, "itemEntry", baseRel, unreadable),
    variants,
    unreadable,
  };
}

export interface BookLabels {
  /** Source abbreviation → book name, `books.json` before `adventures.json`. */
  names: Map<string, string>;
  /** `changelog.json`'s last `ver`. */
  release: string;
}

export function readLabels(read: ReadText): BookLabels {
  const names = new Map<string, string>();
  const add = (doc: Raw, field: string) => {
    const list = doc[field];
    if (!Array.isArray(list)) return;
    for (const b of list) {
      if (!isRaw(b) || typeof b.name !== "string") continue;
      const abbr = typeof b.source === "string" ? b.source : b.id;
      if (typeof abbr === "string" && !names.has(abbr)) names.set(abbr, b.name);
    }
  };
  add(objectAt(read, "data/books.json"), "book");
  add(objectAt(read, "data/adventures.json", true), "adventure");
  const log = parseJson(read, "data/changelog.json");
  const last = Array.isArray(log) ? log.at(-1) : undefined;
  if (!isRaw(last) || typeof last.ver !== "string") {
    throw new FolderError(["data/changelog.json: no last ver"]);
  }
  return { names, release: last.ver };
}
