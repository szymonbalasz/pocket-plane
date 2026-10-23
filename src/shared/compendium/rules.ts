// Rules window REST shapes (CMP §9, FR-CMP-65) and the browser pins (FR-CMP-66). zod is the
// source of truth. Pages are computed per request from `rules-pages.ts` + the viewer's visible
// entries; nothing here is a record type (FR-CMP-71: 0 B).
import { z } from "zod";
import { SourceAttribution } from "./rest";
import { RULES_PINS_MAX } from "./rules-pages";
import { EntryName, RULE_SECTION_MAX } from "./schemas";

const Id = z.string().min(1).max(64);

/** One card of the page index: names only (FR-CMP-65). `section` "Conditions" for conditions. */
export const RuleCardSummary = z.strictObject({
  id: Id,
  name: EntryName,
  section: z.string().max(RULE_SECTION_MAX),
});
export type RuleCardSummary = z.infer<typeof RuleCardSummary>;

export const RulesPageIndex = z.strictObject({
  id: z.string().min(1).max(40),
  title: z.string().min(1).max(40),
  cards: z.array(RuleCardSummary),
});
export type RulesPageIndex = z.infer<typeof RulesPageIndex>;

/**
 * `GET /api/compendium/rules`: every server page (curated + House rules; Pinned is the
 * client's) with its resolved cards. `attribution` null = the SRD isn't imported.
 */
export const RulesIndexResponse = z.strictObject({
  pages: z.array(RulesPageIndex),
  attribution: SourceAttribution.nullable(),
});
export type RulesIndexResponse = z.infer<typeof RulesIndexResponse>;

/** A card with its text (FR-CMP-65). `house`: a homebrew rule; `shared` false only for the DM. */
export const RuleCardBody = RuleCardSummary.extend({
  text: z.string(),
  house: z.boolean(),
  shared: z.boolean(),
});
export type RuleCardBody = z.infer<typeof RuleCardBody>;

/** `GET /api/compendium/rules/:pageId`. */
export const RulesPageResponse = z.strictObject({ id: z.string(), cards: z.array(RuleCardBody) });
export type RulesPageResponse = z.infer<typeof RulesPageResponse>;

/** FR-CMP-68 (review-a ruling 18): what changed, under the SRD statement in About. */
export const RULES_CHANGE_NOTE =
  "Rules text from the SRD 5.1, split into cards at its headings and reformatted; wording unchanged.";

/** Section label of a condition card on the Conditions page. */
export const CONDITIONS_SECTION = "Conditions";

/**
 * FR-CMP-66 pins as stored (`pp.rules.pins.v1.<campaignId>`): unknown JSON in, ≤ 30 unique ids
 * out, first kept; anything unreadable → none. Stale ids are dropped by the window when a fetch
 * says 404 (CMP §11).
 */
export function parsePins(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (!Id.safeParse(v).success || out.includes(v as string)) continue;
    out.push(v as string);
    if (out.length === RULES_PINS_MAX) break;
  }
  return out;
}
