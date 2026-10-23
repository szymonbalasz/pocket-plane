// FR-NOTE-74 (sprint 9, FX2, BL-63): `updateNotification({emit: false})` returns the row's change
// for the caller's own event instead of emitting `NotificationUpdated` (protocol gate I15).
import { describe, expect, test } from "bun:test";
import { defineEvent } from "@shared/events";
import { z } from "zod";
import { type CommandDef, defineCommand } from "../../commands/commands";
import type { Actor, DispatchedEvent, RecordChange } from "../../events/types";
import { createTestServices } from "../../testing/services";
import type { Viewer } from "../../ws/records";
import { activateCampaign, addPlayer, createCampaign } from "../campaign-management/commands";
import { createNotificationHelpers, type NotifyInput } from "./helpers";
import { defineNotificationKind } from "./kind";

const Owned = defineEvent({
  type: "TestFoldOwned",
  payload: z.object({ id: z.string() }).strict(),
  logged: true,
  undoable: false,
});

const cardKind = defineNotificationKind({
  kind: "card",
  ownerSpec: "test",
  payload: z.object({ damage: z.int().nullable() }).strict(),
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
  const p2 = run(addPlayer, { name: "Player 2" }, { actor: dm0 });
  run(activateCampaign, { id: c1.id }, { actor: dm0 });
  const dm: Actor = { role: "dm", playerId: null, campaignId: c1.id };
  const seen: DispatchedEvent[] = [];
  s.bus.subscribe("test-collect", (e) => seen.push(e));
  s.commands.registerEvent(Owned);
  const commands = [
    defineCommand({
      name: "t.notify",
      input: z.object({ req: z.unknown() }),
      execute: ({ req }, env) => ({ id: h.notify(env, req as NotifyInput) }),
    }),
    // A kind owner's command: the update first, folded into its own event.
    defineCommand({
      name: "t.fold",
      input: z.object({ id: z.string(), damage: z.int() }),
      execute({ id, damage }, env) {
        const change = h.updateNotification(
          env,
          id,
          { text: `Updated ${damage}`, payload: { damage } },
          { emit: false },
        );
        env.emit({
          type: Owned.type,
          campaignId: env.actor.campaignId,
          payload: { id },
          changes: [change],
        });
        return change;
      },
    }),
    defineCommand({
      name: "t.update",
      input: z.object({ id: z.string(), damage: z.int() }),
      execute: ({ id, damage }, env) =>
        h.updateNotification(env, id, { text: `Updated ${damage}`, payload: { damage } }),
    }),
  ];
  for (const c of commands) s.commands.register(c as unknown as CommandDef);
  const card = () =>
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
            action: { label: "Apply", role: "dm" },
          },
        },
        { actor: dm },
      ) as { id: string }
    ).id;
  const viewer = (role: "dm" | "player", playerId: string | null): Viewer => ({
    connId: `v-${role}-${playerId ?? "dm"}`,
    campaignId: c1.id,
    role,
    playerId,
  });
  return { s, run, dm, seen, card, p1V: viewer("player", p1.id), p2V: viewer("player", p2.id) };
}

describe("FR-NOTE-74 updateNotification can fold into the caller's event", () => {
  test("FR-NOTE-74 update folds into the caller's event", () => {
    const t = setup();
    const a = t.card();
    const b = t.card();
    let n = t.seen.length;
    const change = t.run("t.fold", { id: a, damage: 7 }, { actor: t.dm }) as RecordChange;
    // One `notification` change, no `NotificationUpdated`: the caller's event carries it.
    expect(change).toMatchObject({ type: "notification", id: a });
    const folded = t.seen.slice(n);
    expect(folded.map((e) => e.event.type)).toEqual([Owned.type]);
    expect(folded[0]?.event.changes).toEqual([change]);
    // Default unchanged: its own `NotificationUpdated`.
    n = t.seen.length;
    t.run("t.update", { id: b, damage: 7 }, { actor: t.dm });
    const own = t.seen.slice(n);
    expect(own.map((e) => e.event.type)).toEqual(["NotificationUpdated"]);
    const plain = own[0]?.event.changes[0] as RecordChange;
    // Same row change either way; the players' view is today's (the owner sees it, others don't).
    // Same wire shape as today's (ids and `seq` aside: two cards).
    const view = (c: RecordChange) => {
      const w = t.s.records.filterChange(c, t.p1V);
      if (!w || !("data" in w)) return w;
      const { id: _id, seq: _seq, ...data } = w.data as { id: string; seq: number };
      return { ...w, id: "x", data };
    };
    expect(view(change)).toEqual(view(plain));
    expect(view(change)).not.toBeNull();
    expect(t.s.records.filterChange(change, t.p2V)).toBeNull();
    expect(t.s.records.filterChange(plain, t.p2V)).toBeNull();
    // `seq` (unread) unchanged by an update, folded or not.
    expect((change.after as { seq: number }).seq).toBe((change.before as { seq: number }).seq);
  });
});
