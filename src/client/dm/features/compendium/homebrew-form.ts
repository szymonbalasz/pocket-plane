// Homebrew form model (FR-CMP-24, -25; CMP §7), pure: New (blank, kind chosen), Clone (prefilled
// from a visible non-monster entry; independent) and Edit (homebrew; kind fixed). One text form:
// name, the kind's facets plus its required short fields, markdown-lite text, Shared. Fields the
// form doesn't show (material, higher levels, cost, presets, …) are kept from the source.
// Images (FR-CMP-49, -50): ordered slots, first = main; Clone and Edit prefill the source's.
import { clip } from "@shared/compendium/homebrew";
import {
  type CompendiumEntry,
  EntryDraft,
  HOMEBREW_TEXT_MAX,
  HOUSE_RULES_CHAPTER,
  type SrdClass,
} from "@shared/compendium/schemas";
import { copyName } from "@shared/scenes-map/geometry";

export const HOMEBREW_KINDS = ["spell", "item", "condition", "feature", "rule"] as const;
export type HomebrewKind = (typeof HOMEBREW_KINDS)[number];

export type FormMode =
  /** `preset`: the kind to start with (the Rules window's New house rule: `rule`). */
  | { kind: "new"; preset?: HomebrewKind }
  | { kind: "clone"; base: CompendiumEntry }
  | { kind: "edit"; entry: CompendiumEntry };

export interface HomebrewFields {
  kind: HomebrewKind;
  name: string;
  text: string;
  shared: boolean;
  /** Spell. */
  level: string;
  school: string;
  concentration: boolean;
  ritual: boolean;
  castingTime: string;
  range: string;
  components: string;
  duration: string;
  /** Item. */
  category: string;
  rarity: string;
  attunement: boolean;
  typeLine: string;
  /** Feature. */
  className: SrdClass;
  subclass: string;
  featureLevel: string;
  /** House rule (FR-CMP-67): free text ≤ 60; the chapter is always "House rules". */
  section: string;
  /** Image asset IDs in slot order, first = main (FR-CMP-45). */
  images: string[];
  /** The source's facets / body: what the form doesn't show is kept from here. */
  facets: Record<string, unknown>;
  body: Record<string, unknown>;
}

const BLANK: Omit<HomebrewFields, "kind" | "images" | "facets" | "body"> = {
  name: "",
  text: "",
  shared: false,
  level: "1",
  school: "evocation",
  concentration: false,
  ritual: false,
  castingTime: "1 action",
  range: "Self",
  components: "V, S",
  duration: "Instantaneous",
  category: "gear",
  rarity: "",
  attunement: false,
  typeLine: "Adventuring gear",
  className: "Fighter",
  subclass: "",
  featureLevel: "",
  section: "",
};

const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
const bool = (v: unknown) => v === true;

export function initialFields(
  mode: FormMode,
  kind: HomebrewKind = mode.kind === "new" ? (mode.preset ?? "item") : "item",
): HomebrewFields {
  const src = mode.kind === "clone" ? mode.base : mode.kind === "edit" ? mode.entry : null;
  if (!src || src.kind === "monster") return { ...BLANK, kind, images: [], facets: {}, body: {} };
  const f = (src.facets ?? {}) as Record<string, unknown>;
  const b = (src.body ?? {}) as Record<string, unknown>;
  const name =
    mode.kind === "clone" && src.source === null ? clip(copyName(src.name), 80) : src.name;
  return {
    ...BLANK,
    kind: src.kind,
    name,
    text: str(b.text, ""),
    shared: mode.kind === "edit" ? src.shared : false,
    level: typeof f.level === "number" ? String(f.level) : src.kind === "spell" ? "1" : "",
    school: str(f.school, BLANK.school),
    concentration: bool(f.concentration),
    ritual: bool(f.ritual),
    castingTime: str(b.castingTime, BLANK.castingTime),
    range: str(b.range, BLANK.range),
    components: str(b.components, BLANK.components),
    duration: str(b.duration, BLANK.duration),
    category: str(f.category, BLANK.category),
    rarity: str(f.rarity, ""),
    attunement: bool(f.attunement),
    typeLine: str(b.typeLine, BLANK.typeLine),
    className: str(f.className, BLANK.className) as SrdClass,
    subclass: str(f.subclass, ""),
    featureLevel: src.kind === "feature" && typeof f.level === "number" ? String(f.level) : "",
    section: src.kind === "rule" ? str(f.section, "") : "",
    // Imported bases have none (FR-CMP-45); a homebrew base's carry over (FR-CMP-49).
    images: src.source === null ? [...src.imageAssetIds] : [],
    facets: f,
    body: b,
  };
}

