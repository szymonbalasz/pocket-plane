// compendium boundary schemas (CMP §8, FR-CMP-01 / -04 / -29): kind registry (strict facets +
// body per kind), entry and source rows, derived values. zod is the source of truth.
import { AssetId } from "@shared/assets-pipeline/schemas";
import { TriggerRule } from "@shared/effect-modifiers/triggers";
import { Cr, Size } from "@shared/entities/schemas";
import { z } from "zod";

export const COMPENDIUM_KINDS = ["monster", "spell", "item", "condition", "feature"] as const;
export const CompendiumKind = z.enum(COMPENDIUM_KINDS);
export type CompendiumKind = z.infer<typeof CompendiumKind>;

/** FR-CMP-01: serialized entry (facets + body) cap, UTF-8 bytes of its JSON. */
export const ENTRY_MAX_BYTES = 32 * 1024;
/** §8.1: monster `meta` texts. */
export const META_TEXT_MAX = 200;
export const BLOCK_NAME_MAX = 80;
export const BLOCK_TEXT_MAX = 4_000;
export const BLOCKS_MAX = 40;
/** Free text of the other kinds; the entry cap (32 KB) is the real bound. */
export const ENTRY_TEXT_MAX = 24_000;
export const SHORT_TEXT_MAX = 200;
export const MATERIAL_MAX = 1_000;
export const NAME_MAX = 80;
export const LINE_MAX = 80;
/** FR-CMP-45 (OQ-CMP-37): image slots per homebrew entry; the first is the main image. */
export const IMAGE_SLOTS_MAX = 4;

/** FR-CMP-45: 0–4 unique asset IDs in slot order (first = main). */
export const EntryImages = z
  .array(AssetId)
  .max(IMAGE_SLOTS_MAX, `At most ${IMAGE_SLOTS_MAX} images`)
  .refine((ids) => new Set(ids).size === ids.length, { message: "Same image twice" });

/** The SRD's twelve classes, spelled as CHARX `classes[].name` (FR-CMP-29). */
export const SRD_CLASSES = [
  "Barbarian",
  "Bard",
  "Cleric",
  "Druid",
  "Fighter",
  "Monk",
  "Paladin",
  "Ranger",
  "Rogue",
  "Sorcerer",
  "Warlock",
  "Wizard",
] as const;
export const SrdClass = z.enum(SRD_CLASSES);
export type SrdClass = z.infer<typeof SrdClass>;

export const SPELL_SCHOOLS = [
  "abjuration",
  "conjuration",
  "divination",
  "enchantment",
  "evocation",
  "illusion",
  "necromancy",
  "transmutation",
] as const;
export const SpellSchool = z.enum(SPELL_SCHOOLS);

export const ITEM_CATEGORIES = ["weapon", "armor", "gear", "magic"] as const;
export const ItemCategory = z.enum(ITEM_CATEGORIES);

const text = (max: number) => z.string().max(max);
const short = text(SHORT_TEXT_MAX);
const int = (min: number, max: number) => z.number().int().min(min).max(max);

// ---------- monster ----------

export const StatBlockSection = z.strictObject({
  name: z.string().min(1).max(BLOCK_NAME_MAX),
  text: text(BLOCK_TEXT_MAX),
});
export type StatBlockSection = z.infer<typeof StatBlockSection>;
const Sections = z.array(StatBlockSection).max(BLOCKS_MAX);

const metaText = text(META_TEXT_MAX).optional();
export const MonsterMeta = z.strictObject({
  subtype: metaText,
  alignment: metaText,
  armorNote: metaText,
  speedText: metaText,
  savesText: metaText,
  skillsText: metaText,
  vulnerabilities: metaText,
  resistances: metaText,
  immunities: metaText,
  conditionImmunities: metaText,
  senses: metaText,
  languages: metaText,
});
export type MonsterMeta = z.infer<typeof MonsterMeta>;

export const MonsterFacets = z.strictObject({
  cr: Cr,
  /** Lower-case creature type, e.g. `humanoid`. */
  type: z.string().min(1).max(40),
  size: Size,
});
export const MonsterBody = z.strictObject({
  meta: MonsterMeta,
  traits: Sections,
  actions: Sections,
  bonusActions: Sections,
  reactions: Sections,
  legendary: z.strictObject({ intro: text(BLOCK_TEXT_MAX), actions: Sections }).optional(),
});

