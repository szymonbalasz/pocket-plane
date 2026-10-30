// FR-DICE-99–101 `dice.setEntryHidden`, in-process: hide, reveal, restore of a stamp, the rerolled
// chain, no-op, forbidden / not found, the guarded conflict, and the reads on top (FR-DICE-102).
import { describe, expect, test } from "bun:test";
import { GEMS_FEATURE } from "@shared/campaign-management/features";
import {
  GAME_LOG_ENTRY_TYPE,
  type GameLogEntryRecord,
  REVEAL_GUARDED,
} from "@shared/dice-roll-log/schemas";
import { GEM_SPEND_INTENT } from "@shared/gems/schemas";
import {
  DmRecapResult,
  PlayerRecapResult,
  RECAP_QUERY_INTENT,
} from "@shared/session-recap/schemas";
import { SessionsResult, STATS_QUERY_INTENT } from "@shared/stats/schemas";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { defineCommand } from "../../commands/commands";
import { CommandError } from "../../commands/errors";
import { eventLog, gameLogEntry } from "../../db/schema";
import type { Actor, DispatchedEvent } from "../../events/types";
import { setFeature } from "../campaign-management/features";
import { ROLL } from "./commands";
import { SET_ENTRY_HIDDEN } from "./hidden";
import { dice, gameLog } from "./index";
import { diceServices, seedDice } from "./testing";

/** A companion's line: DM + its owner (ADR-0056). */
const companionLine = defineCommand({
  name: "test.companionLine",
  input: z.object({ owner: z.string() }),
  execute({ owner }, env) {
    const r = dice.evaluate(env, {
      expression: "1d20",
      mode: "normal",
      category: "attack",
      actor: { kind: "dm", id: null, name: "Owlbear" },
      source: "dice",
    });
    return gameLog.append(env, {
      kind: "roll",
      category: "attack",
      actorName: "Owlbear",
      payload: [dice.rollPayloadItem(r)],
      rollIds: [r.id],
      audiencePlayerId: owner,
    }).id;
  },
});

/** Rerolls a line's roll as `gem.spend` does (no event needed here). */
const rerollLine = defineCommand({
  name: "test.rerollLine",
  input: z.object({ entryId: z.string(), rollId: z.string() }),
  execute(input, env) {
    return dice.reroll(env, input).entry.id;
  },
});

function setup() {
  const { s } = diceServices();
  const t = seedDice(s);
  s.commands.register(companionLine);
  s.commands.register(rerollLine);
  const events: DispatchedEvent[] = [];
  s.bus.subscribe("test-capture", (e) => {
    events.push(e);
  });
  const run = <R = unknown>(name: string, input: unknown, actor: Actor = t.dm) =>
    s.commands.run(name, input, { actor }) as R;
  const roll = (extra: Record<string, unknown> = {}, actor: Actor = t.dm) =>
    run<{ entryId: string; rollId: string }>(ROLL, { expression: "1d20+1", ...extra }, actor);
  const row = (id: string) => s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, id)).get();
  const seen = (playerId: string) =>
    (s.records.snapshot({ db: s.db, presence: { list: () => [] } }, t.viewer("player", playerId))[
      GAME_LOG_ENTRY_TYPE
    ] ?? []) as GameLogEntryRecord[];
  const hide = (entryId: string, hidden = true, extra: Record<string, unknown> = {}) =>
    run(SET_ENTRY_HIDDEN, { entryId, hidden, ...extra });
  return { s, t, events, run, roll, row, seen, hide };
}

const failOf = (fn: () => unknown): CommandError => {
  try {
    fn();
  } catch (e) {
    if (e instanceof CommandError) return e;
    throw e;
  }
  throw new Error("expected a CommandError");
};

