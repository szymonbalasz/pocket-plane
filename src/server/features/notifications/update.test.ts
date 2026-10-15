// FR-NOTE-25 `updateNotification` (ADR-0037) and FR-NOTE-28 rule closures without an actor.
import { describe, expect, test } from "bun:test";
import { defineEvent } from "@shared/events";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type CommandDef, defineCommand } from "../../commands/commands";
import { CommandError } from "../../commands/errors";
import { notification } from "../../db/schema";
import { readEventLog } from "../../events/log";
import type { Actor, DispatchedEvent } from "../../events/types";
import { createTestServices } from "../../testing/services";
import { activateCampaign, addPlayer, createCampaign } from "../campaign-management/commands";
import { createNotificationHelpers, type NotifyInput } from "./helpers";
import { defineNotificationKind } from "./kind";

const Owned = defineEvent({
  type: "TestOwned",
  payload: z.object({ id: z.string() }).strict(),
  logged: true,
  undoable: false,
});

const cardKind = defineNotificationKind({
  kind: "card",
  ownerSpec: "test",
  payload: z.object({ damage: z.int().nullable(), blob: z.string().optional() }).strict(),
  payloadMaxBytes: 256,
  resolution: z.object({ outcome: z.string() }).strict(),
});
const h = createNotificationHelpers([cardKind]);

function setup() {
  const s = createTestServices({ testMode: true });
  const dm0: Actor = { role: "dm", playerId: null, campaignId: null };
  const run = s.commands.run.bind(s.commands);
  const c1 = run(createCampaign, { name: "One" }, { actor: dm0 });
  const p1 = run(addPlayer, { name: "Player 1" }, { actor: dm0 });
  const c2 = run(createCampaign, { name: "Two" }, { actor: dm0 });
  run(activateCampaign, { id: c1.id }, { actor: dm0 });
  const dm: Actor = { role: "dm", playerId: null, campaignId: c1.id };
  const dmOther: Actor = { role: "dm", playerId: null, campaignId: c2.id };
  const asP1: Actor = { role: "player", playerId: p1.id, campaignId: c1.id };
  const seen: DispatchedEvent[] = [];
  s.bus.subscribe("test-collect", (e) => seen.push(e));
  s.commands.registerEvent(Owned);
  const commands = [
    defineCommand({
      name: "t.notify",
      input: z.object({ req: z.unknown() }),
      roles: ["dm", "player"],
      execute: ({ req }, env) => ({ id: h.notify(env, req as NotifyInput) }),
    }),
    // A kind owner's command: own event first, then the update (protocol §22 order).
    defineCommand({
      name: "t.update",
      input: z.object({ id: z.string(), text: z.string().optional(), payload: z.unknown() }),
      roles: ["dm", "player"],
      execute({ id, text, payload }, env) {
        env.emit({
          type: Owned.type,
          campaignId: env.actor.campaignId,
          payload: { id },
          changes: [],
        });
        return h.updateNotification(env, id, { text, payload });
      },
    }),
    defineCommand({
      name: "t.rule",
      input: z.object({ id: z.string() }),
      roles: ["dm", "player"],
      execute: ({ id }, env) =>
        h.resolveNotification(env, id, { outcome: "ended" }, { byRule: true }),
    }),
    defineCommand({
      name: "t.resolve",
      input: z.object({ id: z.string() }),
      roles: ["dm", "player"],
      execute: ({ id }, env) => h.resolveNotification(env, id, { outcome: "applied" }),
    }),
  ];
  for (const c of commands) s.commands.register(c as unknown as CommandDef);
  const row = (id: string) =>
    s.db.select().from(notification).where(eq(notification.id, id)).get() as NotificationRecord;
  const card = (action = true) =>
    (
      run(
        "t.notify",
        {
          req: {
            kind: "card",
            audience: "player",
            audiencePlayerId: p1.id,
            text: "Mira: 15 to hit (Light crossbow)",
            payload: { damage: null },
            ...(action ? { action: { label: "Apply", role: "dm" } } : {}),
          },
        },
        { actor: dm },
      ) as { id: string }
    ).id;
  return { s, run, dm, dmOther, asP1, seen, row, card };
}

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return e instanceof CommandError ? e.code : `error: ${(e as Error).message}`;
  }
  return "ok";
};

