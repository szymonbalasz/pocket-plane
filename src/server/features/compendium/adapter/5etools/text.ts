// 5etools `{@tag …}` strings and `entries` → markdown-lite (FR-CMPX-06, FR-CMP-26). Pure. Output
// is text only: no HTML, no links; a reference tag reads as its display text.
import { asStr, isRaw, type Raw } from "./raw";

export type Warn = (field: string, message: string) => void;

const TAG = /\{@(\w+)(?:\s+([^{}]*))?\}/g;

/** Tags whose first `|` part is the words shown; the rest is a target. */
const FIRST_PART = new Set([
  "5etools",
  "adventure",
  "area",
  "b",
  "bold",
  "book",
  "color",
  "filter",
  "footnote",
  "highlight",
  "homebrew",
  "i",
  "italic",
  "link",
  "loader",
  "note",
  "s",
  "strike",
  "u",
  "underline",
]);
/**
 * The display part of a reference tag `name|source|display`: index 2, except these. Not "the last
 * part": in `{@creature x|MM}` the last part is the source.
 */
const DISPLAY_AT: Readonly<Record<string, number>> = {
  card: 3,
  classFeature: 5,
  deity: 3,
  quickref: 4,
  subclassFeature: 7,
};

const signedArg = (arg: string) => {
  const n = Number(arg.replace("−", "-"));
  return Number.isNaN(n) ? arg : n >= 0 ? `+${n}` : `${n}`;
};

/** `mw` → "Melee Weapon", `mw,rw` → "Melee or Ranged Weapon", `ms,rw` → "Melee Spell or Ranged Weapon". */
function attackLabel(arg: string) {
  const kinds = arg.split(",").map((k) => k.trim().toLowerCase());
  const range = (k: string) => (k.startsWith("m") ? "Melee" : "Ranged");
  const what = (k: string) => (k[1] === "s" ? "Spell" : "Weapon");
  const whats = new Set(kinds.map(what));
  const label =
    whats.size === 1
      ? `${[...new Set(kinds.map(range))].join(" or ")} ${[...whats][0]}`
      : kinds.map((k) => `${range(k)} ${what(k)}`).join(" or ");
  return `*${label} Attack:*`;
}

function renderTag(tag: string, arg: string): string {
  const parts = arg.split("|").map((p) => p.trim());
  const first = parts[0] ?? "";
  switch (tag) {
    case "hit":
    case "d20":
      return signedArg(first);
    case "damage":
    case "dice":
    case "autodice":
      return first;
    case "dc":
      return `DC ${first}`;
    case "atk":
      return attackLabel(first);
    case "h":
      return "*Hit:* ";
    case "m":
      return "*Miss:* ";
    case "hom":
      return "*Hit or Miss:* ";
    case "recharge":
      return !first || first === "6" ? "(Recharge 6)" : `(Recharge ${first}–6)`;
    case "chance":
      return parts[1] || `${first} percent`;
    case "skillCheck":
      return parts[1] || signedArg(first.split(/\s+/).at(-1) ?? "");
    case "hitYourSpellAttack":
      return first || "your spell attack modifier";
    case "coinflip":
      return first || "flip a coin";
  }
  if (FIRST_PART.has(tag)) return first;
  return parts[DISPLAY_AT[tag] ?? 2] || first;
}

/** Innermost tags first, so `{@note a {@spell b}}` reads "a b". */
export function renderTags(s: string): string {
  let out = s;
  for (let i = 0; i < 10 && out.includes("{@"); i++) {
    const next = out.replace(TAG, (_, tag: string, arg?: string) =>
      renderTag(tag, (arg ?? "").trim()),
    );
    if (next === out) break;
    out = next;
  }
  return out;
}

const oneLine = (s: string) => s.replace(/\s*\n+\s*/g, " ").trim();

/** Every string of an entry that isn't a known block (FR-CMPX-06 "anything else"). */
function plainText(v: unknown): string {
  if (typeof v === "string") return renderTags(v);
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(plainText).filter(Boolean).join(" ");
  if (!isRaw(v)) return "";
  return ["name", "caption", "entry", "entries", "items", "rows", "row"]
    .map((k) => plainText(v[k]))
    .filter(Boolean)
    .join(" ");
}

function rollCell(roll: Raw) {
  const pad = (n: unknown) => (roll.pad === true ? String(n).padStart(2, "0") : String(n));
  return roll.exact !== undefined ? pad(roll.exact) : `${pad(roll.min)}–${pad(roll.max)}`;
}

