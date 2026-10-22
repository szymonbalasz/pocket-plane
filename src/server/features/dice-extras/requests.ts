// DM roll requests (FR-DICEX-73–82, TT2, ADR-0061): `dicex.request`, `dicex.answerRequest`,
// `dicex.declineRequest`, `dicex.closeRequest`, `dicex.rollForMissing`. The request row is DM
// only; each target gets one `roll-request` prompt (owner = the PC's player). The server builds
// every answer from the request (`sheetRoll`, or for custom a plain roll as the PC with no sheet
// bonuses or hooks), stamps its audience (public, or the target's player) and marks it
// `answer: true` (not rerollable). One transaction per command; no timer, not undoable.
import {
  AnswerRequestInput,
  type AnswerResult,
  DeclineRequestInput,
  DICEX_REQUEST_INTENTS,
  defaultRequestLabel,
  promptText,
  REQUEST_CATEGORY,
  RequestIdInput,
  RequestInput,
  type RequestResult,
  type RequestTarget,
  ROLL_REQUEST_KIND,
  ROLL_REQUEST_TYPE,
  type RollForMissingResult,
  type RollRequestPromptPayload,
  type RollRequestRecord,
  requestSuccess,
} from "@shared/dice-extras/requests";
import { ROLL_KIND } from "@shared/dice-roll-log/roll-kind";
import type { ManualEntry, ManualParts } from "@shared/dice-roll-log/schemas";
import {
  RollRequestAnswered,
  RollRequestClosed,
  RollRequestDeclined,
  RollRequested,
} from "@shared/events/dice-extras";
import type { RollMode } from "@shared/events/dice-roll-log";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, invalid, notFound } from "../../commands/errors";
import { entity, rollRequest, rollRequestSeqNext } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { sheetRoll } from "../character-sheet/commands";
import { pcCombatant } from "../combat-extras/rows";
import { dice, gameLog } from "../dice-roll-log";
import type { EntryAudience } from "../dice-roll-log/game-log";
import { notify, resolveNotification } from "../notifications/helpers";
import { campaignOf } from "../scenes-map/rows";
import { assertRequestRoom, readRequest } from "./table-rows";

type Env = CommandEnv;

const NOT_FOUND = "Request not found";
const NOT_OPEN = "This request is closed";

/** FR-DICEX-75: a target is an owned, not hidden (#141) PC of the campaign; else `invalid`. */
function targetOf(env: Env, cid: string, characterId: string) {
  const row = env.tx
    .select({ id: entity.id, name: entity.name, kind: entity.kind, owner: entity.ownerPlayerId })
    .from(entity)
    .where(and(eq(entity.id, characterId), eq(entity.campaignId, cid)))
    .get();
  const ok =
    row?.kind === "character" && row.owner !== null && !pcCombatant(env.tx, cid, row.id)?.hidden;
  if (!ok || !row?.owner) {
    throw invalid("Pick player characters", [
      { path: ["characterIds"], message: "Only owned, visible player characters" },
    ]);
  }
  return { characterId: row.id, playerId: row.owner, name: row.name };
}

/** The PC's owner now (FR-DICEX-81: a hidden roll for missing stamps the current owner). */
function ownerNow(env: Env, cid: string, characterId: string): string | null {
  const row = env.tx
    .select({ owner: entity.ownerPlayerId })
    .from(entity)
    .where(and(eq(entity.id, characterId), eq(entity.campaignId, cid)))
    .get();
  return row?.owner ?? null;
}

function writeRequest(
  env: Env,
  before: RollRequestRecord,
  targets: RequestTarget[],
  forceClose = false,
): RecordChange {
  const closed = forceClose || targets.every((t) => t.state !== "open");
  env.tx
    .update(rollRequest)
    .set({
      targets,
      state: closed ? "closed" : "open",
      closedAt: closed ? env.ctx.clock.iso() : null,
    })
    .where(eq(rollRequest.id, before.id))
    .run();
  return {
    type: ROLL_REQUEST_TYPE,
    id: before.id,
    before,
    after: readRequest(env.tx, before.campaignId, before.id),
  };
}

/**
 * An open request and the actor's open target in it. Player: only their own target (another's
 * or an unknown request → `not_found`, never `forbidden`); closed / answered → `conflict`.
 */
function openTarget(env: Env, cid: string, requestId: string, characterId: string) {
  const req = readRequest(env.tx, cid, requestId);
  const t = req?.targets.find((x) => x.characterId === characterId);
  const seen = env.actor.role !== "player" || t?.playerId === env.actor.playerId;
  if (!req || !t || !seen) throw notFound(NOT_FOUND);
  if (req.state !== "open") throw conflict(NOT_OPEN);
  if (t.state !== "open") throw conflict(`${t.name} already ${t.state}`);
  return { req, t };
}

