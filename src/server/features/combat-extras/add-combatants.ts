// `cbtx.addCombatants` (FR-CBTX-26/27, #172; sprint 2 FR-CBTX-44): tokens from the map, characters
// or monsters (× quantity, HP mode) from the Add dialog join the started encounter at any round.
// Per monster instance, FR-CBT-64's order: a free placed token → bound; else `createTokens` → a
// created token (`hidden`) around `at`; else token-less, visible (FR-CBT-08). Characters never get
// a created token. Monsters roll initiative on the way in (DM-only, FR-CBT-69); PCs join without.
// Ranks + player turn rewritten; `added` hook (FR-CBTX-13). All or nothing. Encounter entries
// stay the plan (OQ-CBTX-17).
import {
  AddCombatantsInput,
  CBTX_INTENTS,
  COMBATANTS_MAX,
  type CombatantIdsResult,
} from "@shared/combat-extras/intents";
import type { CombatantKind, HpMode } from "@shared/combat-tracker/schemas";
import type { DefinitionRecord } from "@shared/entities/schemas";
import { CombatantsAdded } from "@shared/events/combat-extras";
import { numberedName } from "@shared/scenes-map/geometry";
import type { TokenRecord } from "@shared/scenes-map/schemas";
import { defineCommand } from "../../commands/commands";
import { conflict, invalid, notFound } from "../../commands/errors";
import { combatant, combatantSeqNext } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { getCharacter } from "../character-sheet/hp";
import { rollInitiativeFor } from "../combat-tracker/initiative";
import { monsterHp, TokenPlacer } from "../combat-tracker/join";
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
import { getScene, sceneTokens } from "../scenes-map/rows";

interface Slot {
  kind: CombatantKind;
  def: DefinitionRecord;
  hpMode: HpMode;
  tokenId: string | null;
  name: string;
  imageAssetId: string | null;
  hidden: boolean;
}

const instances = (i: AddCombatantsInput["items"][number]) =>
  "definitionId" in i ? (i.quantity ?? 1) : 1;

export function addCombatantsCommand(hooks: CombatRuleHooks) {
  return defineCommand({
    name: CBTX_INTENTS.addCombatants,
    input: AddCombatantsInput,
    execute({ encounterId, items, createTokens, hidden, at }, env): CombatantIdsResult {
      const { tx, ctx } = env;
      const cid = campaignOf(env.actor);
      const before = getEncounter(tx, cid, encounterId);
      if (before.status !== "started") throw conflict("Encounter is not running");
      const rows = combatantsOf(tx, encounterId);
      const total = items.reduce((n, i) => n + instances(i), 0);
      if (rows.length + total > COMBATANTS_MAX) {
        throw conflict(`At most ${COMBATANTS_MAX} combatants`);
      }
      // FR-CBT-65: no scene (deleted since Start) → no tokens, creatures join token-less.
      const scene = before.sceneId ? getScene(tx, cid, before.sceneId) : null;
      const tokens = scene ? sceneTokens(tx, scene.id) : [];
      const placer = scene && createTokens ? new TokenPlacer(env, scene, at) : null;
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
      // FR-CBT-08: a token's name, image and hidden flag; token-less → numbered, visible.
      const push = (
        kind: CombatantKind,
        def: DefinitionRecord,
        hpMode: HpMode,
        tok: TokenRecord | null,
      ) => {
        const slot: Slot = tok
          ? {
              kind,
              def,
              hpMode,
              tokenId: tok.id,
              name: tok.name,
              imageAssetId: tok.imageAssetId,
              hidden: tok.hidden,
            }
          : {
              kind,
              def,
              hpMode,
              tokenId: null,
              name: numberedName(def.name.slice(0, 40), names),
              imageAssetId: def.portraitAssetId,
              hidden: false,
            };
        names.push(slot.name);
        slots.push(slot);
      };
      items.forEach((it, i) => {
        let tok: TokenRecord | null = null;
        let entityId: string;
        if ("tokenId" in it) {
          tok = tokens.find((x) => x.id === it.tokenId) ?? null;
          if (!tok) throw notFound("Token not found on the encounter's scene");
          if (rows.some((r) => r.active && r.tokenId === it.tokenId)) {
            throw conflict(`${tok.name} is already in combat`);
          }
          entityId = tok.definitionId;
        } else if ("characterId" in it) {
          entityId = getCharacter(env, it.characterId).id;
        } else {
          entityId = it.definitionId;
        }
        const def = resolveDefinition(env, entityId);
        if (def.kind === "character") {
          joinPc(def.id, def.name);
          push("pc", def, "average", tok ?? ("tokenId" in it ? null : nextFreeToken(def.id)));
          return;
        }
        if (def.kind !== "monster") throw invalid("Only monsters and characters can join combat");
        if ("characterId" in it) throw notFound("Character not found");
        if (tok) {
          push("monster", def, "average", tok);
          return;
        }
        const hpMode = ("definitionId" in it && it.hpMode) || "average";
        if (hpMode === "rolled" && !def.statBlock.hpFormula) {
          const message = `${def.name} has no HP formula`;
          throw invalid(message, [{ path: ["items", i, "hpMode"], message }]);
        }
        for (let n = 0; n < instances(it); n++) {
          const free = nextFreeToken(def.id);
          // FR-CBTX-44: a created token takes `hidden`; a bound existing token keeps its own.
          const made = free ?? placer?.place(def, hidden ?? false) ?? null;
          push("monster", def, hpMode, made);
        }
      });

      const ids: string[] = [];
      const hpEntries: RecordChange[] = [];
      for (const s of slots) {
        const id = ctx.ids.next();
        ids.push(id);
        let hp: number | null = null;
        if (s.kind === "monster") {
          const r = monsterHp(env, s.def, s.hpMode, s.name, encounterId);
          hp = r.hp;
          if (r.entry) hpEntries.push(r.entry);
        }
        tx.insert(combatant)
          .values({
            id,
            campaignId: cid,
            encounterId,
            seq: combatantSeqNext,
            kind: s.kind,
            entityId: s.def.id,
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
            hpCurrent: hp,
            hpMax: hp,
            tempHp: 0,
            movedFt: 0,
          })
          .run();
      }
      // FR-CBTX-44: initiative before adding: every added monster, token items included.
      const monsters = ids.map((id) => readCombatant(tx, id)).filter((c) => c.kind === "monster");
      const init = rollInitiativeFor(env, monsters, encounterId, { mode: "normal" });
      rerank(tx, encounterId);
      const after = syncPlayerTurn(env, encounterId);
      const changes: RecordChange[] = [
        ...(placer?.changes ?? []),
        ...ids.map((id) => combatantChange(null, readCombatant(tx, id))),
        ...hpEntries,
        ...init.entries,
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
