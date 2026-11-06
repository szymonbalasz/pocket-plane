// Class resources over the command bus (class-resources FR-CRES-06, -07, -11, -12):
// `char.convertSlot` (a slot or a pact slot → sorcery points), `char.createSlot` (points → a
// created slot), `char.useFeature` (a feature row's spend link) and `char.undoResourceUse`.
// Characters only; DM and the owner, also on a locked sheet (counters, FR-CHARX-12). Each writes
// the sheet and one `char.resourceUse` game-log line in one transaction; the line stores the exact
// counter changes, which Undo gives back. Rules: `@shared/character-sheet/sorcery`, `resource-use`.

import {
  applyOps,
  type Counters,
  flexPayload,
  opsBetween,
  planUse,
  undoBlock,
} from "@shared/character-sheet/resource-use";
import {
  LOG_KIND_RESOURCE_USE,
  ResourceUsePayload,
} from "@shared/character-sheet/resource-use-kind";
import { LOG_KIND_CHAR_REST } from "@shared/character-sheet/rest-kind";
import {
  CHARX_INTENTS,
  CharConvertSlotIntent,
  CharCreateSlotIntent,
  type CharSlotPointsResult,
  CharUndoResourceUseIntent,
  CharUseFeatureIntent,
  type CharUseFeatureResult,
  type CreatureSheetRecord,
} from "@shared/character-sheet/sheet";
import { convertSlot, createSlot, type FlexOutcome } from "@shared/character-sheet/sorcery";
import type { CharacterRecord } from "@shared/entities/schemas";
import {
  CharacterFeatureUsed,
  CharacterResourceUseUndone,
  CharacterSlotConverted,
  CharacterSlotCreated,
} from "@shared/events/character-sheet";
import { and, eq, gt } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, forbidden, invalid, notFound } from "../../commands/errors";
import { gameLogEntry } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { gameLog } from "../dice-roll-log";
import { counterCharacter } from "./access";
import { mergeChanges, sheetOrNew, writeSheet } from "./sheet-rows";

function settled(o: FlexOutcome): Extract<FlexOutcome, { ok: true }> {
  if (!o.ok) throw invalid(o.message);
  return o;
}

const countersOf = (s: CreatureSheetRecord): Counters => ({
  slotsUsed: s.slotsUsed,
  slotsCreated: s.slotsCreated,
  pactUsed: s.pactUsed,
  features: s.features,
});

/**
 * FR-CRES-12 (OQ-CRES-05 A): public unless the sender keeps it private; private = the DM and the
 * owner (an unowned character: the DM only).
 */
function appendLine(
  env: CommandEnv,
  c: CharacterRecord,
  payload: Omit<ResourceUsePayload, "characterId">,
  isPublic: boolean | undefined,
): RecordChange {
  const owner = c.ownerPlayerId || null;
  const audience =
    isPublic === false
      ? owner
        ? { audience: { public: false as const, audiencePlayerId: owner } }
        : { forcePrivate: true }
      : { audience: { public: true as const } };
  return gameLog.append(env, {
    kind: LOG_KIND_RESOURCE_USE,
    category: "other",
    actorName: c.name,
    payload: { characterId: c.id, ...payload },
    rollIds: [],
    ...audience,
  });
}

export const charConvertSlot = defineCommand({
  name: CHARX_INTENTS.convertSlot,
  input: CharConvertSlotIntent,
  roles: ["dm", "player"],
  execute(input, env): CharSlotPointsResult {
    const c = counterCharacter(env, input.characterId);
    const { before: row, sheet } = sheetOrNew(env, c);
    const out = settled(convertSlot(sheet, c.statBlock, input.from));
    const change = writeSheet(env, row, { ...sheet, ...out.sheet });
    const ops = opsBetween(countersOf(sheet), out.sheet);
    const line = appendLine(
      env,
      c,
      flexPayload("convert", out.sheet, { from: input.from }, out.points, ops),
      input.public,
    );
    env.emit({
      type: CharacterSlotConverted.type,
      campaignId: c.campaignId,
      payload: { characterId: c.id, from: input.from, points: out.points, entryId: line.id },
      changes: mergeChanges([change, line]),
    });
    return { points: out.points.after, entryId: line.id };
  },
});

