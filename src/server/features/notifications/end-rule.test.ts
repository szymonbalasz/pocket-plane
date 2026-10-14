// FR-NOTE-23 encounter-scoped kinds (R5, ADR-0034): end-rule load check and
// `dismissForEncounter` with test-registered kinds `t-enc` (end rule) and `t-keep` (none).
import { describe, expect, test } from "bun:test";
import { DAMAGE_CARD_END_RULE } from "@shared/combat-tracker/end-rule";
import { defineEvent } from "@shared/events";
import type { EncounterEndRule } from "@shared/notifications/end-rule";
import { type NotificationRecord, notificationVisibleTo } from "@shared/notifications/schemas";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { type CommandDef, defineCommand } from "../../commands/commands";
import { notification } from "../../db/schema";
import type { Actor, DispatchedEvent } from "../../events/types";
import { createTestServices } from "../../testing/services";
import { addPlayer, createCampaign } from "../campaign-management/commands";
import { damageCardKind } from "../combat-tracker/card-kind";
import { createNotificationHelpers, type NotifyInput } from "./helpers";
import { buildKindMap, defineNotificationKind } from "./kind";

const Ended = defineEvent({
  type: "TestEnded",
  payload: z.object({ encounterId: z.string() }).strict(),
  logged: true,
  undoable: false,
});

const encRule: EncounterEndRule = {
  onEncounterEnd: "dismiss",
  encounterIdOf: (p) => (p as { encounterId: string }).encounterId,
};
const payload = z.object({ encounterId: z.string() }).strict();
const tEnc = defineNotificationKind({
  kind: "t-enc",
  ownerSpec: "test",
  payload,
  endRule: encRule,
});
const tKeep = defineNotificationKind({ kind: "t-keep", ownerSpec: "test", payload });
const h = createNotificationHelpers([tEnc, tKeep]);

function setup() {
  const s = createTestServices({ testMode: true });
  const dm0: Actor = { role: "dm", playerId: null, campaignId: null };
  const run = s.commands.run.bind(s.commands);
  const c1 = run(createCampaign, { name: "One" }, { actor: dm0 });
  const p1 = run(addPlayer, { name: "Player 1" }, { actor: dm0 });
  const p2 = run(addPlayer, { name: "Player 2" }, { actor: dm0 });
  const dm: Actor = { role: "dm", playerId: null, campaignId: c1.id };
  const seen: DispatchedEvent[] = [];
  s.bus.subscribe("test-collect", (e) => seen.push(e));
  s.commands.registerEvent(Ended);
  const send = defineCommand({
    name: "t.notify",
    input: z.object({ req: z.unknown() }),
    execute({ req }, env) {
      return { id: h.notify(env, req as NotifyInput) };
    },
  });
  // The ending command: its own event first, then the helper (FR-NOTE-23); `fail` throws after.
  const end = defineCommand({
    name: "t.end",
    input: z.object({ encounterId: z.string(), fail: z.boolean().default(false) }),
    execute({ encounterId, fail }, env) {
      env.emit({ type: Ended.type, campaignId: c1.id, payload: { encounterId }, changes: [] });
      const changes = h.dismissForEncounter(env, encounterId);
      if (fail) throw new Error("caller failed after dismissForEncounter");
      return { dismissed: changes.map((c) => c.id) };
    },
  });
  for (const c of [send, end]) s.commands.register(c as unknown as CommandDef);
  const card = (kind: string, encounterId: string, o: Partial<NotifyInput> = {}) =>
    (
      run(
        "t.notify",
        {
          req: {
            kind,
            audience: "dm",
            text: `${kind} ${encounterId}`,
            payload: { encounterId },
            action: { label: "Apply", role: "dm" },
            ...o,
          },
        },
        { actor: dm },
      ) as { id: string }
    ).id;
  const states = () =>
    Object.fromEntries(
      s.db
        .select()
        .from(notification)
        .orderBy(asc(notification.seq))
        .all()
        .map((r) => [r.id, r.state]),
    );
  return { s, run, dm, p1, p2, seen, card, states };
}

