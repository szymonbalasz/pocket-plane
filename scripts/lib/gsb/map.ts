// Griffon's Saddlebag item → homebrew `item` entry (pure but for the file-exists check). The text
// is markdown-lite (FR-CMP-26): the description goes through the adapters' `toMarkdownLite`
// (`* ` lists → `- `, `***x***` → bold, `_x_` → italic); the source URL stays plain text because
// markdown-lite shows only a link's label.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { toMarkdownLite } from "@server/features/compendium/adapter/text";
import {
  ENTRY_MAX_BYTES,
  entryNameKey,
  HOMEBREW_TEXT_MAX,
  IMAGE_SLOTS_MAX,
  NAME_MAX,
  SHORT_TEXT_MAX,
} from "@shared/compendium/schemas";
import { dataPath, type ImageSize, type Item } from "./dataset";

/**
 * Bump when the mapping's output changes (text layout, facets, images): every imported item is
 * then re-mapped as `changed` on the next run (DM-edited entries still stay `locallyEdited`).
 */
export const MAPPER_VERSION = 1;
export const SOURCE_NAME = "The Griffon's Saddlebag";
export const TRUNCATED = "… (see source)";
/** Size picked per image: medium, else the largest present. */
const SIZE_PREFERENCE: readonly ImageSize[] = ["medium", "original", "small", "tiny"];

export interface ItemFacets {
  category: "magic";
  rarity?: string;
  attunement: boolean;
}
export interface ItemBody {
  typeLine: string;
  text: string;
}
export interface ItemEntry {
  kind: "item";
  name: string;
  facets: ItemFacets;
  body: ItemBody;
}

export interface MappedImage {
  /** The dataset's image id. */
  id: string;
  /** Absolute path on disk. */
  path: string;
  sha256: string;
}

export interface Mapped {
  entry: ItemEntry;
  images: MappedImage[];
  warnings: string[];
}

const clip = (s: string, max: number) => {
  const cps = [...s];
  return cps.length <= max ? s : cps.slice(0, max).join("").trimEnd();
};

/**
 * One rarity → its SRD word (the compendium's Rarity filter matches it exactly, case-folded);
 * several ("rarity varies", "uncommon (+1), rare (+2)") → the author's text, lower case.
 */
export function rarityOf(item: Item): string | undefined {
  if (item.rarities.length === 1) return item.rarities[0];
  const t = item.rarity.trim().toLowerCase();
  return t === "" ? undefined : clip(t, 100);
}

/**
 * The SRD convention ("Wondrous item (requires attunement by a druid)"): type, then the
 * attunement note; rarity is a facet (the card shows "typeLine, rarity, requires attunement").
 * `meta` would repeat the rarity on the card and in the result line.
 */
export function typeLineOf(item: Item): string {
  const type = item.typeLabel?.trim() || item.type?.trim() || "Magic item";
  // "by a druid", "requires attunement by a druid" and a bare "requires attunement" all fit.
  const req = (item.attunement.requirement ?? "").trim().replace(/^requires attunement\s*/i, "");
  const att = item.attunement.required ? ` (requires attunement${req ? ` ${req}` : ""})` : "";
  return clip(`${type}${att}`, SHORT_TEXT_MAX);
}

function flavorText(flavor: string | null | undefined): string {
  if (!flavor?.trim()) return "";
  return flavor
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((para) =>
      para
        .split("\n")
        .map((l) => l.trim().replace(/^\*+|\*+$/g, ""))
        .filter((l) => l !== "")
        .map((l) => `*${l}*`)
        .join("\n"),
    )
    .filter((p) => p !== "")
    .join("\n\n");
}

export function infoLine(item: Item): string {
  const parts = [
    item.tags.length > 0 ? `Tags: ${item.tags.join(", ")}` : "",
    item.treasureTheme.length > 0 ? `Theme: ${item.treasureTheme.join(", ")}` : "",
    item.bookVolume != null ? `Book ${item.bookVolume}` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

export function footerLine(item: Item): string {
  const url = item.source.url?.trim();
  return `Source: ${SOURCE_NAME} — ${url ? `${url} · ` : ""}${item.uid}`;
}

const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");

/** The footer's own cap: it is never cut by the text fit, so it can't crowd the rest out. */
export const FOOTER_MAX = 1_000;

/** `s` cut to `n` UTF-16 units (not inside a surrogate pair) + the marker. */
const cut = (s: string, n: number) => {
  const end = n > 0 && /[\uD800-\uDBFF]/.test(s.charAt(n - 1)) ? n - 1 : n;
  const kept = s.slice(0, end).trimEnd();
  return kept ? `${kept} ${TRUNCATED}` : TRUNCATED;
};

/**
 * The entry text, always within the homebrew text cap and the entry byte cap. Over a cap, parts
 * are cut in this order, each with `TRUNCATED`, until it fits: description, flavour, info line.
 * The footer (source + uid, the adoption key) is kept.
 */
function textOf(item: Item, facets: ItemFacets, typeLine: string, warnings: string[]): string {
  const footer = clip(footerLine(item), FOOTER_MAX);
  const parts = {
    flavour: flavorText(item.flavor),
    description: toMarkdownLite(item.description),
    info: infoLine(item),
  };
  type Part = keyof typeof parts;
  const build = (p: Record<Part, string>) =>
    [p.flavour, p.description, p.info, footer].filter(Boolean).join("\n\n");
  const fits = (p: Record<Part, string>) => {
    const t = build(p);
    return (
      t.length <= HOMEBREW_TEXT_MAX &&
      bytes({ facets, body: { typeLine, text: t } }) <= ENTRY_MAX_BYTES
    );
  };
  const now: Record<Part, string> = { ...parts };
  if (fits(now)) return build(now);
  for (const part of ["description", "flavour", "info"] as const) {
    const full = parts[part];
    if (full === "") continue;
    const at = (n: number) => ({ ...now, [part]: cut(full, n) });
    if (!fits(at(0))) {
      // Even the marker alone is too much with the rest: drop this part to the marker, go on.
      now[part] = TRUNCATED;
      warnings.push(`${part} cut to 0 of ${full.length} characters`);
      continue;
    }
    // Longest prefix that fits with the marker (binary search on UTF-16 length).
    let lo = 0;
    let hi = full.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(at(mid))) lo = mid;
      else hi = mid - 1;
    }
    now[part] = cut(full, lo);
    warnings.push(`${part} cut to ${lo} of ${full.length} characters`);
    return build(now);
  }
  // Only with an absurd footer + typeLine: hard cut, the caps still hold.
  return clip(build(now), HOMEBREW_TEXT_MAX);
}

