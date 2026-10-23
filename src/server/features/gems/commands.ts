// gems commands (GEM §9): `gem.adjust` (DM award / remove, FR-GEM-07, -09) and `gem.spend`: the
// plain spends (FR-GEM-12–16) and the Inspiration reroll (FR-GEM-18–24, GM1). Both check the
// `gems` switch first (FR-GEM-03) and write count + line(s) + event in one transaction.
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
import type { RecordChange } from "../../events/types";
import { assertFeatureOn } from "../campaign-management/features";
import { cards } from "../combat-tracker/cards";
import { dice as diceLog, gameLog } from "../dice-roll-log";
import { cardDetailByAudience, combatTarget } from "./combat";
import { entryTarget, rerollTarget, targetByAudience, visibleEntry } from "./reroll";
import { characterFor, heldOf, writeCount } from "./rows";

/** FR-GEM-03: the reject of every `gem.*` intent while gems are off. */
export const GEMS_OFF = "Gems are off in this campaign";

/**
 * FR-GEM-07: `delta` −10…+10 (≠ 0, zod; FR-GEM-43 widened it for summed quick clicks); the result must stay 0–99 (`invalid`). An award (delta > 0)
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
 * a public `gem.spend` line (roller = sender, OQ-GEM-02 A) + `GemSpent`. FR-GEM-18–24: with
 * `entryId`, an Inspiration gem rerolls that line's d20 (`dice.reroll`: new roll + new line, the
 * old one superseded; roll hooks not re-run); the spend line comes first, its target detail by
 * the target's audience (FR-GEM-13); a pending combat to-hit's card follows (FR-GEM-22).
 * FR-GEM-25–31 (GM2): with `cardId` + `dice`, a Combat gem sets 1–3 weapon dice of the pending
 * card to their max (`cards.maxDice`: new roll rows, the totals recomputed, `maxed` marks).
 */
export const spendGem = defineCommand({
  name: GEM_SPEND_INTENT,
  input: GemSpendInput,
  roles: ["dm", "player"],
  execute({ characterId, gem, use, entryId, manual, cardId, dice, known }, env): GemSpendResult {
    assertFeatureOn(env, GEMS_FEATURE, GEMS_OFF);
    const ch = characterFor(env, characterId, { owner: true });
    // FR-GEM-18, -25: checked before anything is written (a reject writes nothing); a line or
    // card the sender doesn't receive is `not_found` whatever they hold (GEM §11).
    const target = entryId === undefined ? null : rerollTarget(env, ch, visibleEntry(env, entryId));
    const combat =
      cardId !== undefined && dice !== undefined
        ? combatTarget(env, ch, { cardId, dice, ...(known ? { known } : {}) })
        : null;
    const cost = spendCost(gem, use);
    const before = heldOf(env.tx, ch.id, gem);
    if (before === 0) throw conflict(`No ${GEM_NAME[gem]} gem left`);
    if (before < cost) throw conflict(`${gemsPhrase(gem, cost)} needed, ${before} left`);
    const held = before - cost;
    const count = writeCount(env, ch, gem, held);
    const detail = target
      ? targetByAudience(target.entry, entryTarget(target.entry, target.rollId))
      : combat
        ? cardDetailByAudience(combat.plan, combat.hidden)
        : null;
    const line = gameLog.append(env, {
      kind: LOG_KIND_GEM_SPEND,
      category: "other",
      actorName: ch.name,
      payload: {
        characterId: ch.id,
        gem,
        count: cost,
        ...(use ? { use } : {}),
        ...(detail?.payload ?? {}),
      },
      ...(detail?.dmPayload ? { dmPayload: detail.dmPayload } : {}),
      rollIds: [],
      public: true,
    });
    if (combat) {
      // FR-GEM-29 (FR-CBT-128): the new roll rows' ids, named by the event. FR-GEM-42 (BL-63):
      // the card is written first, its change rides on `GemSpent` (one frame per spend).
      const rollIds = combat.plan.parts.map(() => env.ctx.ids.next());
      const card = cards.applyMaxDice(env, combat.plan, rollIds);
      env.emit({
        type: GemSpent.type,
        campaignId: ch.campaignId,
        payload: {
          characterId: ch.id,
          gem,
          cost,
          held,
          entryId: line.id,
          cardId: combat.plan.card.id,
          rollIds,
        },
        changes: [count, line, card.change],
      });
      return { held, entryId: line.id };
    }
    if (!target) {
      env.emit({
        type: GemSpent.type,
        campaignId: ch.campaignId,
        payload: { characterId: ch.id, gem, cost, held, entryId: line.id, rollIds: [] },
        changes: [count, line],
      });
      return { held, entryId: line.id };
    }
    // FR-GEM-19, -21, -24: the new roll + line (audience copied), the old line superseded.
    // FR-GEM-41 (BL-62): a pending card follows the new to-hit (FR-GEM-22) before the line is
    // built, and the line takes the card's current damage (FR-DICE-91); FR-GEM-42: its change
    // rides on `GemSpent`.
    const { card: followed } = target;
    let cardChange: RecordChange | null = null;
    const rr = diceLog.reroll(env, {
      entryId: target.entry.id,
      rollId: target.rollId,
      manual,
      ...(followed
        ? {
            others: (item, old) => {
              const r = cards.replaceToHit(env, followed.id, item);
              cardChange = r.change;
              return cards.cardLineItems(env, r.payload, item, old);
            },
          }
        : {}),
    });
    env.emit({
      type: GemSpent.type,
      campaignId: ch.campaignId,
      payload: {
        characterId: ch.id,
        gem,
        cost,
        held,
        entryId: line.id,
        rerollEntryId: rr.entry.id,
        supersededEntryId: target.entry.id,
        ...(target.card ? { cardId: target.card.id } : {}),
        rollIds: [rr.roll.id],
      },
      changes: [count, line, rr.entry, rr.superseded, ...(cardChange ? [cardChange] : [])],
    });
    return { held, entryId: line.id, rerollEntryId: rr.entry.id };
  },
});
