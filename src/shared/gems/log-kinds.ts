// Log-entry kinds `gem.award` (FR-GEM-09) and `gem.spend` (FR-GEM-12–16), both tagged with the
// `gems` feature (FR-DICE-69): while gems are off no viewer receives them. The entry's actor is the
// character; lines are public (OQ-GEM-02 A, OQ-GEM-10 A).
import { GEMS_FEATURE } from "@shared/campaign-management/features";
import { defineLogKind, type LineSegment } from "@shared/dice-roll-log/kind-types";
import { z } from "zod";
import {
  ActionUse,
  GEM_COUNT_MAX,
  GEM_DELTA_MAX,
  GEM_NAME,
  GemKind,
  LOG_KIND_GEM_AWARD,
  LOG_KIND_GEM_SPEND,
} from "./schemas";

export const GemAwardPayload = z.strictObject({
  characterId: z.string(),
  gem: GemKind,
  count: z.int().min(1).max(GEM_DELTA_MAX),
  held: z.int().min(0).max(GEM_COUNT_MAX),
});
export type GemAwardPayload = z.infer<typeof GemAwardPayload>;

export const GemSpendPayload = z.strictObject({
  characterId: z.string(),
  gem: GemKind,
  count: z.int().min(1).max(3),
  use: ActionUse.optional(),
});
export type GemSpendPayload = z.infer<typeof GemSpendPayload>;

/** "an Inspiration gem" / "a Fortune gem" / "2 Action gems". */
export function gemsPhrase(gem: GemKind, count: number): string {
  const name = GEM_NAME[gem];
  if (count !== 1) return `${count} ${name} gems`;
  return `${/^[AEIOU]/.test(name) ? "an" : "a"} ${name} gem`;
}

const ACTION_TEXT: Record<ActionUse, string> = {
  bonus: "a bonus action",
  reaction: "a reaction",
  action: "a full action",
};

/** FR-GEM-14–16, OQ-GEM-06 A: what a plain spend is for (null: none, e.g. a later target spend). */
export function spendPurpose(p: Pick<GemSpendPayload, "gem" | "use">): string | null {
  switch (p.gem) {
    case "fortune":
      return "searching for treasure";
    case "divine":
      return "asks the gods a question";
    case "action":
      return p.use ? ACTION_TEXT[p.use] : null;
    case "inspiration":
      return "to recall";
    default:
      return null;
  }
}

/** FR-GEM-09: "DM awards Mira an Inspiration gem (2 held)". */
export const gemAwardKind = defineLogKind<GemAwardPayload>({
  kind: LOG_KIND_GEM_AWARD,
  feature: GEMS_FEATURE,
  payload: GemAwardPayload,
  formatLine({ actorName, payload: p }) {
    return [
      { text: "DM awards " },
      { text: actorName, style: "actor" },
      { text: ` ${gemsPhrase(p.gem, p.count)} (${p.held} held)` },
    ];
  },
});

/** FR-GEM-14–16: "Brakka spends 2 Action gems — a full action". */
export const gemSpendKind = defineLogKind<GemSpendPayload>({
  kind: LOG_KIND_GEM_SPEND,
  feature: GEMS_FEATURE,
  payload: GemSpendPayload,
  formatLine({ actorName, payload: p }) {
    const purpose = spendPurpose(p);
    const out: LineSegment[] = [
      { text: actorName, style: "actor" },
      { text: ` spends ${gemsPhrase(p.gem, p.count)}` },
    ];
    if (purpose) out.push({ text: ` — ${purpose}` });
    return out;
  },
});