/** Up to 4 images, main (`image`) first; each its medium file, else the largest present. */
export function imagesOf(
  item: Item,
  dataDir: string,
  warnings: string[],
  exists: (p: string) => boolean = existsSync,
): MappedImage[] {
  const main = item.image ?? "";
  const isMain = (im: Item["images"][number]) =>
    Object.values(im.files).some((f) => f?.path === main) || main.includes(`/${im.id}/`);
  const ordered = [...item.images.filter(isMain), ...item.images.filter((im) => !isMain(im))];
  const out: MappedImage[] = [];
  for (const im of ordered) {
    if (out.length === IMAGE_SLOTS_MAX) break;
    if (out.some((o) => o.id === im.id)) continue;
    const size = SIZE_PREFERENCE.find((s) => im.files[s] !== undefined);
    const file = size ? im.files[size] : undefined;
    if (!file) {
      warnings.push(`image ${im.id}: no files listed`);
      continue;
    }
    const abs = dataPath(dataDir, file.path);
    if (!abs) {
      warnings.push(`image ${im.id}: path outside the data folder, skipped`);
      continue;
    }
    if (!exists(abs)) {
      warnings.push(`image ${im.id}: file missing (${file.path}), skipped`);
      continue;
    }
    if (out.some((o) => o.sha256 === file.sha256)) continue;
    out.push({ id: im.id, path: abs, sha256: file.sha256 });
  }
  return out;
}

/**
 * Entry names for the whole dataset: homebrew names are unique per kind (case-insensitive), so
 * items sharing a name keep it in uid order and the later ones get " (2)", " (3)", … (cut to fit
 * 80). Only renamed items are in the map. Deterministic for a given dataset.
 */
export function uniqueNames(items: readonly Item[]): Map<string, string> {
  const base = (it: Item) => clip(it.name.trim(), NAME_MAX);
  const taken = new Set(items.map((it) => entryNameKey(base(it))));
  const groups = new Map<string, Item[]>();
  for (const it of items) {
    const k = entryNameKey(base(it));
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  const out = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
    let n = 1;
    for (const it of sorted.slice(1)) {
      let name: string;
      do {
        n++;
        const suffix = ` (${n})`;
        name = `${clip(base(it), NAME_MAX - suffix.length)}${suffix}`;
      } while (taken.has(entryNameKey(name)));
      taken.add(entryNameKey(name));
      out.set(it.uid, name);
    }
  }
  return out;
}

export function mapItem(
  item: Item,
  dataDir: string,
  exists: (p: string) => boolean = existsSync,
  /** From `uniqueNames`: this item's name is shared with another item. */
  rename?: string,
): Mapped {
  const warnings: string[] = [];
  let name = clip(item.name.trim(), NAME_MAX);
  if (name !== item.name.trim()) warnings.push(`name cut to ${NAME_MAX} characters`);
  if (rename !== undefined) {
    name = rename;
    warnings.push(`name shared with another item: imported as "${rename}"`);
  }
  const rarity = rarityOf(item);
  const facets: ItemFacets = {
    category: "magic",
    ...(rarity ? { rarity } : {}),
    attunement: item.attunement.required,
  };
  const typeLine = typeLineOf(item);
  const text = textOf(item, facets, typeLine, warnings);
  return {
    entry: { kind: "item", name, facets, body: { typeLine, text } },
    images: imagesOf(item, dataDir, warnings, exists),
    warnings,
  };
}

/** JSON with object keys sorted (arrays keep their order). */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : val,
  );
}

/** `writtenHash`: what was written (or is stored), so a DM edit in Pocket Plane shows. */
export function entryHash(e: {
  kind: string;
  name: string;
  facets: unknown;
  body: unknown;
  imageAssetIds: readonly string[];
}): string {
  const doc = {
    entry: { kind: e.kind, name: e.name, facets: e.facets, body: e.body },
    imageAssetIds: e.imageAssetIds,
  };
  return `sha256:${createHash("sha256").update(canonicalJson(doc)).digest("hex")}`;
}