function tableCell(v: unknown, warn: Warn): string {
  if (isRaw(v) && isRaw(v.roll)) {
    const words = v.entry ?? v.entries;
    return [rollCell(v.roll), words === undefined ? "" : tableCell(words, warn)]
      .filter(Boolean)
      .join(" ");
  }
  if (isRaw(v) && v.type === "cell") return tableCell(v.entry ?? v.entries, warn);
  return oneLine(toBlocks(v, warn).join(" ")).replace(/\|/g, "/");
}

function tableBlock(e: Raw, warn: Warn): string[] {
  const labels = Array.isArray(e.colLabels) ? e.colLabels.map((l) => tableCell(l, warn)) : [];
  const rowsRaw = Array.isArray(e.rows) ? e.rows : [];
  const rows = rowsRaw.map((r) => {
    const cells = isRaw(r) && Array.isArray(r.row) ? r.row : Array.isArray(r) ? r : [r];
    return `| ${cells.map((c) => tableCell(c, warn)).join(" | ")} |`;
  });
  const head =
    labels.length > 0
      ? [`| ${labels.join(" | ")} |`, `| ${labels.map(() => "---").join(" | ")} |`]
      : [];
  const caption = asStr(e.caption);
  return [
    ...(caption ? [`**${renderTags(caption)}**`] : []),
    [...head, ...rows].join("\n"),
    ...toBlocks(e.footnotes, warn),
  ];
}

const LIST_ITEM_TYPES = new Set(["item", "itemSub", "itemSpell"]);

function listLines(e: Raw, warn: Warn): string[] {
  const items = Array.isArray(e.items) ? e.items : [];
  return items.flatMap((item) => {
    if (isRaw(item) && item.type === "list") return listLines(item, warn);
    if (isRaw(item) && LIST_ITEM_TYPES.has(asStr(item.type) ?? "")) {
      const name = asStr(item.name);
      const words = oneLine(toBlocks(item.entry ?? item.entries, warn).join(" "));
      return [`- ${name ? `**${stop(renderTags(name))}** ` : ""}${words}`];
    }
    return [`- ${oneLine(toBlocks(item, warn).join(" "))}`];
  });
}

/** "Name" → "Name.", without doubling the mark a name already ends in. */
const stop = (name: string) => (/[.:!?]$/.test(name) ? name : `${name}.`);

/** `**Name.** first paragraph`; a first block that is a list or table starts on its own. */
function named(name: string | undefined, blocks: string[]): string[] {
  if (!name) return blocks;
  const label = `**${stop(renderTags(name))}**`;
  const [first, ...rest] = blocks;
  if (first === undefined) return [label];
  return /^[|\-*>]/.test(first) ? [label, first, ...rest] : [`${label} ${first}`, ...rest];
}

function toBlocks(v: unknown, warn: Warn): string[] {
  if (typeof v === "string") {
    const s = renderTags(v).trim();
    return s ? [s] : [];
  }
  if (typeof v === "number") return [String(v)];
  if (Array.isArray(v)) return v.flatMap((x) => toBlocks(x, warn));
  if (!isRaw(v)) return [];
  const type = asStr(v.type) ?? "entries";
  switch (type) {
    case "entries":
    case "item":
    case "itemSub":
    case "itemSpell":
      return named(asStr(v.name), toBlocks(v.entries ?? v.entry, warn));
    case "list":
      return [listLines(v, warn).join("\n")];
    case "table":
      return tableBlock(v, warn);
    case "inset":
    case "quote": {
      const by = asStr(v.by);
      const inner = [
        ...named(asStr(v.name), toBlocks(v.entries, warn)),
        ...(by ? [`— ${renderTags(by)}`] : []),
      ];
      return inner.map((b) =>
        b
          .split("\n")
          .map((l) => `> ${l}`)
          .join("\n"),
      );
    }
    default: {
      warn(`entries.${type}`, "Unknown block; kept as plain text");
      const s = plainText(v).trim();
      return s ? [s] : [];
    }
  }
}

/** `entries` (or one entry) → markdown-lite. */
export function entriesToMarkdown(entries: unknown, warn: Warn): string {
  return toBlocks(entries, warn).join("\n\n").trim();
}

/** All strings of `entries`, unrendered: the attack mapping reads their tags (FR-CMPX-07). */
export function rawStrings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(rawStrings);
  return isRaw(v) ? Object.values(v).flatMap(rawStrings) : [];
}