interface Answer {
  mode: RollMode;
  manual?: ManualEntry;
  manualParts?: ManualParts;
}

/**
 * FR-DICEX-78, FR-DICE-80: the answer line for target `t`, built from the request. Skill / save /
 * check → `sheetRoll` (sheet bonuses, overrides, MOD hooks); custom → the expression as the PC,
 * no sheet bonuses or roll hooks. Every item `answer: true`; label = the request's.
 */
function rollAnswer(
  env: Env,
  req: RollRequestRecord,
  t: RequestTarget,
  a: Answer,
  audience: EntryAudience | null,
) {
  const extra = audience ? { audience } : {};
  if (req.roll.kind === "custom") {
    const r = dice.evaluate(env, {
      expression: req.roll.expression,
      mode: a.mode,
      category: REQUEST_CATEGORY.custom,
      label: req.label,
      actor: { kind: "entity", id: t.characterId, name: t.name },
      manual: a.manual,
      source: "dice",
    });
    const change = gameLog.append(env, {
      kind: ROLL_KIND,
      category: REQUEST_CATEGORY.custom,
      actorName: t.name,
      payload: [{ ...dice.rollPayloadItem(r), answer: true }],
      rollIds: dice.rollIdsOf(r),
      ...(audience ? extra : { public: false }),
    });
    return { change, roll: r };
  }
  const base = {
    characterId: t.characterId,
    mode: a.mode,
    ...(a.manual ? { manual: [a.manual] } : {}),
    ...(a.manualParts ? { manualParts: [a.manualParts] } : {}),
    // DM only (a hidden roll for missing with no owner): the DM's `public` stamp.
    ...(audience ? {} : { public: false }),
  };
  const input =
    req.roll.kind === "skill"
      ? { ...base, kind: "skill" as const, skill: req.roll.key }
      : { ...base, kind: req.roll.kind, ability: req.roll.key };
  const r = sheetRoll(env, input, { ...extra, label: req.label, answer: true });
  return { change: r.change, roll: r.rolls[0] as (typeof r.rolls)[number] };
}

/** The answered target: total incl. MOD parts (FR-MOD-16), natural d20, pass / fail (DM only). */
function answered(
  env: Env,
  req: RollRequestRecord,
  t: RequestTarget,
  out: ReturnType<typeof rollAnswer>,
): RequestTarget {
  const total = out.roll.total + (out.roll.mods?.modTotal ?? 0);
  return {
    ...t,
    state: "rolled",
    entryId: out.change.id,
    total,
    natural: out.roll.natural,
    success: requestSuccess(req.dc, total),
    at: env.ctx.clock.iso(),
  };
}

const replace = (targets: RequestTarget[], t: RequestTarget) =>
  targets.map((x) => (x.characterId === t.characterId ? t : x));

/** FR-DICEX-77: public → everyone; hidden → DM + `playerId` (null = DM only). */
const audienceOf = (req: RollRequestRecord, playerId: string | null): EntryAudience | null =>
  req.results === "public"
    ? { public: true }
    : playerId === null
      ? null
      : { public: false, audiencePlayerId: playerId };

export const request = defineCommand({
  name: DICEX_REQUEST_INTENTS.request,
  input: RequestInput,
  execute(input, env): z.infer<typeof RequestResult> {
    const cid = campaignOf(env.actor);
    assertRequestRoom(env.tx, cid);
    const who = input.characterIds.map((id) => targetOf(env, cid, id));
    const id = env.ctx.ids.next();
    const label = input.label ?? defaultRequestLabel(input.roll);
    const dc = input.dc ?? null;
    // FR-DICEX-77: the DC reaches players only when shown.
    const shownDc = input.dcShown ? dc : null;
    // The prompts first: the row lists their ids (ADR-0027: same transaction).
    const targets = who.map((w): RequestTarget => {
      const payload: RollRequestPromptPayload = {
        requestId: id,
        characterId: w.characterId,
        characterName: w.name,
        roll: input.roll,
        label,
        dc: shownDc,
        mode: input.mode,
      };
      const notificationId = notify(env, {
        kind: ROLL_REQUEST_KIND,
        audience: "player",
        audiencePlayerId: w.playerId,
        text: promptText(label, shownDc),
        payload,
        action: { label: "Roll", role: "player", playerId: w.playerId },
      });
      return {
        ...w,
        notificationId,
        state: "open",
        entryId: null,
        total: null,
        natural: null,
        success: null,
        at: null,
      };
    });
    const now = env.ctx.clock.iso();
    env.tx
      .insert(rollRequest)
      .values({
        id,
        campaignId: cid,
        seq: rollRequestSeqNext,
        roll: input.roll,
        label,
        dc,
        dcShown: input.dcShown,
        mode: input.mode,
        results: input.results,
        state: "open",
        targets,
        createdAt: now,
        closedAt: null,
      })
      .run();
    env.emit({
      type: RollRequested.type,
      campaignId: cid,
      payload: { requestId: id },
      changes: [{ type: ROLL_REQUEST_TYPE, id, before: null, after: readRequest(env.tx, cid, id) }],
    });
    return { requestId: id };
  },
});

