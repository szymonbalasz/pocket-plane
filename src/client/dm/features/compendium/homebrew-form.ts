// Homebrew form model (FR-CMP-24, -25; CMP §7), pure: New (blank, kind chosen), Clone (prefilled
// from a visible non-monster entry; independent) and Edit (homebrew; kind fixed). One text form:
// name, the kind's facets plus its required short fields, markdown-lite text, Shared. Fields the
// form doesn't show (material, higher levels, cost, presets, …) are kept from the source.
import { clip } from "@shared/compendium/homebrew";
import {
  type CompendiumEntry,
  EntryDraft,
  HOMEBREW_TEXT_MAX,
  type SrdClass,
} from "@shared/compendium/schemas";
import { copyName } from "@shared/scenes-map/geometry";

export const HOMEBREW_KINDS = ["spell", "item", "condition", "feature"] as const;
export type HomebrewKind = (typeof HOMEBREW_KINDS)[number];

export type FormMode =
  | { kind: "new" }
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
  /** The source's facets / body: what the form doesn't show is kept from here. */
  facets: Record<string, unknown>;
  body: Record<string, unknown>;
}

const BLANK: Omit<HomebrewFields, "kind" | "facets" | "body"> = {
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
};

const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
const bool = (v: unknown) => v === true;

export function initialFields(mode: FormMode, kind: HomebrewKind = "item"): HomebrewFields {
  const src = mode.kind === "clone" ? mode.base : mode.kind === "edit" ? mode.entry : null;
  if (!src || src.kind === "monster") return { ...BLANK, kind, facets: {}, body: {} };
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
