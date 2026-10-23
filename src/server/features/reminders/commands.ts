// Reminder commands (REM §6.2): `rem.save` and `rem.delete` (DM, player). A player adds on the
// party or an own character and edits / deletes only rows they created, still on the party or an
// own character (OQ-REM-01 B); never `dmOnly` or a link, and their save keeps the stored ones
// (review ruling 10). The DM any. Row + event-log row + event in one transaction (ADR-0016).
import { ReminderDeleted, ReminderSaved } from "@shared/events/reminders";
import {
  DeleteReminderIntent,
  REM_INTENTS,
  REMINDER_NOT_FOUND,
  REMINDER_TYPE,
  REMINDERS_PER_CAMPAIGN,
  REMINDERS_PER_TARGET,
  type ReminderRecord,
  type ReminderResult,
  type ReminderRoll,
  type ReminderTarget,
  reminderLimitMessage,
  reminderVisibility,
  type SaveReminderInput,
  SaveReminderIntent,
} from "@shared/reminders/schemas";
import { FACILITY_GONE, STRONGHOLD_NOT_FOUND } from "@shared/strongholds/schemas";
import { and, eq } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, forbidden, notFound } from "../../commands/errors";
import { entity, reminder, reminderSeqNext } from "../../db/schema";
import { campaignOf } from "../scenes-map/rows";
import { getStronghold } from "../strongholds/rows";
import { nextCreatedAt } from "./created-at";
import { getReminder, linkHiddenOf, reminderCounts } from "./rows";

export const READ_ONLY = "Only reminders you added can be changed";
export const NOT_YOUR_CHARACTER = "Not your character";
export const DM_FIELDS = "Only the DM can hide or link a reminder";

/** A `character` entity of the campaign and its owner, else `not_found` (FR-REM-02). */
function characterOwner(env: CommandEnv, cid: string, characterId: string): string | null {
  const row = env.tx
    .select({ kind: entity.kind, owner: entity.ownerPlayerId })
    .from(entity)
    .where(and(eq(entity.id, characterId), eq(entity.campaignId, cid)))
    .get();
  if (row?.kind !== "character") throw notFound("Character not found");
  return row.owner;
}

const targetOf = (r: Pick<ReminderRecord, "characterId">): ReminderTarget =>
  r.characterId === null ? { kind: "party" } : { kind: "character", characterId: r.characterId };

/** FR-REM-08: the party, or a character the player owns at commit (else `forbidden`). */
function assertPlayerTarget(env: CommandEnv, cid: string, target: ReminderTarget): void {
  if (target.kind === "party") return;
  if (characterOwner(env, cid, target.characterId) !== env.actor.playerId)
    throw forbidden(NOT_YOUR_CHARACTER);
}

/**
 * The reminder the actor may change: a player → one they see (else `not_found`, never revealing
 * it), they created, still on the party or an own character (else `forbidden`); the DM → any.
 */
function editable(env: CommandEnv, cid: string, id: string): ReminderRecord {
  const r = getReminder(env.tx, cid, id);
  if (!r) throw notFound(REMINDER_NOT_FOUND);
  if (env.actor.role !== "player") return r;
  if (reminderVisibility(r, { role: "player", playerId: env.actor.playerId }) === "hidden")
    throw notFound(REMINDER_NOT_FOUND);
  if (r.createdByPlayerId !== env.actor.playerId) throw forbidden(READ_ONLY);
  assertPlayerTarget(env, cid, targetOf(r));
  return r;
}

/** FR-REM-10: the DM's link, checked against the campaign's strongholds; its `linkHidden` copy. */
function dmLink(
  env: CommandEnv,
  cid: string,
  input: SaveReminderInput,
): { strongholdId: string | null; facilityId: string | null; linkHidden: boolean } {
  const strongholdId = input.strongholdId ?? null;
  const facilityId = input.facilityId ?? null;
  if (strongholdId === null) return { strongholdId, facilityId: null, linkHidden: false };
  const hold = getStronghold(env.tx, cid, strongholdId);
  if (!hold) throw notFound(STRONGHOLD_NOT_FOUND);
  if (facilityId !== null && !hold.facilities.some((f) => f.id === facilityId))
    throw notFound(FACILITY_GONE);
  return { strongholdId, facilityId, linkHidden: linkHiddenOf(hold, facilityId) };
}

/** FR-REM-04: kept rolls keep their id (matched by sent `id`); the rest get new ids. */
function rollsOf(
  env: CommandEnv,
  input: SaveReminderInput["rolls"],
  before: ReminderRecord | null,
): ReminderRoll[] {
  const kept = new Set((before?.rolls ?? []).map((r) => r.id));
  return input.map((r) => ({
    id: r.id !== undefined && kept.has(r.id) ? r.id : env.ctx.ids.next(),
    label: r.label,
    expression: r.expression,
    category: r.category,
  }));
}