describe("FR-DICE-99 hide and reveal", () => {
  test("FR-DICE-99 hide: a player's own roll leaves every player's snapshot, the roller's too; the stamp is kept", () => {
    const x = setup();
    const { entryId } = x.roll({}, x.t.p1Actor);
    expect(x.seen(x.t.p1.id).map((e) => e.id)).toContain(entryId);
    x.hide(entryId);
    expect(x.row(entryId)).toMatchObject({
      public: false,
      audiencePlayerId: null,
      hiddenFrom: { public: true, audiencePlayerId: null },
    });
    for (const pid of [x.t.p1.id, x.t.p2.id]) {
      expect(x.seen(pid).map((e) => e.id)).not.toContain(entryId);
    }
    const dmSees = x.s.records.snapshot(
      { db: x.s.db, presence: { list: () => [] } },
      x.t.viewer("dm"),
    )[GAME_LOG_ENTRY_TYPE] as GameLogEntryRecord[];
    expect(dmSees.find((e) => e.id === entryId)?.hiddenFrom).toEqual({
      public: true,
      audiencePlayerId: null,
    });
  });

  test("FR-DICE-99 reveal restores the prior stamp and clears it; one logged event each way", () => {
    const x = setup();
    const { entryId } = x.roll({}, x.t.p1Actor);
    x.events.length = 0;
    x.hide(entryId);
    x.hide(entryId, false);
    expect(x.row(entryId)).toMatchObject({
      public: true,
      audiencePlayerId: null,
      hiddenFrom: null,
    });
    expect(x.seen(x.t.p2.id).map((e) => e.id)).toContain(entryId);
    expect(x.events.map((e) => [e.event.type, e.event.payload])).toEqual([
      ["LogEntryHiddenSet", { entryIds: [entryId], hidden: true }],
      ["LogEntryHiddenSet", { entryIds: [entryId], hidden: false }],
    ]);
    const logged = x.s.db
      .select()
      .from(eventLog)
      .where(eq(eventLog.type, "LogEntryHiddenSet"))
      .all();
    expect(logged).toHaveLength(2);
  });

  test("FR-DICE-100 a companion's stamp: hide takes it from its owner, reveal gives it back to the owner only", () => {
    const x = setup();
    const id = x.run<string>("test.companionLine", { owner: x.t.p1.id });
    expect(x.seen(x.t.p1.id).map((e) => e.id)).toContain(id);
    x.hide(id);
    expect(x.row(id)).toMatchObject({
      public: false,
      audiencePlayerId: null,
      hiddenFrom: { public: false, audiencePlayerId: x.t.p1.id },
    });
    expect(x.seen(x.t.p1.id).map((e) => e.id)).not.toContain(id);
    x.hide(id, false);
    expect(x.row(id)).toMatchObject({
      public: false,
      audiencePlayerId: x.t.p1.id,
      hiddenFrom: null,
    });
    expect(x.seen(x.t.p1.id).map((e) => e.id)).toContain(id);
    expect(x.seen(x.t.p2.id).map((e) => e.id)).not.toContain(id);
  });

  test("FR-DICE-100 a line hidden since it was rolled reveals as public", () => {
    const x = setup();
    const { entryId } = x.roll({ public: false });
    expect(x.row(entryId)?.hiddenFrom).toBeNull();
    x.hide(entryId, false);
    expect(x.row(entryId)).toMatchObject({ public: true, hiddenFrom: null });
  });

  test("FR-DICE-99 same value: no-op, no event", () => {
    const x = setup();
    const hiddenLine = x.roll({ public: false }).entryId;
    const openLine = x.roll({}, x.t.p1Actor).entryId;
    x.events.length = 0;
    x.hide(hiddenLine, true);
    x.hide(openLine, false);
    expect(x.events).toEqual([]);
    expect(x.row(hiddenLine)?.hiddenFrom).toBeNull();
  });

  test("FR-DICE-99 a player gets forbidden; unknown and other campaign's lines not_found", () => {
    const x = setup();
    const { entryId } = x.roll({}, x.t.p1Actor);
    expect(failOf(() => x.run(SET_ENTRY_HIDDEN, { entryId, hidden: true }, x.t.p1Actor)).code).toBe(
      "forbidden",
    );
    expect(failOf(() => x.hide("nope")).code).toBe("not_found");
    const other: Actor = { ...x.t.dm, campaignId: x.t.secondCampaignId };
    expect(failOf(() => x.run(SET_ENTRY_HIDDEN, { entryId, hidden: true }, other)).code).toBe(
      "not_found",
    );
    expect(x.row(entryId)?.public).toBe(true);
  });

  test("FR-DICE-100 a guarded roll: reveal → conflict; confirmGuarded goes through", () => {
    const x = setup();
    // The Boss token is a renamed Goblin: its rolls are DM-only (FR-DICE-13).
    const { entryId } = x.roll({ actor: { tokenId: x.t.tokenId }, public: true });
    expect(x.row(entryId)?.public).toBe(false);
    const err = failOf(() => x.hide(entryId, false));
    expect(err.code).toBe("conflict");
    expect(err.message).toBe(REVEAL_GUARDED);
    expect(x.row(entryId)?.public).toBe(false);
    x.hide(entryId, false, { confirmGuarded: true });
    expect(x.row(entryId)?.public).toBe(true);
  });
});

