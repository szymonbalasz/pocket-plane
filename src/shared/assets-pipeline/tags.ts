// Image tags (ASSET §6.3, FR-ASSET-39–43, -48): rules, built-in tags, upload contexts and the
// DM-only tag intents. Tags live only on the DM's `asset` record (FR-ASSET-50).

import { fold } from "@shared/compendium/match";
import { z } from "zod";

/** FR-ASSET-39: tag length (chars), tags per image, distinct tags per campaign (built-ins incl.). */
export const TAG_MAX_LENGTH = 24;
export const TAGS_PER_IMAGE_MAX = 8;
export const CAMPAIGN_TAGS_MAX = 50;

/** FR-ASSET-40 (OQ-ASSET-21 A): built-in tags, in chip order. Never renamed. */
export const IMAGE_TAGS = ["Tokens", "Portraits", "Maps", "Handouts", "Props", "Items"] as const;
export type BuiltInTag = (typeof IMAGE_TAGS)[number];

/** FR-ASSET-48: where a picker or attach control is hosted; sets the upload's tag. */
export const ImageContext = z.enum([
  "token",
  "portrait",
  "map",
  "prop",
  "handout",
  "compendium-item",
  "compendium",
]);
export type ImageContext = z.infer<typeof ImageContext>;

/** FR-ASSET-48 (OQ-ASSET-23 A): the tag an upload from each context carries (none = null). */
export const IMAGE_CONTEXT_TAG: Readonly<Record<ImageContext, BuiltInTag | null>> = {
  token: "Tokens",
  portrait: "Portraits",
  map: "Maps",
  prop: "Props",
  handout: "Handouts",
  "compendium-item": "Items",
  compendium: null,
};

/** FR-ASSET-39: tag identity. "tokens" and "Tokens" are one tag. */
export const tagKey = (tag: string): string => fold(tag);

const BUILT_IN_KEYS: ReadonlySet<string> = new Set(IMAGE_TAGS.map(tagKey));
export const isBuiltInTag = (tag: string): boolean => BUILT_IN_KEYS.has(tagKey(tag));

export const TOO_MANY_TAGS_MESSAGE = `Too many tags (${CAMPAIGN_TAGS_MAX})`;
export const BUILT_IN_TAG_MESSAGE = "Built-in tag";
export const TAG_NOT_FOUND_MESSAGE = "Tag not found";

// biome-ignore lint/suspicious/noControlCharactersInRegex: removing control characters is the rule (FR-ASSET-39).
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * FR-ASSET-39: control characters removed, whitespace runs → one space, trimmed, 1–24 chars,
 * `fold(tag)` non-empty.
 */
export const ImageTag = z
  .string()
  .max(1024)
  .transform((s) => s.replace(CONTROL, "").replace(/\s+/g, " ").trim())
  .refine((s) => s.length >= 1, { message: "Tag is required" })
  .refine((s) => [...s].length <= TAG_MAX_LENGTH, {
    message: `Tag must be at most ${TAG_MAX_LENGTH} characters`,
  })
  .refine((s) => tagKey(s) !== "", { message: "Tag needs a letter or digit" });

/** First of each fold-equal group, in the given order (FR-ASSET-39). */
export function dedupeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  return tags.filter((t) => {
    const k = tagKey(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** FR-ASSET-39: an image's tags: as given, fold-equal duplicates dropped, 0–8. */
export const ImageTags = z
  .array(ImageTag)
  .max(TAGS_PER_IMAGE_MAX * 8)
  .transform(dedupeTags)
  .refine((t) => t.length <= TAGS_PER_IMAGE_MAX, {
    message: `At most ${TAGS_PER_IMAGE_MAX} tags per image`,
  });

/** DM-only WS intents (ASSET §9, FR-ASSET-42, -43). */
export const ASSET_INTENTS = {
  setTags: "assets.setTags",
  renameTag: "assets.renameTag",
  deleteTag: "assets.deleteTag",
} as const;

const Id = z.string().min(1).max(64);

/** FR-ASSET-42: whole replace. */
export const SetTagsIntent = z.strictObject({ assetId: Id, tags: ImageTags });
export type SetTagsIntent = z.input<typeof SetTagsIntent>;

/** FR-ASSET-43: rename `from` to `to`; an existing `to` = merge. */
export const RenameTagIntent = z.strictObject({ from: ImageTag, to: ImageTag });
export type RenameTagIntent = z.input<typeof RenameTagIntent>;

/** FR-ASSET-43: remove a tag from every asset of the campaign (built-ins too). */
export const DeleteTagIntent = z.strictObject({ tag: ImageTag });
export type DeleteTagIntent = z.input<typeof DeleteTagIntent>;

/** `assets.renameTag` / `assets.deleteTag` result: assets changed (listed and attachments). */
export const TagChangeResult = z.object({ changed: z.number().int().nonnegative() });
export type TagChangeResult = z.infer<typeof TagChangeResult>;

/** FR-ASSET-41: a tag an upload couldn't add (the upload is kept). */
export const DroppedTag = z.object({
  tag: z.string(),
  reason: z.enum(["image-full", "campaign-full"]),
});
export type DroppedTag = z.infer<typeof DroppedTag>;
