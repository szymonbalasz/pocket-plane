// Campaign feature registry (FR-CAMP-41, ADR-0058). APPEND-ONLY (AGENTS §9.9): an optional
// feature adds one line to the list; nothing else changes here. Every feature is off by default.
import { z } from "zod";

export interface FeatureDef {
  /** Kebab-case key: `campaign.features` entries, `feature:` tags, `featureOn` / `useFeature`. */
  key: string;
  /** Campaign options row and the "‹label› is off in this campaign" reject. */
  label: string;
  /** ≤ 120 chars, under the label in Campaign options (FR-CAMP-42). */
  description: string;
  /** Asked once when the DM turns the feature off (≤ 120 chars). */
  offConfirm?: string;
  /** Front-matter prefix of the owning spec (e.g. `GEM`). */
  ownerSpec: string;
}

/** Gems (homebrew, #140 / #312): the first feature. */
export const GEMS_FEATURE = "gems";

export const FEATURES: readonly FeatureDef[] = [
  {
    key: GEMS_FEATURE,
    label: "Gems (homebrew)",
    description: "Award gems to characters; players spend them for rerolls, maxed dice and more.",
    offConfirm: "Hide gems? Counts are kept and come back when you turn gems on",
    ownerSpec: "GEM",
  }, // gems (GEM, fix/gems-core)
];

const byKey = new Map(FEATURES.map((f) => [f.key, f]));

export const featureDef = (key: string): FeatureDef | undefined => byKey.get(key);

/** A registered key (FR-CAMP-39: anything else → `invalid`). */
export const FeatureKey = z
  .string()
  .max(40)
  .refine((k) => byKey.has(k), { message: "Unknown feature" });

/** Is `key` among a campaign's enabled features (`campaign.features`; absent = none)? */
export const hasFeature = (features: readonly string[] | undefined, key: string): boolean =>
  features?.includes(key) ?? false;