export const charCreateSlot = defineCommand({
  name: CHARX_INTENTS.createSlot,
  input: CharCreateSlotIntent,
  roles: ["dm", "player"],
  execute(input, env): CharSlotPointsResult {
    const c = counterCharacter(env, input.characterId);
    const { before: row, sheet } = sheetOrNew(env, c);
    const out = settled(createSlot(sheet, input.level));
    const change = writeSheet(env, row, { ...sheet, ...out.sheet });
    const ops = opsBetween(countersOf(sheet), out.sheet);
    const line = appendLine(
      env,
      c,
      flexPayload("create", out.sheet, { level: input.level }, out.points, ops),
      input.public,
    );
    env.emit({
      type: CharacterSlotCreated.type,
      campaignId: c.campaignId,
      payload: { characterId: c.id, level: input.level, points: out.points, entryId: line.id },
      changes: mergeChanges([change, line]),
    });
    return { points: out.points.after, entryId: line.id };
  },
});

export const charUseFeature = defineCommand({
  name: CHARX_INTENTS.useFeature,
  input: CharUseFeatureIntent,
  roles: ["dm", "player"],
  execute(input, env): CharUseFeatureResult {
    const c = counterCharacter(env, input.characterId);
    const { before: row, sheet } = sheetOrNew(env, c);
    const plan = planUse(sheet, c.statBlock, input.rowId, input);
    if (!plan.ok) {
      if (plan.message === "Feature was deleted") throw notFound(plan.message);
      throw plan.code === "conflict" ? conflict(plan.message) : invalid(plan.message);
    }
    const next = applyOps(countersOf(sheet), c.statBlock, plan.ops, 1);
    const change = writeSheet(env, row, { ...sheet, ...next });
    const line = appendLine(env, c, plan.payload, input.public);
    env.emit({
      type: CharacterFeatureUsed.type,
      campaignId: c.campaignId,
      payload: { characterId: c.id, rowId: input.rowId, entryId: line.id },
      changes: mergeChanges([change, line]),
    });
    return { entryId: line.id };
  },
});

/** FR-CRES-12: a long rest of this character after line `n` ends its Undo. */
function restedSince(env: CommandEnv, campaignId: string, characterId: string, n: number) {
  return env.tx
    .select({ payload: gameLogEntry.payload })
    .from(gameLogEntry)
    .where(
      and(
        eq(gameLogEntry.campaignId, campaignId),
        eq(gameLogEntry.kind, LOG_KIND_CHAR_REST),
        gt(gameLogEntry.n, n),
      ),
    )
    .all()
    .some((r) => {
      const p = r.payload as { characterId?: string; kind?: string };
      return p.characterId === characterId && p.kind === "long";
    });
}

export const charUndoResourceUse = defineCommand({
  name: CHARX_INTENTS.undoResourceUse,
  input: CharUndoResourceUseIntent,
  roles: ["dm", "player"],
  execute(input, env): Record<string, never> {
    const campaignId = env.actor.campaignId ?? "";
    const entry = env.tx
      .select()
      .from(gameLogEntry)
      .where(and(eq(gameLogEntry.id, input.entryId), eq(gameLogEntry.campaignId, campaignId)))
      .get();
    if (!entry || entry.kind !== LOG_KIND_RESOURCE_USE) throw notFound("Log entry not found");
    if (env.actor.role === "player" && entry.rollerPlayerId !== env.actor.playerId) {
      throw forbidden("Only its sender or the DM can undo this");
    }
    if (entry.undone) throw conflict("Already undone");
    const payload = ResourceUsePayload.parse(entry.payload);
    const c = counterCharacter(env, payload.characterId);
    if (restedSince(env, campaignId, c.id, entry.n)) {
      throw conflict("A long rest came after this: nothing to undo");
    }
    const { before: row, sheet } = sheetOrNew(env, c);
    const blocked = undoBlock(countersOf(sheet), payload.ops);
    if (blocked) throw conflict(blocked);
    const next = applyOps(countersOf(sheet), c.statBlock, payload.ops, -1);
    const change = writeSheet(env, row, { ...sheet, ...next });
    const line = gameLog.markUndone(env, entry.id);
    env.emit({
      type: CharacterResourceUseUndone.type,
      campaignId: c.campaignId,
      payload: { characterId: c.id, entryId: entry.id },
      changes: mergeChanges([change, line]),
    });
    return {};
  },
});
