// notifications intents (NOTE §9, protocol §21): `note.dismiss` (DM), `note.resolve` (DM,
// player; genericResolve kinds), `note.testSend` (test mode, FR-NOTE-22).
import {
  DEFAULT_TEST_LABEL,
  NoteDismissInput,
  NoteResolveInput,
  NoteTestSendInput,
  notificationVisibleTo,
  PLAYER_TEST_SEND_FIELDS,
  TEST_KIND,
} from "@shared/notifications/schemas";
import { and, eq } from "drizzle-orm";
import { defineCommand } from "../../commands/commands";
import { conflict, forbidden, invalid, notFound } from "../../commands/errors";
import { player } from "../../db/schema";
import {
  dismissNotification,
  loadNotification,
  type NotifyInput,
  notificationKindOf,
  notify,
  resolveNotification,
} from "./helpers";

/** FR-NOTE-11: DM only; `pending` → `dismissed`, else `conflict`. */
export const noteDismiss = defineCommand({
  name: "note.dismiss",
  input: NoteDismissInput,
  roles: ["dm"],
  execute({ id }, env) {
    dismissNotification(env, id);
  },
});

/**
 * FR-NOTE-09: `genericResolve` kinds only (else `forbidden`); a notification the player can't
 * see answers `not_found` (never confirms an ID); then FR-NOTE-08 (`conflict`, `forbidden`).
 */
export const noteResolve = defineCommand({
  name: "note.resolve",
  input: NoteResolveInput,
  roles: ["dm", "player"],
  authorize({ id }, env) {
    const n = loadNotification(env, id);
    if (env.actor.role === "player") {
      const viewer = { role: "player" as const, playerId: env.actor.playerId };
      if (!notificationVisibleTo(n, viewer)) throw notFound("Notification not found");
    }
    if (notificationKindOf(n.kind)?.genericResolve !== true) {
      throw forbidden("This notification can't be resolved here");
    }
  },
  execute({ id, resolution }, env) {
    resolveNotification(env, id, resolution);
  },
});

/**
 * FR-NOTE-22 (test mode): DM: any audience and action. Player: `{text, actionLabel?}` only;
 * audience = self, owner = DM (like a damage card). Input errors answer `invalid` /
 * `not_found` here, before `notify` (whose throws are server bugs).
 */
export const noteTestSend = defineCommand({
  name: "note.testSend",
  input: NoteTestSendInput,
  roles: ["dm", "player"],
  authorize(input, { tx, actor }) {
    if (!actor.campaignId) throw conflict("No campaign context");
    if (actor.role === "player") {
      const extra = Object.keys(input).filter((k) => !PLAYER_TEST_SEND_FIELDS.includes(k));
      if (extra.length > 0) {
        throw invalid(
          "Invalid input",
          extra.map((k) => ({ path: [k], message: "Not allowed for players" })),
        );
      }
      return;
    }
    const audience = input.audience ?? "dm";
    const isPlayer = (id: string) =>
      tx
        .select({ id: player.id })
        .from(player)
        .where(and(eq(player.id, id), eq(player.campaignId, actor.campaignId as string)))
        .get() !== undefined;
    if (audience === "player") {
      if (!input.audiencePlayerId) {
        throw invalid("Invalid input", [{ path: ["audiencePlayerId"], message: "Required" }]);
      }
      if (!isPlayer(input.audiencePlayerId)) throw notFound("Player not found in this campaign");
    } else if (input.audiencePlayerId !== undefined) {
      throw invalid("Invalid input", [
        { path: ["audiencePlayerId"], message: "Only with audience player" },
      ]);
    }
    const hasAction = input.actionLabel !== undefined;
    if (!hasAction && (input.actionRole !== undefined || input.actionPlayerId !== undefined)) {
      throw invalid("Invalid input", [{ path: ["actionLabel"], message: "Required" }]);
    }
    if ((input.actionRole ?? "dm") === "player") {
      const owner = input.actionPlayerId;
      if (!owner) {
        throw invalid("Invalid input", [{ path: ["actionPlayerId"], message: "Required" }]);
      }
      if (!isPlayer(owner)) throw notFound("Player not found in this campaign");
      const inAudience =
        audience === "all" || (audience === "player" && input.audiencePlayerId === owner);
      if (!inAudience) {
        throw invalid("Invalid input", [
          { path: ["actionPlayerId"], message: "The action owner must be in the audience" },
        ]);
      }
    } else if (input.actionPlayerId !== undefined) {
      throw invalid("Invalid input", [
        { path: ["actionPlayerId"], message: "Only with a player owner" },
      ]);
    }
  },
  execute(input, env) {
    let req: NotifyInput;
    if (env.actor.role === "player") {
      req = {
        kind: TEST_KIND,
        audience: "player",
        audiencePlayerId: env.actor.playerId,
        text: input.text,
        payload: {},
        action: { label: input.actionLabel ?? DEFAULT_TEST_LABEL, role: "dm" },
      };
    } else {
      const audience = input.audience ?? "dm";
      const role = input.actionRole ?? "dm";
      req = {
        kind: TEST_KIND,
        audience,
        audiencePlayerId: audience === "player" ? input.audiencePlayerId : null,
        text: input.text,
        payload: {},
        action:
          input.actionLabel === undefined
            ? undefined
            : {
                label: input.actionLabel,
                role,
                playerId: role === "player" ? input.actionPlayerId : null,
              },
      };
    }
    return { id: notify(env, req) };
  },
});