export const answerRequest = defineCommand({
  name: DICEX_REQUEST_INTENTS.answerRequest,
  input: AnswerRequestInput,
  roles: ["dm", "player"],
  execute(input, env): z.infer<typeof AnswerResult> {
    const cid = campaignOf(env.actor);
    const { req, t } = openTarget(env, cid, input.requestId, input.characterId);
    const out = rollAnswer(env, req, t, input, audienceOf(req, t.playerId));
    const target = answered(env, req, t, out);
    const change = writeRequest(env, req, replace(req.targets, target));
    env.emit({
      type: RollRequestAnswered.type,
      campaignId: cid,
      payload: { requestId: req.id, characterId: t.characterId, entryId: out.change.id },
      changes: [out.change, change],
    });
    resolveNotification(env, t.notificationId, {
      outcome: "rolled",
      total: target.total ?? undefined,
    });
    return { rollId: out.roll.id, entryId: out.change.id };
  },
});

export const declineRequest = defineCommand({
  name: DICEX_REQUEST_INTENTS.declineRequest,
  input: DeclineRequestInput,
  roles: ["dm", "player"],
  execute(input, env): z.infer<typeof RequestResult> {
    const cid = campaignOf(env.actor);
    const { req, t } = openTarget(env, cid, input.requestId, input.characterId);
    const target: RequestTarget = { ...t, state: "declined", at: env.ctx.clock.iso() };
    const change = writeRequest(env, req, replace(req.targets, target));
    env.emit({
      type: RollRequestDeclined.type,
      campaignId: cid,
      payload: { requestId: req.id, characterId: t.characterId },
      changes: [change],
    });
    resolveNotification(env, t.notificationId, { outcome: "declined" });
    return { requestId: req.id };
  },
});

function openRequest(env: Env, cid: string, requestId: string): RollRequestRecord {
  const req = readRequest(env.tx, cid, requestId);
  if (!req) throw notFound(NOT_FOUND);
  if (req.state !== "open") throw conflict(NOT_OPEN);
  return req;
}

export const closeRequest = defineCommand({
  name: DICEX_REQUEST_INTENTS.closeRequest,
  input: RequestIdInput,
  execute({ requestId }, env): z.infer<typeof RequestResult> {
    const cid = campaignOf(env.actor);
    const req = openRequest(env, cid, requestId);
    const now = env.ctx.clock.iso();
    const open = req.targets.filter((t) => t.state === "open");
    const targets = req.targets.map(
      (t): RequestTarget => (t.state === "open" ? { ...t, state: "missed", at: now } : t),
    );
    const change = writeRequest(env, req, targets, true);
    env.emit({
      type: RollRequestClosed.type,
      campaignId: cid,
      payload: { requestId },
      changes: [change],
    });
    // FR-NOTE-28, -62: closed by rule ("Closed").
    for (const t of open) {
      resolveNotification(env, t.notificationId, { outcome: "missed" }, { byRule: true });
    }
    return { requestId };
  },
});

export const rollForMissing = defineCommand({
  name: DICEX_REQUEST_INTENTS.rollForMissing,
  input: RequestIdInput,
  execute({ requestId }, env): z.infer<typeof RollForMissingResult> {
    const cid = campaignOf(env.actor);
    const req = openRequest(env, cid, requestId);
    const rolled = req.targets
      .filter((t) => t.state === "open")
      .map((t) => {
        // FR-DICEX-81: hidden → the PC's current owner, DM only if none.
        const audience = audienceOf(req, ownerNow(env, cid, t.characterId));
        const out = rollAnswer(env, req, t, { mode: req.mode }, audience);
        return { t, out, audience, target: answered(env, req, t, out) };
      });
    let targets = req.targets;
    for (const r of rolled) targets = replace(targets, r.target);
    const change = writeRequest(env, req, targets, true);
    const entryIds = rolled.map((r) => r.out.change.id);
    env.emit({
      type: RollRequestClosed.type,
      campaignId: cid,
      payload: { requestId, ...(entryIds.length ? { rolled: entryIds } : {}) },
      changes: [...rolled.map((r) => r.out.change), change],
    });
    for (const r of rolled) {
      // FR-NOTE-64: the total only to a player who sees the line (never on a DM-only roll).
      const total = r.audience ? (r.target.total ?? undefined) : undefined;
      resolveNotification(env, r.t.notificationId, { outcome: "rolled", total }, { byRule: true });
    }
    return { entryIds };
  },
});
