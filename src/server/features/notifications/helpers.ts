// Internal helpers for kind owners (FR-NOTE-02/08/10/25, protocol §21, ADR-0027). They run in the
// caller's transaction, take `env` first and emit their own event via `env.emit`; call them
// **after** emitting the owner's event (protocol §22 event order). Campaign and actor come from
// `env.actor`; IDs and time from `env.ctx`.

import { endsWithEncounter } from "@shared/notifications/end-rule";
import {
  ActionLabel,
  type ActionRole,
  type Audience,
  jsonBytes,
  type NotificationRecord,
  NotificationText,
  notificationVisibleTo,
} from "@shared/notifications/schemas";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { conflict, forbidden, invalid, notFound, zodIssues } from "../../commands/errors";
import type { Tx } from "../../db/client";
import { notification, notificationSeqNext, player } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { buildKindMap, type NotificationKindDef, payloadCapOf, resolutionCapOf } from "./kind";
import { notificationKinds } from "./kinds";

export const NOTIFICATION_TYPE = "notification";

export interface NotifyInput {
  kind: string;
  audience: Audience;
  /** Required iff `audience = player`; a player of `env.actor.campaignId`. */
  audiencePlayerId?: string | null;
  text: string;
  payload: unknown;
  /** The action owner (FR-NOTE-05). A player owner must be in the audience. */
  action?: { label: string; role: ActionRole; playerId?: string | null };
}

type Row = typeof notification.$inferSelect;