// ---------- spell ----------

export const SpellFacets = z.strictObject({
  level: int(0, 9),
  school: SpellSchool,
  classes: z.array(SrdClass).max(SRD_CLASSES.length),
  concentration: z.boolean(),
  ritual: z.boolean(),
});
export const SpellBody = z.strictObject({
  castingTime: short,
  range: short,
  components: short,
  material: text(MATERIAL_MAX).optional(),
  duration: short,
  text: text(ENTRY_TEXT_MAX),
  higherLevel: text(ENTRY_TEXT_MAX).optional(),
});

// ---------- item ----------

export const ItemFacets = z.strictObject({
  category: ItemCategory,
  /** Lower-case SRD wording, e.g. `very rare`; absent for mundane items. */
  rarity: text(100).optional(),
  attunement: z.boolean(),
});
export const ItemBody = z.strictObject({
  typeLine: short,
  cost: short.optional(),
  weight: short.optional(),
  damage: short.optional(),
  properties: short.optional(),
  ac: short.optional(),
  text: text(ENTRY_TEXT_MAX),
});

// ---------- condition ----------

export const ConditionFacets = z.strictObject({});
export const ConditionBody = z.strictObject({ text: text(ENTRY_TEXT_MAX) });

// ---------- feature ----------

export const FeatureFacets = z.strictObject({
  className: SrdClass,
  subclass: text(NAME_MAX).optional(),
  level: int(1, 20).optional(),
});

/** A MOD built-in trigger key (FR-CMP-29). */
export const PresetKey = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(64);

export const FeatureBody = z
  .strictObject({
    text: text(ENTRY_TEXT_MAX),
    presetKey: PresetKey.optional(),
    preset: TriggerRule.optional(),
  })
  .refine((b) => b.presetKey === undefined || b.preset === undefined, {
    message: "Use presetKey or preset, not both",
    path: ["preset"],
  });

// ---------- kind registry (FR-CMP-01) ----------

export const kindRegistry = {
  monster: { facets: MonsterFacets, body: MonsterBody },
  spell: { facets: SpellFacets, body: SpellBody },
  item: { facets: ItemFacets, body: ItemBody },
  condition: { facets: ConditionFacets, body: ConditionBody },
  feature: { facets: FeatureFacets, body: FeatureBody },
} as const satisfies Record<CompendiumKind, { facets: z.ZodType; body: z.ZodType }>;

export type FacetsOf<K extends CompendiumKind> = z.infer<(typeof kindRegistry)[K]["facets"]>;
export type BodyOf<K extends CompendiumKind> = z.infer<(typeof kindRegistry)[K]["body"]>;

const jsonBytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

export const EntryName = z.string().trim().min(1).max(NAME_MAX);

const draft = <K extends CompendiumKind, F extends z.ZodType, B extends z.ZodType>(
  kind: K,
  k: { facets: F; body: B },
) => z.strictObject({ kind: z.literal(kind), name: EntryName, facets: k.facets, body: k.body });

/** One entry's content (no ids / provenance): what an adapter or the homebrew form produces. */
export const EntryDraft = z
  .discriminatedUnion("kind", [
    draft("monster", kindRegistry.monster),
    draft("spell", kindRegistry.spell),
    draft("item", kindRegistry.item),
    draft("condition", kindRegistry.condition),
    draft("feature", kindRegistry.feature),
  ])
  .refine((e) => jsonBytes({ facets: e.facets, body: e.body }) <= ENTRY_MAX_BYTES, {
    message: "Entry is too large (32 KB)",
  });
export type EntryDraft = z.infer<typeof EntryDraft>;
export type EntryDraftOf<K extends CompendiumKind> = Extract<EntryDraft, { kind: K }>;

// ---------- rows (CMP §8) ----------

const Id = z.string().min(1).max(64);
const Iso = z.string().min(1);
export const SourceKey = z
  .string()
  .min(1)
  .max(200)
  .regex(/^(monster|spell|item|condition|feature)\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/);