describe("FR-NOTE-23 encounter-scoped kinds", () => {
  test("FR-NOTE-23 dismissForEncounter: pending opted-in rows of E1 only, NotificationDismissed × 2 in seq order after the caller's event", () => {
    const t = setup();
    const a = t.card("t-enc", "E1", { audience: "player", audiencePlayerId: t.p1.id });
    const other = t.card("t-enc", "E2");
    const done = t.card("t-enc", "E1");
    const b = t.card("t-enc", "E1");
    const keep = t.card("t-keep", "E1");
    const info = t.card("t-enc", "E1", { action: undefined });
    // A resolved E1 row stays resolved.
    t.s.db.update(notification).set({ state: "resolved" }).where(eq(notification.id, done)).run();
    const n = t.seen.length;
    const r = t.run("t.end", { encounterId: "E1" }, { actor: t.dm }) as { dismissed: string[] };
    expect(r.dismissed).toEqual([a, b]);
    expect(t.states()).toEqual({
      [a]: "dismissed",
      [other]: "pending",
      [done]: "resolved",
      [b]: "dismissed",
      [keep]: "pending",
      [info]: "info",
    });
    const events = t.seen.slice(n).map((e) => e.event);
    expect(
      events.map((e) => [e.type, (e.payload as { notificationId?: string }).notificationId]),
    ).toEqual([
      ["TestEnded", undefined],
      ["NotificationDismissed", a],
      ["NotificationDismissed", b],
    ]);
    // Closed by the actor at the command's clock, as `note.dismiss` (FR-NOTE-07).
    const after = events[1]?.changes[0]?.after as NotificationRecord;
    expect(after).toMatchObject({
      state: "dismissed",
      closedByRole: "dm",
      closedByPlayerId: null,
      audience: "player",
      audiencePlayerId: t.p1.id,
    });
    expect(after.closedAt).toBeString();
    // Same visibility as any notification upsert: player-1 only (FR-NOTE-06).
    expect(notificationVisibleTo(after, { role: "player", playerId: t.p1.id })).toBe(true);
    expect(notificationVisibleTo(after, { role: "player", playerId: t.p2.id })).toBe(false);
  });

  test("FR-NOTE-23 none → no change, no event; caller throws → nothing dismissed, no event", () => {
    const t = setup();
    const a = t.card("t-enc", "E1");
    let n = t.seen.length;
    expect(t.run("t.end", { encounterId: "E9" }, { actor: t.dm })).toEqual({ dismissed: [] });
    expect(t.seen.slice(n).map((e) => e.event.type)).toEqual(["TestEnded"]);
    n = t.seen.length;
    expect(() => t.run("t.end", { encounterId: "E1", fail: true }, { actor: t.dm })).toThrow();
    expect(t.states()).toEqual({ [a]: "pending" });
    expect(t.seen.length).toBe(n);
  });
});

describe("FR-NOTE-23 registry", () => {
  test("FR-NOTE-23 registry: an end rule without encounterIdOf throws at load", () => {
    const bad = { onEncounterEnd: "dismiss" } as unknown as EncounterEndRule;
    expect(() =>
      buildKindMap([defineNotificationKind({ kind: "x", ownerSpec: "x", payload, endRule: bad })]),
    ).toThrow("an end rule needs encounterIdOf");
    expect(() => buildKindMap([tEnc, tKeep])).not.toThrow();
  });

  test("FR-NOTE-23 registry: damage-card's encounterIdOf of its payload = its encounterId", () => {
    expect(damageCardKind.endRule).toBe(DAMAGE_CARD_END_RULE);
    expect(DAMAGE_CARD_END_RULE.encounterIdOf({ encounterId: "e1", attackerId: "a" })).toBe("e1");
    expect(DAMAGE_CARD_END_RULE.encounterIdOf({})).toBeNull();
    expect(DAMAGE_CARD_END_RULE.encounterIdOf(null)).toBeNull();
  });
});
