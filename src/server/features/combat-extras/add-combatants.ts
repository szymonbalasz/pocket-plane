// `cbtx.addCombatants` (FR-CBTX-26/27, #172): tokens from the map, characters or monsters from a
// picker join the started encounter at any round. Binding as FR-CBT-08; initiative null (sorts
// last, rolls once per FR-CBT-46/47); ranks + player turn rewritten; `added` hook (FR-CBTX-13).
// All or nothing. Encounter entries stay the plan (OQ-CBTX-17).
import {
  AddCombatantsInput,
  CBTX_INTENTS,
  COMBATANTS_MAX,
  type CombatantIdsResult,
} from "@shared/combat-extras/intents";
import type { CombatantKind } from "@shared/combat-tracker/schemas";
import { effectiveStats, type StatBlock } from "@shared/entities/schemas";
import { CombatantsAdded } from "@shared/events/combat-extras";
import { numberedName } from "@shared/scenes-map/geometry";
import { defineCommand } from "../../commands/commands";
import { conflict, invalid, notFound } from "../../commands/errors";
import { combatant, combatantSeqNext } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { getCharacter } from "../character-sheet/hp";
import { combatantDiff, encounterDiff, rerank, syncPlayerTurn } from "../combat-tracker/ranks";
import {
  campaignOf,
  combatantChange,
  combatantsOf,
  getEncounter,
  readCombatant,
} from "../combat-tracker/rows";
import type { CombatRuleHooks } from "../combat-tracker/rule-hooks";
import { resolveDefinition } from "../entities/commands";
import { sceneTokens } from "../scenes-map/rows";

interface Slot {
  kind: CombatantKind;
  entityId: string;
  tokenId: string | null;
  name: string;
  imageAssetId: string | null;
  hidden: boolean;
  hpMax: number | null;
}

export function addCombatantsCommand(hooks: CombatRuleHooks) {
  return defineCommand({
    name: CBTX_INTENTS.addCombatants,
    input: AddCombatantsInput,
    execute({ encounterId, items }, env): CombatantIdsResult {
      const { tx, ctx } = env;
      const cid = campaignOf(env.actor);
      const before = getEncounter(tx, cid, encounterId);
      if (before.status !== "started") throw conflict("Encounter is not running");
      const rows = combatantsOf(tx, encounterId);
      if (rows.length + items.length > COMBATANTS_MAX) {
        throw conflict(`At most ${COMBATANTS_MAX} combatants`);
      }
      const tokens = before.sceneId ? sceneTokens(tx, before.sceneId) : [];
      const taken = new Set(rows.filter((r) => r.active && r.tokenId).map((r) => r.tokenId));
      const inCombat = new Set(
        rows.filter((r) => r.active && r.kind === "pc").map((r) => r.entityId),
      );
      // Tokens named by an item are claimed first, so a picker item never takes them.
      for (const it of items) if ("tokenId" in it) taken.add(it.tokenId);
      const names = rows.map((r) => r.name);
      const slots: Slot[] = [];
      const joinPc = (id: string, name: string) => {
        if (inCombat.has(id)) throw conflict(`${name} is already in combat`);
        inCombat.add(id);
      };
      const nextFreeToken = (definitionId: string) => {
        const t = tokens.find((x) => !taken.has(x.id) && x.definitionId === definitionId);
        if (t) taken.add(t.id);
        return t ?? null;
      };
      for (const it of items) {
        let kind: CombatantKind;
        let entityId: string;
        let hpMax: number | null = null;
        let tok: (typeof tokens)[number] | null;
        if ("tokenId" in it) {
          tok = tokens.find((x) => x.id === it.tokenId) ?? null;
          if (!tok) throw notFound("Token not found on the encounter's scene");
          if (rows.some((r) => r.active && r.tokenId === it.tokenId)) {
            throw conflict(`${tok.name} is already in combat`);
          }
          entityId = tok.definitionId;
        } else if ("characterId" in it) {
          entityId = getCharacter(env, it.characterId).id;
          tok = null;
        } else {
          entityId = it.definitionId;
          tok = null;
        }
        const def = resolveDefinition(env, entityId);
        if (def.kind === "character") {
          kind = "pc";
          joinPc(def.id, def.name);
        } else if (def.kind === "monster") {
          kind = "monster";
          hpMax = effectiveStats(def as { statBlock: StatBlock }).hpMax;
        } else {
          throw invalid("Only monsters and characters can join combat");
        }
        if ("characterId" in it && kind !== "pc") throw notFound("Character not found");
        if (!tok && !("tokenId" in it)) tok = nextFreeToken(def.id);
        // FR-CBT-08: a token's name, image and hidden flag; token-less → numbered, visible.
        const slot: Slot = tok
          ? {
              kind,
              entityId: def.id,
              tokenId: tok.id,
              name: tok.name,
              imageAssetId: tok.imageAssetId,
              hidden: tok.hidden,
              hpMax,
            }
          : {
              kind,
              entityId: def.id,
              tokenId: null,
              name: numberedName(def.name.slice(0, 40), names),
              imageAssetId: def.portraitAssetId,
              hidden: false,
              hpMax,
            };
        names.push(slot.name);
        slots.push(slot);
      }
      const ids: string[] = [];
      for (const s of slots) {
        const id = ctx.ids.next();
        ids.push(id);
        tx.insert(combatant)
          .values({
            id,
            campaignId: cid,
            encounterId,
            seq: combatantSeqNext,
            kind: s.kind,
            entityId: s.entityId,
            tokenId: s.tokenId,
            name: s.name,
            imageAssetId: s.imageAssetId,
            hidden: s.hidden,
            active: true,
            removed: false,
            initiative: null,
            initRollId: null,
            position: rows.length + ids.length,
            playerPosition: null,
            hpCurrent: s.hpMax,
            hpMax: s.hpMax,
            tempHp: 0,
            movedFt: 0,
          })
          .run();
      }
      rerank(tx, encounterId);
      const after = syncPlayerTurn(env, encounterId);
      const changes: RecordChange[] = [
        ...ids.map((id) => combatantChange(null, readCombatant(tx, id))),
        ...combatantDiff(tx, rows),
        ...encounterDiff(before, after),
      ];
      env.emit({
        type: CombatantsAdded.type,
        campaignId: cid,
        payload: { encounterId, combatantIds: ids },
        changes,
      });
      // FR-CBTX-27: `added` hooks after the owner event; their rows join its changes.
      changes.push(...hooks.run("added", env, after, { combatantIds: ids }));
      return { combatantIds: ids };
    },
  });
}