export function toNotificationRecord(r: Row): NotificationRecord {
  return {
    id: r.id,
    campaignId: r.campaignId,
    seq: r.seq,
    kind: r.kind,
    audience: r.audience,
    audiencePlayerId: r.audiencePlayerId,
    text: r.text,
    payload: r.payload,
    actionLabel: r.actionLabel,
    actionRole: r.actionRole,
    actionPlayerId: r.actionPlayerId,
    state: r.state,
    resolution: r.resolution ?? null,
    closedAt: r.closedAt,
    closedByRole: r.closedByRole,
    closedByPlayerId: r.closedByPlayerId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** A notification of the actor's campaign, or `not_found` (never another campaign's). */
export function loadNotification(env: CommandEnv, id: string): NotificationRecord {
  const campaignId = env.actor.campaignId;
  if (!campaignId) throw notFound("Notification not found");
  const row = env.tx
    .select()
    .from(notification)
    .where(and(eq(notification.id, id), eq(notification.campaignId, campaignId)))
    .get();
  if (!row) throw notFound("Notification not found");
  return toNotificationRecord(row);
}

/** Who closed it: the actor's role (server-internal counts as the DM) and player. */
function closer(env: CommandEnv): { role: ActionRole; playerId: string | null } {
  return env.actor.role === "player"
    ? { role: "player", playerId: env.actor.playerId }
    : { role: "dm", playerId: null };
}

function isPlayerOf(tx: Tx, playerId: string, campaignId: string): boolean {
  return (
    tx
      .select({ id: player.id })
      .from(player)
      .where(and(eq(player.id, playerId), eq(player.campaignId, campaignId)))
      .get() !== undefined
  );
}

/** Writes the change and emits its event in the caller's transaction. */
function transition(
  env: CommandEnv,
  before: NotificationRecord,
  patch: Partial<NotificationRecord>,
  eventType:
    | "NotificationResolved"
    | "NotificationDismissed"
    | "NotificationReopened"
    | "NotificationUpdated",
  extra: RecordChange[] = [],
): RecordChange {
  const after: NotificationRecord = { ...before, ...patch, updatedAt: env.ctx.clock.iso() };
  env.tx
    .update(notification)
    .set({
      text: after.text,
      payload: after.payload,
      state: after.state,
      resolution: after.resolution,
      closedAt: after.closedAt,
      closedByRole: after.closedByRole,
      closedByPlayerId: after.closedByPlayerId,
      updatedAt: after.updatedAt,
    })
    .where(eq(notification.id, before.id))
    .run();
  const change: RecordChange = { type: NOTIFICATION_TYPE, id: before.id, before, after };
  env.emit({
    type: eventType,
    campaignId: before.campaignId,
    payload: { notificationId: before.id, kind: before.kind },
    changes: [change, ...extra],
  });
  return change;
}

/** Closed-by fields for a close at the command's clock (FR-NOTE-07). */
function closedFields(env: CommandEnv) {
  const c = closer(env);
  return { closedAt: env.ctx.clock.iso(), closedByRole: c.role, closedByPlayerId: c.playerId };
}

export function createNotificationHelpers(kinds: readonly NotificationKindDef[]) {
  let map: ReadonlyMap<string, NotificationKindDef> | null = null;
  // Lazy: kind modules may import these helpers (no init-order cycle).
  const kindOf = (kind: string) => {
    map ??= buildKindMap(kinds);
    return map.get(kind);
  };

  /**
   * FR-NOTE-02/03/04/05: inserts the row and emits `NotificationCreated`. A broken call (unknown
   * kind, bad payload / text / audience / action, payload over the kind's cap) is a server bug: it throws a
   * plain error, so the caller's command fails `internal` and writes nothing.
   */
  function notify(env: CommandEnv, input: NotifyInput): string {
    const campaignId = env.actor.campaignId;
    if (!campaignId) throw new Error("notify: no campaign in env.actor");
    const def = kindOf(input.kind);
    if (!def) throw new Error(`notify: unknown notification kind "${input.kind}"`);
    const payload = def.payload.safeParse(input.payload);
    if (!payload.success) throw new Error(`notify: invalid payload for kind "${input.kind}"`);
    const payloadCap = payloadCapOf(def);
    if (jsonBytes(payload.data) > payloadCap) {
      throw new Error(`notify: payload of kind "${input.kind}" exceeds ${payloadCap} B`);
    }
    const text = NotificationText.safeParse(input.text);
    if (!text.success) throw new Error("notify: text must be 1–280 chars of plain text");

    const audiencePlayerId = input.audience === "player" ? (input.audiencePlayerId ?? null) : null;
    if (input.audience === "player") {
      if (!audiencePlayerId || !isPlayerOf(env.tx, audiencePlayerId, campaignId)) {
        throw new Error("notify: audiencePlayerId must be a player of the campaign");
      }
    } else if (input.audiencePlayerId) {
      throw new Error("notify: audiencePlayerId only with audience player");
    }

    let actionLabel: string | null = null;
    let actionRole: ActionRole | null = null;
    let actionPlayerId: string | null = null;
    if (input.action) {
      const label = ActionLabel.safeParse(input.action.label);
      if (!label.success) throw new Error("notify: action label must be 1–24 chars");
      actionLabel = label.data;
      actionRole = input.action.role;
      if (actionRole === "player") {
        actionPlayerId = input.action.playerId ?? null;
        const inAudience =
          actionPlayerId !== null &&
          notificationVisibleTo(
            { audience: input.audience, audiencePlayerId },
            { role: "player", playerId: actionPlayerId },
          ) &&
          isPlayerOf(env.tx, actionPlayerId, campaignId);
        if (!inAudience) throw new Error("notify: a player action owner must be in the audience");
      } else if (input.action.playerId) {
        throw new Error("notify: actionPlayerId only with a player owner");
      }
    }

    const id = env.ctx.ids.next();
    const now = env.ctx.clock.iso();
    const row = env.tx
      .insert(notification)
      .values({
        id,
        campaignId,
        seq: notificationSeqNext,
        kind: def.kind,
        audience: input.audience,
        audiencePlayerId,
        text: text.data,
        payload: payload.data,
        actionLabel,
        actionRole,
        actionPlayerId,
        state: actionRole ? "pending" : "info",
        resolution: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const after = toNotificationRecord(row);
    env.emit({
      type: "NotificationCreated",
      campaignId,
      payload: {
        notificationId: id,
        kind: def.kind,
        audience: input.audience,
        audiencePlayerId,
        hasAction: actionRole !== null,
      },
      changes: [{ type: NOTIFICATION_TYPE, id, before: null, after }],
    });
    return id;
  }

  /**
   * FR-NOTE-08: `pending` → `resolved` in the kind owner's command. Fails `not_found` (not in
   * the actor's campaign), `conflict` (not pending), `forbidden` (neither action owner nor DM),
   * `invalid` (resolution fails the kind's schema); any failure rolls back the whole command.
   * `byRule` (FR-CBTX-43): a closure made by a rule of the kind owner (not the actor's own
   * action) skips the action-owner check; state and schema checks stay. It records no actor
   * (FR-NOTE-28): `closedByRole` / `closedByPlayerId` null, `closedAt` set.
   */
  function resolveNotification(
    env: CommandEnv,
    id: string,
    resolution?: unknown,
    opts: { byRule?: boolean } = {},
  ): void {
    const before = loadNotification(env, id);
    if (before.state !== "pending") throw conflict("No longer pending");
    if (env.actor.role === "player" && !opts.byRule) {
      const owner = before.actionRole === "player" && before.actionPlayerId === env.actor.playerId;
      if (!owner) throw forbidden("Only the action owner or the DM can do this");
    }
    let stored: unknown = null;
    if (resolution !== undefined) {
      const def = kindOf(before.kind);
      if (!def?.resolution) throw invalid(`Kind "${before.kind}" takes no resolution`);
      const parsed = def.resolution.safeParse(resolution);
      if (!parsed.success) throw invalid("Invalid resolution", zodIssues(parsed.error));
      const cap = resolutionCapOf(def);
      if (jsonBytes(parsed.data) > cap) {
        throw new Error(`resolveNotification: resolution exceeds ${cap} B`);
      }
      stored = parsed.data;
    }
    const closed = opts.byRule
      ? { closedAt: env.ctx.clock.iso(), closedByRole: null, closedByPlayerId: null }
      : closedFields(env);
    transition(
      env,
      before,
      { state: "resolved", resolution: stored, ...closed },
      "NotificationResolved",
    );
  }

  /**
   * FR-NOTE-25 (ADR-0037): the kind owner changes a **pending** row's payload (and text) in its
   * own command and transaction, after its own event. `not_found` (not in the actor's campaign),
   * `conflict` (not pending). Payload re-checked against the kind's zod and payload cap, text per
   * FR-NOTE-21: a broken call throws a plain error (the caller fails `internal`). Audience,
   * action, `seq` and `createdAt` never change; `updatedAt` from the clock. Emits
   * `NotificationUpdated` (record upsert); no toast, unread unchanged (same `seq`).
   */
  function updateNotification(
    env: CommandEnv,
    id: string,
    patch: { text?: string; payload: unknown },
  ): NotificationRecord {
    const before = loadNotification(env, id);
    if (before.state !== "pending") throw conflict("No longer pending");
    const def = kindOf(before.kind);
    if (!def) throw new Error(`updateNotification: unknown notification kind "${before.kind}"`);
    const payload = def.payload.safeParse(patch.payload);
    if (!payload.success) {
      throw new Error(`updateNotification: invalid payload for kind "${before.kind}"`);
    }
    const payloadCap = payloadCapOf(def);
    if (jsonBytes(payload.data) > payloadCap) {
      throw new Error(
        `updateNotification: payload of kind "${before.kind}" exceeds ${payloadCap} B`,
      );
    }
    let text = before.text;
    if (patch.text !== undefined) {
      const parsed = NotificationText.safeParse(patch.text);
      if (!parsed.success)
        throw new Error("updateNotification: text must be 1–280 chars of plain text");
      text = parsed.data;
    }
    const change = transition(env, before, { text, payload: payload.data }, "NotificationUpdated");
    return change.after as NotificationRecord;
  }

  /** FR-NOTE-10: `resolved` → `pending` (kind owner's undo, after the owner's event). */
  function reopenNotification(env: CommandEnv, id: string): void {
    const before = loadNotification(env, id);
    if (before.state !== "resolved") throw conflict("Notification is not resolved");
    transition(
      env,
      before,
      {
        state: "pending",
        resolution: null,
        closedAt: null,
        closedByRole: null,
        closedByPlayerId: null,
      },
      "NotificationReopened",
    );
  }

  /** `pending` → `dismissed`; the kind's `onClose` changes ride on the same event (sprint 5). */
  function dismiss(env: CommandEnv, n: NotificationRecord): RecordChange {
    const extra = kindOf(n.kind)?.onClose?.(env, n) ?? [];
    return transition(
      env,
      n,
      { state: "dismissed", ...closedFields(env) },
      "NotificationDismissed",
      extra,
    );
  }

  /** FR-NOTE-11: `pending` → `dismissed` (the `note.dismiss` intent; DM only). */
  function dismissNotification(env: CommandEnv, id: string): void {
    const before = loadNotification(env, id);
    if (before.state !== "pending") throw conflict("No longer pending");
    dismiss(env, before);
  }

  /**
   * FR-NOTE-23 (ADR-0034): called by the command that ends an encounter, in its transaction,
   * after its own event. Every `pending` row of the actor's campaign whose kind has an end rule
   * and whose `encounterIdOf(payload)` = `encounterId` → `dismissed` (closed by the actor), one
   * `NotificationDismissed` each, in row `seq` order. None → no change, no event.
   */
  function dismissForEncounter(env: CommandEnv, encounterId: string): RecordChange[] {
    const campaignId = env.actor.campaignId;
    if (!campaignId) throw new Error("dismissForEncounter: no campaign in env.actor");
    map ??= buildKindMap(kinds);
    const ruled = [...map.values()].filter((d) => d.endRule).map((d) => d.kind);
    if (ruled.length === 0) return [];
    const rows = env.tx
      .select()
      .from(notification)
      .where(
        and(
          eq(notification.campaignId, campaignId),
          eq(notification.state, "pending"),
          inArray(notification.kind, ruled),
        ),
      )
      .orderBy(asc(notification.seq))
      .all();
    return rows
      .map(toNotificationRecord)
      .filter((n) => endsWithEncounter(kindOf(n.kind)?.endRule, n.payload, encounterId))
      .map((n) => dismiss(env, n));
  }

  return {
    notify,
    resolveNotification,
    updateNotification,
    reopenNotification,
    dismissNotification,
    dismissForEncounter,
    kindOf,
  };
}

export type NotificationHelpers = ReturnType<typeof createNotificationHelpers>;

const helpers = createNotificationHelpers(notificationKinds);

/** Kind owners' API (protocol §21). */
export const notify = helpers.notify;
export const resolveNotification = helpers.resolveNotification;
export const updateNotification = helpers.updateNotification;
export const reopenNotification = helpers.reopenNotification;
export const dismissNotification = helpers.dismissNotification;
export const dismissForEncounter = helpers.dismissForEncounter;
export const notificationKindOf = helpers.kindOf;