describe("FR-DICE-101 a rerolled chain moves together", () => {
  const chain = () => {
    const x = setup();
    const first = x.roll({ actor: { entityId: x.t.miraId } }, x.t.p1Actor);
    const second = x.run<string>("test.rerollLine", {
      entryId: first.entryId,
      rollId: first.rollId,
    });
    return { x, first: first.entryId, second };
  };

  test("FR-DICE-101 hiding the new line hides the old one; revealing the old one reveals both", () => {
    const { x, first, second } = chain();
    x.events.length = 0;
    x.hide(second);
    expect(x.row(first)?.public).toBe(false);
    expect(x.row(second)?.public).toBe(false);
    expect(x.events.map((e) => e.event.payload)).toEqual([
      { entryIds: [first, second], hidden: true },
    ]);
    x.hide(first, false);
    expect(x.row(first)).toMatchObject({ public: true, hiddenFrom: null });
    expect(x.row(second)).toMatchObject({ public: true, hiddenFrom: null });
    expect(x.row(first)?.supersededBy).toBe(second);
  });

  test("FR-DICE-101 a reroll of a hidden line keeps its stamp, so a reveal restores both alike", () => {
    const x = setup();
    const owner = x.run<string>("test.companionLine", { owner: x.t.p1.id });
    x.hide(owner);
    const rollId = (x.row(owner) as { rollIds: string[] }).rollIds[0] as string;
    const next = x.run<string>("test.rerollLine", { entryId: owner, rollId });
    expect(x.row(next)).toMatchObject({
      public: false,
      audiencePlayerId: null,
      hiddenFrom: { public: false, audiencePlayerId: x.t.p1.id },
    });
    x.hide(next, false);
    for (const id of [owner, next]) {
      expect(x.row(id)).toMatchObject({
        public: false,
        audiencePlayerId: x.t.p1.id,
        hiddenFrom: null,
      });
    }
  });
});

describe("FR-DICE-102 the reads on top follow a hide at once", () => {
  test("FR-DICE-102 a session of hidden lines leaves the players session list, and comes back on a reveal; the DM keeps it", () => {
    const x = setup();
    const { entryId } = x.roll({}, x.t.p1Actor);
    const sessions = (actor: Actor) =>
      SessionsResult.parse(x.run(STATS_QUERY_INTENT, { scope: "sessions" }, actor)).sessions.length;
    expect(sessions(x.t.p1Actor)).toBe(1);
    x.hide(entryId);
    expect(sessions(x.t.p1Actor)).toBe(0);
    expect(sessions(x.t.dm)).toBe(1);
    x.hide(entryId, false);
    expect(sessions(x.t.p1Actor)).toBe(1);
  });

  test("FR-DICE-102 session recap: a hidden natural 20 leaves the players' notable rolls at once; the DM's keeps it, marked hidden", () => {
    const x = setup();
    const actor = { entityId: x.t.miraId };
    x.roll({ actor }, x.t.p1Actor);
    const { entryId } = x.roll(
      { actor, expression: "1d20", manual: { diceTotal: 20 } },
      x.t.p1Actor,
    );
    // Each player its own rate window (FR-RECAP-29: at most 2 answers a second per actor).
    const playerRows = (actor: Actor = x.t.p1Actor) =>
      PlayerRecapResult.parse(x.run(RECAP_QUERY_INTENT, {}, actor)).recap?.rolls?.rows ?? [];
    const dmRows = () => DmRecapResult.parse(x.run(RECAP_QUERY_INTENT, {})).recap?.rolls.rows ?? [];
    expect(playerRows().map((r) => r.natural)).toEqual([20]);
    expect(dmRows().map((r) => r.hidden)).toEqual([false]);
    x.hide(entryId);
    expect(playerRows()).toEqual([]);
    expect(dmRows().map((r) => r.hidden)).toEqual([true]);
    x.hide(entryId, false);
    expect(playerRows(x.t.p2Actor).map((r) => r.natural)).toEqual([20]);
  });

  test("FR-DICE-102 gem reroll: a hidden line is not_found for the player, as one they never got", () => {
    const x = setup();
    x.run(setFeature.name, { feature: GEMS_FEATURE, on: true });
    x.run("gem.adjust", { characterId: x.t.miraId, gem: "inspiration", delta: 1 });
    const { entryId } = x.roll({ actor: { entityId: x.t.miraId } }, x.t.p1Actor);
    x.hide(entryId);
    const spend = { characterId: x.t.miraId, gem: "inspiration", entryId };
    expect(failOf(() => x.run(GEM_SPEND_INTENT, spend, x.t.p1Actor)).code).toBe("not_found");
    x.hide(entryId, false);
    x.run(GEM_SPEND_INTENT, spend, x.t.p1Actor);
    expect(x.row(entryId)?.supersededBy).not.toBeNull();
  });
});
