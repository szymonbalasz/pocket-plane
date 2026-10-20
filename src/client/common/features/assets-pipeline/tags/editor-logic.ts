// Tag editor logic (FR-ASSET-47), DOM-free: what an Add / Remove sends as `assets.setTags`.
import { existingSpelling, type TagChips } from "@shared/assets-pipeline/search";
import { ImageTag, TAGS_PER_IMAGE_MAX, tagKey } from "@shared/assets-pipeline/tags";

export const imageFull = `${TAGS_PER_IMAGE_MAX} tags on this image`;

export type AddPlan =
  | { kind: "send"; tags: string[] }
  /** Fold-equal to a tag the image holds: nothing to send. */
  | { kind: "held" }
  | { kind: "invalid"; message: string };

/**
 * Add `typed` (FR-ASSET-39 rules) to `held`: in an existing tag's spelling when fold-equal (the
 * server would store that spelling anyway), appended; the 9th tag is refused here.
 */
export function addTagPlan(held: readonly string[], typed: string, chips: TagChips): AddPlan {
  const parsed = ImageTag.safeParse(typed);
  if (!parsed.success) {
    return { kind: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid tag" };
  }
  const tag = existingSpelling(chips, parsed.data) ?? parsed.data;
  if (held.some((t) => tagKey(t) === tagKey(tag))) return { kind: "held" };
  if (held.length >= TAGS_PER_IMAGE_MAX) return { kind: "invalid", message: imageFull };
  return { kind: "send", tags: [...held, tag] };
}

/** Remove one tag (by key) from `held`. */
export const removeTag = (held: readonly string[], key: string): string[] =>
  held.filter((t) => tagKey(t) !== key);