describe("FR-NOTE-25 updateNotification", () => {
  test("pending row: payload + text replaced; audience, action, seq, createdAt kept; event after the owner's", () => {
    const t = setup();
    const id = t.card();
    const before = t.row(id);
    const logBefore = readEventLog(t.s.db).length;
    const after = t.run(
      "t.update",
      { id, text: "Mira: 15 to hit, 6 piercing", payload: { damage: 6 } },
      { actor: t.asP1 },
    ) as NotificationRecord;
    expect(t.row(id)).toEqual({
      ...before,
      text: "Mira: 15 to hit, 6 piercing",
      payload: { damage: 6 },
      updatedAt: after.updatedAt,
    });
    expect(after).toEqual(t.row(id));
    expect(t.seen.slice(-2).map((e) => e.event.type)).toEqual(["TestOwned", "NotificationUpdated"]);
    const ev = t.seen.at(-1)?.event;
    expect(ev?.payload).toEqual({ notificationId: id, kind: "card" });
    expect(ev?.changes).toEqual([{ type: "notification", id, before, after }]);
    expect(
      readEventLog(t.s.db)
        .slice(logBefore)
        .map((l) => l.type),
    ).toEqual(["TestOwned", "NotificationUpdated"]);
    // Text optional: payload-only update keeps the text.
    t.run("t.update", { id, payload: { damage: 7 } }, { actor: t.dm });
    expect(t.row(id)).toMatchObject({
      text: "Mira: 15 to hit, 6 piercing",
      payload: { damage: 7 },
    });
  });

  test("not pending → conflict; other campaign → not_found; the whole command rolls back", () => {
    const t = setup();
    const info = t.card(false);
    const n = t.seen.length;
    expect(
      codeOf(() => t.run("t.update", { id: info, payload: { damage: 1 } }, { actor: t.dm })),
    ).toBe("conflict");
    const id = t.card();
    expect(
      codeOf(() => t.run("t.update", { id, payload: { damage: 1 } }, { actor: t.dmOther })),
    ).toBe("not_found");
    t.run("t.resolve", { id }, { actor: t.dm });
    expect(codeOf(() => t.run("t.update", { id, payload: { damage: 1 } }, { actor: t.dm }))).toBe(
      "conflict",
    );
    expect(t.row(id).payload).toEqual({ damage: null });
    expect(t.seen.slice(n).map((e) => e.event.type)).toEqual([
      "NotificationCreated",
      "NotificationResolved",
    ]);
  });

  test("bad payload, payload over the kind's cap, bad text → internal, nothing written", () => {
    const t = setup();
    const id = t.card();
    const before = t.row(id);
    for (const input of [
      { id, payload: { damage: "six" } },
      { id, payload: { damage: 6, blob: "x".repeat(300) } },
      { id, payload: { damage: 6 }, text: "" },
      { id, payload: { damage: 6 }, text: "x".repeat(281) },
    ]) {
      expect(codeOf(() => t.run("t.update", input, { actor: t.dm }))).toBe("internal");
    }
    expect(t.row(id)).toEqual(before);
  });
});

describe("FR-NOTE-28 rule closures record no actor", () => {
  test("byRule resolve: closedAt set, closedByRole / closedByPlayerId null (player or DM actor)", () => {
    const t = setup();
    const a = t.card();
    t.run("t.rule", { id: a }, { actor: t.asP1 });
    expect(t.row(a)).toMatchObject({
      state: "resolved",
      resolution: { outcome: "ended" },
      closedByRole: null,
      closedByPlayerId: null,
    });
    expect(t.row(a).closedAt).toBeString();
    const b = t.card();
    t.run("t.rule", { id: b }, { actor: t.dm });
    expect(t.row(b)).toMatchObject({ closedByRole: null, closedByPlayerId: null });
    // A user's own resolve still records the actor.
    const c = t.card();
    t.run("t.resolve", { id: c }, { actor: t.dm });
    expect(t.row(c)).toMatchObject({ closedByRole: "dm", closedByPlayerId: null });
  });
});
