// dice-extras' definition-changed hook line (FR-DICEX-65, review A #2; entities' registry): a
// PC's owner change, in the update's transaction. (1) Its macros on the old owner's list move to
// the new owner (rows the old owner made become the new owner's; no owner → DM only). (2) Its
// open request targets become `missed` and their prompts are resolved by rule (no re-target; the
// DM re-asks); a request with no open target left closes. Hooks never emit: the changes ride on
// `EntityUpdated`, so the old owner gets the macro deletes and the resolved prompt.
import { ROLL_MACRO_TYPE } from "@shared/dice-extras/macros";
import {
  type RequestTarget,
  ROLL_REQUEST_TYPE,
  type RollRequestPromptResolution,
} from "@shared/dice-extras/requests";
import type { EntityRecord } from "@shared/entities/schemas";
import { and, asc, eq } from "drizzle-orm";
import { notification, rollMacro, rollRequest } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import type { HookEnv } from "../entities/definition-hooks";
import { NOTIFICATION_TYPE, toNotificationRecord } from "../notifications/helpers";
import { listOf } from "./macros";
import { readMacro, readRequest, toRequestRecord } from "./table-rows";

const MISSED: RollRequestPromptResolution = { outcome: "missed" };

function moveMacros(
  env: HookEnv,
  cid: string,
  creatureId: string,
  from: string,
  to: string | null,
): RecordChange[] {
  const rows = listOf(env.tx, cid, { playerId: from, creatureId });
  const start = listOf(env.tx, cid, { playerId: to, creatureId }).length;
  return rows.map((m, i) => {
    env.tx
      .update(rollMacro)
      .set({
        playerId: to,
        createdBy: m.createdBy === from ? to : m.createdBy,
        order: start + i,
        updatedAt: env.ctx.clock.iso(),
      })
      .where(eq(rollMacro.id, m.id))
      .run();
    return { type: ROLL_MACRO_TYPE, id: m.id, before: m, after: readMacro(env.tx, cid, m.id) };
  });
}

/** FR-NOTE-62: a prompt closed by rule (no closer), resolution `missed`. */
function resolvePrompt(env: HookEnv, cid: string, id: string): RecordChange[] {
  const row = env.tx
    .select()
    .from(notification)
    .where(and(eq(notification.id, id), eq(notification.campaignId, cid)))
    .get();
  if (row?.state !== "pending") return [];
  const now = env.ctx.clock.iso();
  env.tx
    .update(notification)
    .set({
      state: "resolved",
      resolution: MISSED,
      closedAt: now,
      closedByRole: null,
      closedByPlayerId: null,
      updatedAt: now,
    })
    .where(eq(notification.id, id))
    .run();
  const after = env.tx.select().from(notification).where(eq(notification.id, id)).get();
  return [
    {
      type: NOTIFICATION_TYPE,
      id,
      before: toNotificationRecord(row),
      after: after ? toNotificationRecord(after) : null,
    },
  ];
}

function missTargets(env: HookEnv, cid: string, characterId: string): RecordChange[] {
  const open = env.tx
    .select()
    .from(rollRequest)
    .where(and(eq(rollRequest.campaignId, cid), eq(rollRequest.state, "open")))
    .orderBy(asc(rollRequest.seq))
    .all()
    .map(toRequestRecord);
  const out: RecordChange[] = [];
  const now = env.ctx.clock.iso();
  for (const req of open) {
    const hit = req.targets.filter((t) => t.characterId === characterId && t.state === "open");
    if (hit.length === 0) continue;
    const targets = req.targets.map(
      (t): RequestTarget =>
        t.characterId === characterId && t.state === "open"
          ? { ...t, state: "missed", at: now }
          : t,
    );
    const closed = targets.every((t) => t.state !== "open");
    env.tx
      .update(rollRequest)
      .set({ targets, state: closed ? "closed" : "open", closedAt: closed ? now : null })
      .where(eq(rollRequest.id, req.id))
      .run();
    out.push({
      type: ROLL_REQUEST_TYPE,
      id: req.id,
      before: req,
      after: readRequest(env.tx, cid, req.id),
    });
    for (const t of hit) out.push(...resolvePrompt(env, cid, t.notificationId));
  }
  return out;
}

export function macroOwnerHook(
  env: HookEnv,
  before: EntityRecord,
  after: EntityRecord,
): RecordChange[] {
  if (after.kind !== "character") return [];
  const from = before.ownerPlayerId ?? null;
  const to = after.ownerPlayerId ?? null;
  if (from === to) return [];
  const cid = after.campaignId;
  return [
    ...(from === null ? [] : moveMacros(env, cid, after.id, from, to)),
    ...missTargets(env, cid, after.id),
  ];
}