const sameRolls = (a: readonly ReminderRoll[], b: readonly ReminderRoll[]) =>
  a.length === b.length &&
  a.every(
    (r, i) =>
      r.id === b[i]?.id &&
      r.label === b[i]?.label &&
      r.expression === b[i]?.expression &&
      r.category === b[i]?.category,
  );

/** FR-REM-03: caps on a new row or a row moving to another target; a player's message has no number. */
function assertRoom(env: CommandEnv, cid: string, characterId: string | null, isNew: boolean) {
  const n = reminderCounts(env.tx, cid, characterId);
  const role = env.actor.role === "dm" ? "dm" : "player";
  if (isNew && n.campaign >= REMINDERS_PER_CAMPAIGN)
    throw conflict(reminderLimitMessage(role, REMINDERS_PER_CAMPAIGN));
  if (n.target >= REMINDERS_PER_TARGET)
    throw conflict(reminderLimitMessage(role, REMINDERS_PER_TARGET));
}

/**
 * FR-REM-07: no `id` → create; with `id` → full replacement of target, text, source, rolls (and,
 * for the DM, `dmOnly` and the link). Same values → `ack`, no write, no event.
 */
export const saveReminder = defineCommand({
  name: REM_INTENTS.save,
  input: SaveReminderIntent,
  roles: ["dm", "player"],
  authorize(input, env) {
    if (
      env.actor.role === "player" &&
      (input.dmOnly !== undefined ||
        input.strongholdId !== undefined ||
        input.facilityId !== undefined)
    )
      throw forbidden(DM_FIELDS);
  },
  execute(input, env): ReminderResult {
    const cid = campaignOf(env.actor);
    const before = input.id === undefined ? null : editable(env, cid, input.id);
    const characterId = input.target.kind === "character" ? input.target.characterId : null;
    const owner = characterId === null ? null : characterOwner(env, cid, characterId);
    const player = env.actor.role === "player";
    if (player) assertPlayerTarget(env, cid, input.target);
    // Review ruling 10: a player's save keeps the stored DM fields (none on a new row).
    const dm = player
      ? {
          dmOnly: before?.dmOnly ?? false,
          strongholdId: before?.strongholdId ?? null,
          facilityId: before?.facilityId ?? null,
          linkHidden: before?.linkHidden ?? false,
        }
      : { dmOnly: input.dmOnly ?? false, ...dmLink(env, cid, input) };
    const fields = {
      characterId,
      text: input.text,
      source: input.source,
      rolls: rollsOf(env, input.rolls, before),
      ownerPlayerId: owner,
      ...dm,
    };
    if (
      before &&
      before.characterId === fields.characterId &&
      before.text === fields.text &&
      before.source === fields.source &&
      sameRolls(before.rolls, fields.rolls) &&
      before.dmOnly === fields.dmOnly &&
      before.strongholdId === fields.strongholdId &&
      before.facilityId === fields.facilityId &&
      before.ownerPlayerId === fields.ownerPlayerId &&
      before.linkHidden === fields.linkHidden
    )
      return { reminderId: before.id };
    if (!before || before.characterId !== characterId) assertRoom(env, cid, characterId, !before);
    const now = env.ctx.clock.iso();
    const id = before?.id ?? env.ctx.ids.next();
    if (before) {
      env.tx
        .update(reminder)
        .set({ ...fields, updatedAt: now })
        .where(eq(reminder.id, id))
        .run();
    } else {
      env.tx
        .insert(reminder)
        .values({
          id,
          campaignId: cid,
          seq: reminderSeqNext,
          ...fields,
          createdByPlayerId: player ? env.actor.playerId : null,
          createdAt: nextCreatedAt(env.tx, reminder, cid, now),
          updatedAt: now,
        })
        .run();
    }
    env.emit({
      type: ReminderSaved.type,
      campaignId: cid,
      payload: { reminderId: id, created: before === null },
      changes: [{ type: REMINDER_TYPE, id, before, after: getReminder(env.tx, cid, id) }],
      quietWhenUnchanged: true,
    });
    return { reminderId: id };
  },
});

/** FR-REM-09: rights as `rem.save`; a row the player can't see → `not_found`. */
export const deleteReminder = defineCommand({
  name: REM_INTENTS.delete,
  input: DeleteReminderIntent,
  roles: ["dm", "player"],
  execute({ id }, env): ReminderResult {
    const cid = campaignOf(env.actor);
    const before = editable(env, cid, id);
    env.tx.delete(reminder).where(eq(reminder.id, id)).run();
    env.emit({
      type: ReminderDeleted.type,
      campaignId: cid,
      payload: { reminderIds: [id] },
      changes: [{ type: REMINDER_TYPE, id, before, after: null }],
      quietWhenUnchanged: true,
    });
    return { reminderId: id };
  },
});
