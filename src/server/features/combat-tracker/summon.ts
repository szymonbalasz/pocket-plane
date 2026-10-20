// `cbt.summon` (sprint 6, #252, FR-CBT-110, -121; FR-MAP-75): `count` companions of one monster
// definition (imported, compendium or custom; never a pet) for an owner PC of the started
// encounter, in one transaction: tokens on free cells beside the owner's token (owned by the
// owner's player), combatants with owner copies, mode, HP, `card`, side `ally`, the optional
// concentration link, ranks, one `cbt.companion` line; `CompanionsSummoned`, then the `added`
// rule hooks. Not undoable (Dismiss). Summons exist only in a started encounter (OQ-CBT-83c).
import { COMBATANTS_MAX } from "@shared/combat-extras/intents";
import { LOG_KIND_COMPANION } from "@shared/combat-tracker/companion-kind";
import {
  CBT_INTENTS,
  type GridCell,
  SummonInput,
  type SummonResult,
} from "@shared/combat-tracker/schemas";
import { companionCard, effectiveStats, type StatBlock } from "@shared/entities/schemas";
import { CompanionsSummoned } from "@shared/events/combat-tracker";
import { numberedName } from "@shared/scenes-map/geometry";
import { defineCommand } from "../../commands/commands";
import { conflict, invalid } from "../../commands/errors";
import { combatant, combatantSeqNext } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { activeConcentrationOf } from "../combat-extras/rows";
import { gameLog } from "../dice-roll-log";
import { resolveDefinition } from "../entities/commands";
import { getScene, sceneTokens } from "../scenes-map/rows";
import { tokenHiddenForPlayers } from "../scenes-map/visibility-hooks";
import { assertCompanionCap, ownerOfCompanion } from "./companions";
import { rollInitiativeFor } from "./initiative";
import { monsterHp, TokenPlacer } from "./join";
import { combatantDiff, encounterDiff, rerank, syncPlayerTurn } from "./ranks";
import { campaignOf, combatantChange, combatantsOf, getEncounter, readCombatant } from "./rows";
import { CombatRuleHooks } from "./rule-hooks";

/** FR-CBT-110 (§9): a pet joins as itself (Start / Add), never as a summon. */
export const PETS_JOIN_AS_THEMSELVES = "Pets join as themselves";

