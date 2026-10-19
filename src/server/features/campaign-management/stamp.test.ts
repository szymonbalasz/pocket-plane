// K0's person stamps outside CAMP (ADR-0055): FR-NOTE-38 `notify` records who caused a
// notification (system actor → none; system closes → no closer), FR-DICE-61 a system actor
// never writes a game-log entry.
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { defineCommand } from "../../commands/commands";
import { manualClock } from "../../commands/context";
import { CommandError } from "../../commands/errors";
import { gameLogEntry, notification } from "../../db/schema";
import type { Actor } from "../../events/types";
import { seedSyncProbe } from "../../testing/seed";
import { createTestServices, DM_ACTOR } from "../../testing/services";
import { dice, gameLog } from "../dice-roll-log/index";
import { noteTestSend } from "../notifications/commands";
import {
  dismissNotification,
  notify,
  reopenNotification,
  resolveNotification,
  updateNotification,
} from "../notifications/helpers";

const STEP = z.enum(["notify", "update", "resolve", "reopen", "dismiss"]);

/** One test command over the kind owners' helpers, runnable by any actor (system included). */
const noteStep = defineCommand({
  name: "test.noteStep",
  input: z.object({ step: STEP, id: z.string().optional() }),
  roles: ["dm", "player"],
  execute({ step, id }, env) {
    if (step === "notify") {
      return notify(env, {
        kind: "test",
        audience: "all",
        text: "Stamp me",
        payload: {},
        action: { label: "Go", role: "dm" },
      });
    }
    const target = id as string;
    if (step === "update") updateNotification(env, target, { text: "Updated", payload: {} });
    if (step === "resolve") resolveNotification(env, target);
    if (step === "reopen") reopenNotification(env, target);
    if (step === "dismiss") dismissNotification(env, target);
    return target;
  },
});

const logStep = defineCommand({
  name: "test.logStep",
  input: z.object({}),
  roles: ["dm", "player"],
  execute(_input, env) {
    const r = dice.evaluate(env, {
      expression: "1d20",
      mode: "normal",
      category: "other",
      actor: { kind: "entity", id: "mira", name: "Mira" },
      source: "char",
    });
    const change = gameLog.append(env, {
      kind: "roll",
      category: "other",
      actorName: "Mira",
      payload: [dice.rollPayloadItem(r)],
      rollIds: [r.id],
      public: true,
    });
    return change.id;
  },
});

function setup() {
  const s = createTestServices({ clock: manualClock() });
  const seed = seedSyncProbe(s);
  s.commands.register(noteStep);
  s.commands.register(logStep);
  const cid = seed.campaignId;
  const actors: Record<"dm" | "p1" | "system", Actor> = {
    dm: { ...DM_ACTOR, campaignId: cid },
    p1: { role: "player", playerId: seed.p1.id, campaignId: cid },
    system: { role: "system", playerId: null, campaignId: cid },
  };
  const step = (who: keyof typeof actors, input: z.input<typeof noteStep.input>) =>
    s.commands.run(noteStep, input, { actor: actors[who] }) as string;
  const row = (id: string) =>
    s.db
      .select()
      .from(notification)
      .where(eq(notification.id, id))
      .get() as typeof notification.$inferSelect;
  return { s, seed, actors, step, row };
}

describe("FR-NOTE-38 who caused it", () => {
  test("FR-NOTE-38 notify stamps by: DM → dm / null; player-1 → player / their id; system → null / null; update, resolve, dismiss, reopen keep it", () => {
    const t = setup();
    const want = {
      dm: { byRole: "dm", byPlayerId: null },
      p1: { byRole: "player", byPlayerId: t.seed.p1.id },
      system: { byRole: null, byPlayerId: null },
    } as const;
    for (const who of ["dm", "p1", "system"] as const) {
      const id = t.step(who, { step: "notify" });
      expect(t.row(id)).toMatchObject(want[who]);
      // Later changes by others never touch it.
      t.step("dm", { step: "update", id });
      t.step("dm", { step: "resolve", id });
      t.step("system", { step: "reopen", id });
      expect(t.row(id)).toMatchObject({ ...want[who], state: "pending", text: "Updated" });
      t.step("dm", { step: "dismiss", id });
      expect(t.row(id)).toMatchObject({ ...want[who], state: "dismissed" });
    }
  });

  test("FR-NOTE-38 note.testSend from a player stamps them; from the DM the DM; `byPlayerId` in the intent → invalid", () => {
    const t = setup();
    const send = (who: "dm" | "p1", input: Record<string, unknown>) =>
      t.s.commands.run(noteTestSend, input as never, { actor: t.actors[who] }) as { id: string };
    expect(t.row(send("p1", { text: "From Player 1" }).id)).toMatchObject({
      byRole: "player",
      byPlayerId: t.seed.p1.id,
    });
    expect(t.row(send("dm", { text: "From the DM", audience: "all" }).id)).toMatchObject({
      byRole: "dm",
      byPlayerId: null,
    });
    for (const [who, extra] of [
      ["p1", { byPlayerId: t.seed.p2.id }],
      ["dm", { byPlayerId: t.seed.p1.id }],
      ["dm", { byRole: "player" }],
    ] as const) {
      const run = () => send(who, { text: "Forged", ...extra });
      expect(run).toThrow(CommandError);
      try {
        run();
      } catch (e) {
        expect((e as CommandError).code).toBe("invalid");
      }
    }
    expect(t.s.db.select().from(notification).all()).toHaveLength(2);
  });

  test("FR-NOTE-38 system actor: notify → byRole / byPlayerId null; resolveNotification and dismiss → closedByRole / closedByPlayerId null", () => {
    const t = setup();
    const a = t.step("system", { step: "notify" });
    expect(t.row(a)).toMatchObject({ byRole: null, byPlayerId: null, state: "pending" });
    t.step("system", { step: "resolve", id: a });
    expect(t.row(a)).toMatchObject({
      state: "resolved",
      closedByRole: null,
      closedByPlayerId: null,
    });
    expect(t.row(a).closedAt).not.toBeNull();
    const b = t.step("dm", { step: "notify" });
    t.step("system", { step: "dismiss", id: b });
    expect(t.row(b)).toMatchObject({
      state: "dismissed",
      closedByRole: null,
      closedByPlayerId: null,
    });
    // The DM and a player still close as themselves (FR-NOTE-07).
    const c = t.step("dm", { step: "notify" });
    t.step("dm", { step: "resolve", id: c });
    expect(t.row(c)).toMatchObject({ closedByRole: "dm", closedByPlayerId: null });
  });
});

describe("FR-DICE-61 system actor", () => {
  test("FR-DICE-61 system actor: gameLog.append under the system actor throws and the command rolls back; DM / player stamp dm / the player as today", () => {
    const t = setup();
    const entries = () => t.s.db.select().from(gameLogEntry).all();
    const run = (who: keyof typeof t.actors) =>
      t.s.commands.run(logStep, {}, { actor: t.actors[who] }) as string;
    let code = "";
    try {
      run("system");
    } catch (e) {
      code = e instanceof CommandError ? e.code : "other";
    }
    expect(code).toBe("internal");
    expect(entries()).toEqual([]);
    run("dm");
    run("p1");
    expect(entries().map((e) => [e.rollerRole, e.rollerPlayerId])).toEqual([
      ["dm", null],
      ["player", t.seed.p1.id],
    ]);
  });
});
