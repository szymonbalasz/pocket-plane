// Sprint 5 (FR-CBT-91 seam): a kind's optional `onClose(env, row)` runs on every dismissal
// (`note.dismiss`'s helper and `dismissForEncounter`) in its transaction; its record changes ride
// on that `NotificationDismissed`; a throw rolls the dismissal back; kinds without it are as before.
import { describe, expect, test } from "bun:test";
import type { EncounterEndRule } from "@shared/notifications/end-rule";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type CommandDef, defineCommand } from "../../commands/commands";
import { notification } from "../../db/schema";
import type { Actor, DispatchedEvent } from "../../events/types";
import { createTestServices } from "../../testing/services";
import { createCampaign } from "../campaign-management/commands";
import { createNotificationHelpers, type NotifyInput } from "./helpers";
import { defineNotificationKind } from "./kind";

const encRule: EncounterEndRule = {
  onEncounterEnd: "dismiss",
  encounterIdOf: (p) => (p as { encounterId: string }).encounterId,
};
const payload = z.object({ encounterId: z.string() }).strict();
const closed: string[] = [];
const tClose = defineNotificationKind({
  kind: "t-close",
  ownerSpec: "test",
  payload,
  endRule: encRule,
  onClose: (_env, row: NotificationRecord) => {
    closed.push(row.id);
    if (row.text === "boom") throw new Error("close hook failed");
    return [{ type: "t-closed", id: row.id, before: { id: row.id }, after: null }];
  },
});
const tPlain = defineNotificationKind({ kind: "t-plain", ownerSpec: "test", payload });
const h = createNotificationHelpers([tClose, tPlain]);

function setup() {
  const s = createTestServices({ testMode: true });
  const dm0: Actor = { role: "dm", playerId: null, campaignId: null };
  const run = s.commands.run.bind(s.commands);
  const c1 = run(createCampaign, { name: "One" }, { actor: dm0 });
  const dm: Actor = { role: "dm", playerId: null, campaignId: c1.id };
  const seen: DispatchedEvent[] = [];
  s.bus.subscribe("test-collect", (e) => seen.push(e));
  const cmds = [
    defineCommand({
      name: "t.notify",
      input: z.object({ req: z.unknown() }),
      execute({ req }, env) {
        return { id: h.notify(env, req as NotifyInput) };
      },
    }),
    defineCommand({
      name: "t.dismiss",
      input: z.object({ id: z.string() }),
      execute({ id }, env) {
        h.dismissNotification(env, id);
      },
    }),
    defineCommand({
      name: "t.end",
      input: z.object({ encounterId: z.string() }),
      execute({ encounterId }, env) {
        h.dismissForEncounter(env, encounterId);
      },
    }),
  ];
  for (const c of cmds) s.commands.register(c as unknown as CommandDef);
  const card = (kind: string, text = "card") =>
    (
      run(
        "t.notify",
        {
          req: {
            kind,
            audience: "dm",
            text,
            payload: { encounterId: "E1" },
            action: { label: "Apply", role: "dm" },
          },
        },
        { actor: dm },
      ) as { id: string }
    ).id;
  const state = (id: string) =>
    s.db.select().from(notification).where(eq(notification.id, id)).get()?.state;
  return { run, dm, seen, card, state };
}

describe("notification kind onClose (sprint 5)", () => {
  test("FR-CBT-91 note.dismiss path: the hook's changes ride on NotificationDismissed; plain kinds unchanged", () => {
    const t = setup();
    const a = t.card("t-close");
    const plain = t.card("t-plain");
    closed.length = 0;
    const n = t.seen.length;
    t.run("t.dismiss", { id: a }, { actor: t.dm });
    t.run("t.dismiss", { id: plain }, { actor: t.dm });
    const evs = t.seen.slice(n).map((e) => e.event);
    expect(evs.map((e) => [e.type, e.changes.map((c) => c.type)])).toEqual([
      ["NotificationDismissed", ["notification", "t-closed"]],
      ["NotificationDismissed", ["notification"]],
    ]);
    expect(closed).toEqual([a]);
  });

  test("FR-CBT-91 dismissForEncounter path runs the hook per row; a throw rolls the dismissal back", () => {
    const t = setup();
    const a = t.card("t-close");
    const b = t.card("t-close");
    closed.length = 0;
    const n = t.seen.length;
    t.run("t.end", { encounterId: "E1" }, { actor: t.dm });
    const evs = t.seen.slice(n).map((e) => e.event);
    expect(evs.map((e) => e.changes.map((c) => c.id))).toEqual([
      [a, a],
      [b, b],
    ]);
    expect(closed).toEqual([a, b]);
    const bad = t.card("t-close", "boom");
    expect(() => t.run("t.dismiss", { id: bad }, { actor: t.dm })).toThrow();
    expect(t.state(bad)).toBe("pending");
  });
});
