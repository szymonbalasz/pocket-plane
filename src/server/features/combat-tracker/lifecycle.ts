// Start / End (FR-CBT-07, FR-CBT-08, FR-CBT-10; End dismisses pending cards, FR-CBT-59/61).
// `started` / `ended` rule hooks run after the event (FR-CBTX-01, ADR-0035).
import { type BindSlot, planBindings } from "@shared/combat-tracker/rules";
import { CBT_INTENTS, EndInput, StartInput } from "@shared/combat-tracker/schemas";
import { effectiveStats, entityNameKey, type StatBlock } from "@shared/entities/schemas";
import { EncounterEnded, EncounterStarted } from "@shared/events/combat-tracker";
import { and, eq } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict } from "../../commands/errors";
import { combatant, combatantSeqNext, creatureSheet, encounter, entity } from "../../db/schema";
import { resolveDefinition } from "../entities/commands";
import { dismissForEncounter } from "../notifications";
import { getScene, sceneTokens } from "../scenes-map/rows";
import { rerank } from "./ranks";
import {
  campaignOf,
  combatantChange,
  combatantsOf,
  encounterChange,
  entriesOf,
  getEncounter,
  readEncounter,
  startedEncounter,
} from "./rows";
import { CombatRuleHooks } from "./rule-hooks";

/**
 * FR-CBT-02: `null` = every character of the campaign now, drafts left out (FR-CHARX-11,
 * OQ-CBT-46); an explicit list may hold drafts. By name (case-insensitive), id.
 */
export function partyOf(env: Pick<CommandEnv, "tx">, cid: string, ids: string[] | null) {
  const all = env.tx
    .select({
      id: entity.id,
      name: entity.name,
      portraitAssetId: entity.portraitAssetId,
      statBlock: entity.statBlock,
      status: creatureSheet.status,
    })
    .from(entity)
    .leftJoin(creatureSheet, eq(creatureSheet.entityId, entity.id))
    .where(and(eq(entity.campaignId, cid), eq(entity.kind, "character")))
    .all();
  const wanted = ids === null ? null : new Set(ids);
  return all
    .filter((c) => (wanted === null ? c.status !== "draft" : wanted.has(c.id)))
    .sort((a, b) => {
      const ka = entityNameKey(a.name);
      const kb = entityNameKey(b.name);
      if (ka !== kb) return ka < kb ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
}

export const startCommandWith = (hooks: CombatRuleHooks) =>
  defineCommand({
    name: CBT_INTENTS.start,
    input: StartInput,
    execute({ encounterId, sceneId }, env): void {
      const { tx, ctx } = env;
      const cid = campaignOf(env.actor);
      const before = getEncounter(tx, cid, encounterId);
      if (before.status !== "planned") throw conflict("Only a planned encounter can start");
      if (startedEncounter(tx, cid)) throw conflict("Another encounter is running");
      const scene = getScene(tx, cid, sceneId);

      const slots: (BindSlot & { hpMax: number | null })[] = [];
      for (const c of partyOf(env, cid, before.partyCharacterIds)) {
        slots.push({
          kind: "pc",
          entityId: c.id,
          name: c.name,
          portraitAssetId: c.portraitAssetId,
          hpMax: null,
        });
      }
      for (const e of entriesOf(tx, before)) {
        const def = resolveDefinition(env, e.definitionId);
        const hpMax = effectiveStats(def as { statBlock: StatBlock }).hpMax;
        for (let i = 0; i < e.quantity; i++) {
          slots.push({
            kind: "monster",
            entityId: def.id,
            name: def.name,
            portraitAssetId: def.portraitAssetId,
            hpMax,
          });
        }
      }
      const bindings = planBindings(slots, sceneTokens(tx, scene.id));
      bindings.forEach((b, i) => {
        const hpMax = slots[i]?.hpMax ?? null;
        tx.insert(combatant)
          .values({
            id: ctx.ids.next(),
            campaignId: cid,
            encounterId,
            seq: combatantSeqNext,
            kind: b.kind,
            entityId: b.entityId,
            tokenId: b.tokenId,
            name: b.name,
            imageAssetId: b.imageAssetId,
            hidden: b.hidden,
            active: true,
            removed: false,
            initiative: null,
            initRollId: null,
            position: i + 1,
            playerPosition: null,
            hpCurrent: hpMax,
            hpMax,
          })
          .run();
      });
      rerank(tx, encounterId);
      const now = ctx.clock.iso();
      tx.update(encounter)
        .set({
          status: "started",
          sceneId: scene.id,
          round: 0,
          turnCombatantId: null,
          playerTurnCombatantId: null,
          startedAt: now,
          updatedAt: now,
        })
        .where(eq(encounter.id, encounterId))
        .run();
      const after = readEncounter(tx, encounterId);
      const rows = combatantsOf(tx, encounterId);
      const combatantIds = rows.map((r) => r.id);
      const changes = [
        encounterChange(before, after),
        ...rows.map((r) => combatantChange(null, r)),
      ];
      env.emit({
        type: EncounterStarted.type,
        campaignId: cid,
        payload: { encounterId, sceneId: scene.id, combatantIds },
        changes,
      });
      changes.push(...hooks.run("started", env, after, { combatantIds }));
    },
  });

export const endCommandWith = (hooks: CombatRuleHooks) =>
  defineCommand({
    name: CBT_INTENTS.end,
    input: EndInput,
    execute({ encounterId }, env): void {
      const { tx, ctx } = env;
      const cid = campaignOf(env.actor);
      const before = getEncounter(tx, cid, encounterId);
      if (before.status !== "started") throw conflict("Encounter is not running");
      const rows = combatantsOf(tx, encounterId);
      const now = ctx.clock.iso();
      tx.update(encounter)
        .set({ status: "ended", endedAt: now, updatedAt: now })
        .where(eq(encounter.id, encounterId))
        .run();
      tx.update(combatant)
        .set({ active: false })
        .where(eq(combatant.encounterId, encounterId))
        .run();
      const after = readEncounter(tx, encounterId);
      const changes = [
        encounterChange(before, after),
        ...rows.map((r) => combatantChange(r, { ...r, active: false })),
      ];
      env.emit({ type: EncounterEnded.type, campaignId: cid, payload: { encounterId }, changes });
      changes.push(...hooks.run("ended", env, after, { combatantIds: rows.map((r) => r.id) }));
      // FR-CBT-59 / FR-CBT-61: after `EncounterEnded`, one `NotificationDismissed` per pending card
      // of this encounter whose kind opts in (`damage-card`); same transaction.
      dismissForEncounter(env, encounterId);
    },
  });

/** Name / type handles (fixture steps, tests); the server registers the hook-bound commands. */
export const startCommand = startCommandWith(new CombatRuleHooks([]));
export const endCommand = endCommandWith(new CombatRuleHooks([]));
