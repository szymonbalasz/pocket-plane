// gems commands (GEM §9): `gem.adjust` (DM award / remove, FR-GEM-07, -09) and the plain
// `gem.spend` (FR-GEM-12–16). Both check the `gems` switch first (FR-GEM-03) and write count +
// line + event in one transaction.
import { GEMS_FEATURE } from "@shared/campaign-management/features";
import { GemSpent, GemsAdjusted } from "@shared/events/gems";
import { gemsPhrase } from "@shared/gems/log-kinds";
import {
  GEM_ADJUST_INTENT,
  GEM_COUNT_MAX,
  GEM_NAME,
  GEM_SPEND_INTENT,
  GemAdjustInput,
  type GemAdjustResult,
  GemSpendInput,
  type GemSpendResult,
  LOG_KIND_GEM_AWARD,
  LOG_KIND_GEM_SPEND,
  spendCost,
} from "@shared/gems/schemas";
import { defineCommand } from "../../commands/commands";
import { conflict, invalid } from "../../commands/errors";
import { assertFeatureOn } from "../campaign-management/features";
import { gameLog } from "../dice-roll-log";
import { characterFor, heldOf, writeCount } from "./rows";

/** FR-GEM-03: the reject of every `gem.*` intent while gems are off. */
export const GEMS_OFF = "Gems are off in this campaign";

/**
 * FR-GEM-07: `delta` −5…+5 (≠ 0, zod); the result must stay 0–99 (`invalid`). An award (delta > 0)
 * writes a public `gem.award` line (FR-GEM-09); a removal writes none (OQ-GEM-10 A).
 */
export const adjustGems = defineCommand({
  name: GEM_ADJUST_INTENT,
  input: GemAdjustInput,
  execute({ characterId, gem, delta }, env): GemAdjustResult {
    assertFeatureOn(env, GEMS_FEATURE, GEMS_OFF);
    const ch = characterFor(env, characterId);
    const held = heldOf(env.tx, ch.id, gem) + delta;
    if (held < 0) throw invalid(`${ch.name} has no ${GEM_NAME[gem]} gem to remove`);
    if (held > GEM_COUNT_MAX) throw invalid(`At most ${GEM_COUNT_MAX} ${GEM_NAME[gem]} gems`);
    const changes = [writeCount(env, ch, gem, held)];
    let entryId: string | undefined;
    if (delta > 0) {
      const line = gameLog.append(env, {
        kind: LOG_KIND_GEM_AWARD,
        category: "other",
        actorName: ch.name,
        payload: { characterId: ch.id, gem, count: delta, held },
        rollIds: [],
        public: true,
      });
      entryId = line.id;
      changes.push(line);
    }
    env.emit({
      type: GemsAdjusted.type,
      campaignId: ch.campaignId,
      payload: { characterId: ch.id, gem, delta, held, ...(entryId ? { entryId } : {}) },
      changes,
    });
    return { held };
  },
});

/**
 * FR-GEM-12–16: the owner (or the DM, OQ-GEM-14 A) spends; too few → `conflict`. Count − cost +
 * a public `gem.spend` line (roller = sender, OQ-GEM-02 A) + `GemSpent`.
 */
export const spendGem = defineCommand({
  name: GEM_SPEND_INTENT,
  input: GemSpendInput,
  roles: ["dm", "player"],
  execute({ characterId, gem, use }, env): GemSpendResult {
    assertFeatureOn(env, GEMS_FEATURE, GEMS_OFF);
    const ch = characterFor(env, characterId, { owner: true });
    const cost = spendCost(gem, use);
    const before = heldOf(env.tx, ch.id, gem);
    if (before === 0) throw conflict(`No ${GEM_NAME[gem]} gem left`);
    if (before < cost) throw conflict(`${gemsPhrase(gem, cost)} needed, ${before} left`);
    const held = before - cost;
    const count = writeCount(env, ch, gem, held);
    const line = gameLog.append(env, {
      kind: LOG_KIND_GEM_SPEND,
      category: "other",
      actorName: ch.name,
      payload: { characterId: ch.id, gem, count: cost, ...(use ? { use } : {}) },
      rollIds: [],
      public: true,
    });
    env.emit({
      type: GemSpent.type,
      campaignId: ch.campaignId,
      payload: { characterId: ch.id, gem, cost, held, entryId: line.id, rollIds: [] },
      changes: [count, line],
    });
    return { held, entryId: line.id };
  },
});