export const summonCommandWith = (hooks: CombatRuleHooks) =>
  defineCommand({
    name: CBT_INTENTS.summon,
    input: SummonInput,
    execute(input, env): SummonResult {
      const { tx, ctx } = env;
      const cid = campaignOf(env.actor);
      const before = getEncounter(tx, cid, input.encounterId);
      if (before.status !== "started") throw conflict("Encounter is not running");
      const def = resolveDefinition(env, input.definitionId);
      if (def.kind !== "monster") throw invalid("Only monsters can be summoned");
      if ("companionOf" in def && def.companionOf !== null) throw invalid(PETS_JOIN_AS_THEMSELVES);
      const owner = ownerOfCompanion(tx, before, input.ownerCharacterId);
      const rows = combatantsOf(tx, before.id);
      if (rows.length + input.count > COMBATANTS_MAX) {
        throw conflict(`At most ${COMBATANTS_MAX} combatants`);
      }
      assertCompanionCap(rows, { name: owner.name, characterId: owner.row.entityId }, input.count);
      const hpMode = input.hpMode ?? "average";
      if (hpMode === "rolled" && !def.statBlock.hpFormula) {
        const message = `${def.name} has no HP formula`;
        throw invalid(message, [{ path: ["hpMode"], message }]);
      }
      // FR-CBT-110: the link names the owner's active concentration (Conjure Elemental).
      let concentrationEffectId: string | null = null;
      if (input.linkConcentration) {
        const conc = activeConcentrationOf(tx, {
          targetCombatantId: null,
          targetCharacterId: owner.row.entityId,
        });
        if (!conc) throw invalid(`${owner.name} isn't concentrating`);
        concentrationEffectId = conc.id;
      }
      const mode = input.turnMode ?? "after-owner";
      const hidden = input.hidden ?? false;

      // FR-MAP-75: beside the owner's token on the encounter's scene, else `at` / the map centre
      // (FR-CBT-65); no scene (deleted since Start) → token-less.
      const scene = before.sceneId ? getScene(tx, cid, before.sceneId) : null;
      let anchor: GridCell | undefined = input.at;
      if (scene && owner.row.tokenId) {
        const t = sceneTokens(tx, scene.id).find((x) => x.id === owner.row.tokenId);
        if (t) anchor = { col: t.col, row: t.row };
      }
      const placer = scene ? new TokenPlacer(env, scene, anchor) : null;
      const names = rows.map((r) => r.name);
      const card = companionCard(effectiveStats(def as { statBlock: StatBlock }), () =>
        ctx.ids.next(),
      );
      const ids: string[] = [];
      const hpEntries: RecordChange[] = [];
      for (let i = 0; i < input.count; i++) {
        const tok = placer?.place(def, hidden, owner.playerId) ?? null;
        const name = tok ? tok.name : numberedName(def.name.slice(0, 40), names);
        names.push(name);
        const hp = monsterHp(env, def, hpMode, name, before.id);
        if (hp.entry) hpEntries.push(hp.entry);
        const id = ctx.ids.next();
        ids.push(id);
        tx.insert(combatant)
          .values({
            id,
            campaignId: cid,
            encounterId: before.id,
            seq: combatantSeqNext,
            kind: "monster",
            entityId: def.id,
            tokenId: tok?.id ?? null,
            name,
            imageAssetId: tok ? tok.imageAssetId : def.portraitAssetId,
            // FR-FOG-14: a token's hidden copy is its `hidden` or fog-hidden.
            hidden: tok ? tokenHiddenForPlayers(tok) : hidden,
            active: true,
            removed: false,
            initiative: null,
            initRollId: null,
            position: rows.length + ids.length,
            playerPosition: null,
            hpCurrent: hp.hp,
            hpMax: hp.hp,
            tempHp: 0,
            movedFt: 0,
            side: "ally",
            publicSide: "ally",
            ownerCharacterId: owner.row.entityId,
            ownerPlayerId: owner.playerId,
            turnMode: mode,
            pet: false,
            ownerHidden: owner.row.hidden,
            concentrationEffectId,
            // Every summon of one call gets the same stable card row ids (one copy, FR-CBT-117).
            card,
            summoned: true,
          })
          .run();
      }
      const created = ids.map((id) => readCombatant(tx, id));
      // FR-CBT-108: only `own` summons roll (DM-only line, FR-CBT-69); the others use the owner's.
      const init =
        mode === "own"
          ? rollInitiativeFor(env, created, before.id, { mode: "normal" })
          : { entries: [] };
      rerank(tx, before.id);
      const after = syncPlayerTurn(env, before.id);
      const shown = ids.map((id) => readCombatant(tx, id));
      const entry = gameLog.append(env, {
        kind: LOG_KIND_COMPANION,
        category: "other",
        actorName: "DM",
        payload: {
          action: "summon",
          name: def.name,
          ownerName: owner.name,
          ...(input.count > 1 ? { count: input.count } : {}),
        },
        dmPayload: { turnMode: mode },
        rollIds: [],
        encounterId: before.id,
        // FR-CBT-122: public iff players see one of them.
        public: shown.some((c) => !c.hidden && !c.ownerHidden),
      });
      const changes: RecordChange[] = [
        // Tokens first (CBT §9), then the combatants.
        ...(placer?.changes ?? []),
        ...shown.map((c) => combatantChange(null, c)),
        ...hpEntries,
        ...init.entries,
        ...combatantDiff(tx, rows),
        ...encounterDiff(before, after),
        entry,
      ];
      env.emit({
        type: CompanionsSummoned.type,
        campaignId: cid,
        payload: {
          encounterId: before.id,
          combatantIds: ids,
          ownerCharacterId: owner.row.entityId,
        },
        changes,
      });
      // FR-CBTX-13 / FR-MOD-54: as combat-extras' Add, the `added` hooks' rows join its changes.
      changes.push(...hooks.run("added", env, after, { combatantIds: ids }));
      return { combatantIds: ids };
    },
  });

/** Name / type handle (fixture steps, tests); the server registers the hook-bound command. */
export const summonCommand = summonCommandWith(new CombatRuleHooks([]));