const opt = (v: string) => (v.trim() === "" ? undefined : v.trim());

/** The entry draft the form sends (unvalidated); kept source fields first, shown ones on top. */
export function draftOf(f: HomebrewFields): unknown {
  const base = { kind: f.kind, name: f.name.trim() };
  const keep = (k: string) => (f.body[k] === undefined ? {} : { [k]: f.body[k] });
  switch (f.kind) {
    case "spell":
      return {
        ...base,
        facets: {
          level: Number(f.level),
          school: f.school,
          classes: Array.isArray(f.facets.classes) ? f.facets.classes : [],
          concentration: f.concentration,
          ritual: f.ritual,
        },
        body: {
          castingTime: f.castingTime.trim(),
          range: f.range.trim(),
          components: f.components.trim(),
          ...keep("material"),
          duration: f.duration.trim(),
          text: f.text,
          ...keep("higherLevel"),
        },
      };
    case "item":
      return {
        ...base,
        facets: {
          category: f.category,
          ...(opt(f.rarity) ? { rarity: opt(f.rarity)?.toLowerCase() } : {}),
          attunement: f.attunement,
        },
        body: {
          typeLine: f.typeLine.trim(),
          ...keep("cost"),
          ...keep("weight"),
          ...keep("damage"),
          ...keep("properties"),
          ...keep("ac"),
          text: f.text,
        },
      };
    case "condition":
      return { ...base, facets: {}, body: { text: f.text } };
    case "feature":
      return {
        ...base,
        facets: {
          className: f.className,
          ...(opt(f.subclass) ? { subclass: opt(f.subclass) } : {}),
          ...(opt(f.featureLevel) ? { level: Number(f.featureLevel) } : {}),
        },
        body: { text: f.text, ...keep("presetKey"), ...keep("preset") },
      };
    case "rule":
      return {
        ...base,
        facets: { chapter: HOUSE_RULES_CHAPTER, section: f.section.trim(), order: 0 },
        body: { text: f.text },
      };
  }
}

/** Client mirror of the server's checks: the entry schema and the 8,000-char text cap. */
export function draftError(f: HomebrewFields): string | null {
  if (f.text.length > HOMEBREW_TEXT_MAX) return `Text: at most ${HOMEBREW_TEXT_MAX} characters`;
  const r = EntryDraft.safeParse(draftOf(f));
  if (r.success) return null;
  const i = r.error.issues[0];
  if (!i) return "Invalid entry";
  const field = i.path.at(-1);
  return field === undefined ? i.message : `${String(field)}: ${i.message}`;
}

// ---- Image slots (FR-CMP-50) ----

export const ALREADY_IN_ENTRY = "Already in this entry";

/**
 * An image from the attach control joins the end; dedupe is the form's (seams S5): an id already
 * held (same bytes → same id) is not added again.
 */
export function attachImage(ids: readonly string[], id: string) {
  const duplicate = ids.includes(id);
  return { ids: duplicate ? [...ids] : [...ids, id], duplicate };
}

export const removeImage = (ids: readonly string[], i: number) => ids.filter((_, j) => j !== i);

/** Swap slot `i` with its neighbour; out of range → unchanged. */
export function moveImage(ids: readonly string[], i: number, by: -1 | 1): string[] {
  const j = i + by;
  if (i < 0 || i >= ids.length || j < 0 || j >= ids.length) return [...ids];
  const out = [...ids];
  [out[i], out[j]] = [out[j] as string, out[i] as string];
  return out;
}