/** `compendium_source` (global, FR-CMP-04). */
export const CompendiumSource = z.strictObject({
  key: z.string().min(1).max(64),
  name: z.string().min(1).max(NAME_MAX),
  licence: z.string().min(1).max(NAME_MAX),
  attribution: z.string().min(1).max(2_000),
  url: z.url().nullable(),
  /** SHA-256 hex over the bundled files + `ADAPTER_VERSION`; fixtures may use a label. */
  version: z.string().min(1).max(128),
  importedAt: Iso,
  counts: z.record(CompendiumKind, z.number().int().min(0)),
});
export type CompendiumSource = z.infer<typeof CompendiumSource>;

/** `compendium_entry` (imported: global; homebrew: per campaign). */
export const CompendiumEntry = z
  .strictObject({
    id: Id,
    campaignId: Id.nullable(),
    kind: CompendiumKind,
    source: z.string().min(1).max(64).nullable(),
    sourceKey: SourceKey.nullable(),
    name: EntryName,
    line: z.string().max(LINE_MAX),
    facets: z.unknown(),
    body: z.unknown(),
    definitionId: Id.nullable(),
    shared: z.boolean(),
    derivedFromId: Id.nullable(),
    /** FR-CMP-45 / -47: homebrew only; as delivered (stale IDs dropped at read). */
    imageAssetIds: EntryImages,
    createdAt: Iso,
    updatedAt: Iso,
    importedAt: Iso.nullable(),
  })
  .superRefine((e, c) => {
    const k = kindRegistry[e.kind];
    for (const part of ["facets", "body"] as const) {
      const r = k[part].safeParse(e[part]);
      if (!r.success) {
        for (const i of r.error.issues) {
          c.addIssue({ code: "custom", path: [part, ...i.path], message: i.message });
        }
      }
    }
    if ((e.source === null) !== (e.sourceKey === null)) {
      c.addIssue({
        code: "custom",
        path: ["sourceKey"],
        message: "source and sourceKey go together",
      });
    }
    if (e.source === null && e.kind === "monster") {
      c.addIssue({ code: "custom", path: ["kind"], message: "Homebrew monsters are customs" });
    }
    if (e.source !== null && e.imageAssetIds.length > 0) {
      c.addIssue({
        code: "custom",
        path: ["imageAssetIds"],
        message: "Imported entries have no images",
      });
    }
  });
export type CompendiumEntry = z.infer<typeof CompendiumEntry>;

// ---------- derived (CMP §8) ----------

export const isReadOnlyEntry = (e: { source: string | null }) => e.source !== null;

/** FR-CMP-29: `<source>:<sourceKey>`; homebrew `campaign:<entryId>`. */
export function featureKey(e: { id: string; source: string | null; sourceKey: string | null }) {
  return e.source !== null && e.sourceKey !== null
    ? `${e.source}:${e.sourceKey}`
    : `campaign:${e.id}`;
}

/** `5` → `5th`. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Summary line (≤ 80, derived at write): "CR 1/4 · Small humanoid", "Level 3 evocation", … */
export function entryLine(e: EntryDraft): string {
  let line: string;
  switch (e.kind) {
    case "monster":
      line = `CR ${e.facets.cr} · ${cap(e.facets.size)} ${e.facets.type}`;
      break;
    case "spell":
      line =
        e.facets.level === 0
          ? `${cap(e.facets.school)} cantrip`
          : `Level ${e.facets.level} ${e.facets.school}`;
      break;
    case "item":
      line = e.facets.rarity
        ? `${cap(e.facets.rarity)} ${e.body.typeLine.toLowerCase()}`
        : e.body.typeLine;
      break;
    case "condition":
      line = "Condition";
      break;
    case "feature": {
      const who = e.facets.subclass
        ? `${e.facets.className} (${e.facets.subclass})`
        : e.facets.className;
      line = e.facets.level === undefined ? who : `${who} · ${ordinal(e.facets.level)} level`;
      break;
    }
  }
  return line.length <= LINE_MAX ? line : `${line.slice(0, LINE_MAX - 1)}…`;
}

/** `nameKey` (CMP §8): lower-case NFC; homebrew names are unique on it per campaign and kind. */
export const entryNameKey = (name: string) => name.trim().normalize("NFC").toLowerCase();

/** Homebrew body text cap (FR-CMP-24). */
export const HOMEBREW_TEXT_MAX = 8_000;
