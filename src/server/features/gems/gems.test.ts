// GEM integration tests (GM0, in-process): the switch gate, `gem.adjust`, the plain `gem.spend`,
// visibility per viewer, owner check, races, owner change, campaign isolation, crash.
import { afterEach, describe, expect, test } from "bun:test";
import { GEMS_FEATURE } from "@shared/campaign-management/features";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";
import type { GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import { GemSpent, GemsAdjusted } from "@shared/events/gems";
import { CHARACTER_GEMS_TYPE, type CharacterGemsRecord } from "@shared/gems/schemas";
import { eq } from "drizzle-orm";
import { armCrashHook } from "../../commands/crash";
import { CommandError } from "../../commands/errors";
import { stateDigest } from "../../db/digest";
import { characterGems, gameLogEntry } from "../../db/schema";
import { readEventLog } from "../../events/log";
import type { Actor, DispatchedEvent } from "../../events/types";
import { setFeature } from "../campaign-management/features";
import { diceServices, seedDice } from "../dice-roll-log/testing";
import { miraBlock } from "../entities/testing";
import { adjustGems, GEMS_OFF, spendGem } from "./commands";

afterEach(() => armCrashHook(null));

function errOf(f: () => unknown): { code: string; message: string } {
  try {
    f();
  } catch (e) {
    if (e instanceof CommandError) return { code: e.code, message: e.message };
    throw e;
  }
  throw new Error("expected a CommandError");
}

function setup(on = true) {
  const { s } = diceServices("gems-test");
  const seed = seedDice(s);
  const events: DispatchedEvent[] = [];
  s.bus.subscribe("test-events", (e) => {
    events.push(e);
  });
  const run = <I>(cmd: { name: string }, input: I, actor: Actor) =>
    s.commands.run(cmd.name, input, { actor });
  const sw = (value: boolean, actor: Actor = seed.dm) =>
    run(setFeature, { feature: GEMS_FEATURE, on: value }, actor);
  if (on) sw(true);
  const adjust = (characterId: string, gem: string, delta: number, actor: Actor = seed.dm) =>
    run(adjustGems, { characterId, gem, delta }, actor) as { held: number };
  const spend = (input: Record<string, unknown>, actor: Actor = seed.p1Actor) =>
    run(spendGem, input, actor) as { held: number; entryId: string };
  const rows = () => s.db.select().from(characterGems).all();
  const entries = (kind?: string) =>
    s.db
      .select()
      .from(gameLogEntry)
      .all()
      .filter((e) => kind === undefined || e.kind === kind);
  const gemsOf = (role: "dm" | "player", playerId: string | null = null, cid?: string) =>
    (seed.snapshot(seed.viewer(role, playerId, cid))[CHARACTER_GEMS_TYPE] ?? null) as
      | CharacterGemsRecord[]
      | null;
  return { s, seed, events, sw, adjust, spend, rows, entries, gemsOf };
}

describe("gems core (GEM §6, GM0)", () => {
  test("FR-GEM-03 off refuses: every gem.* intent → forbidden, nothing written", () => {
    const t = setup(false);
    const logBefore = readEventLog(t.s.db).length;
    expect(errOf(() => t.adjust(t.seed.miraId, "fortune", 1))).toEqual({
      code: "forbidden",
      message: GEMS_OFF,
    });
    expect(errOf(() => t.spend({ characterId: t.seed.miraId, gem: "fortune" }))).toEqual({
      code: "forbidden",
      message: GEMS_OFF,
    });
    expect(
      errOf(() => t.spend({ characterId: t.seed.miraId, gem: "fortune" }, t.seed.dm)).code,
    ).toBe("forbidden");
    expect(t.rows()).toEqual([]);
    expect(t.entries()).toEqual([]);
    expect(readEventLog(t.s.db)).toHaveLength(logBefore);
    expect(t.events).toEqual([]);
  });

  test("FR-GEM-07 adjust: DM only; row on first award, others 0; −5…+5; 0–99; unknown / other campaign → not_found", () => {
    const t = setup();
    expect(t.adjust(t.seed.miraId, "inspiration", 2)).toEqual({ held: 2 });
    expect(t.rows()).toEqual([
      expect.objectContaining({
        id: t.seed.miraId,
        campaignId: t.seed.campaignId,
        inspiration: 2,
        fortune: 0,
        combat: 0,
        divine: 0,
        action: 0,
      }),
    ]);
    expect(t.adjust(t.seed.miraId, "inspiration", -1)).toEqual({ held: 1 });
    expect(errOf(() => t.adjust(t.seed.miraId, "inspiration", -2))).toEqual({
      code: "invalid",
      message: "Mira has no Inspiration gem to remove",
    });
    expect(errOf(() => t.adjust(t.seed.miraId, "fortune", 0)).code).toBe("invalid");
    // FR-GEM-43: ±10 since sprint 9.
    expect(errOf(() => t.adjust(t.seed.miraId, "fortune", 11)).code).toBe("invalid");
    expect(errOf(() => t.adjust(t.seed.miraId, "fortune", -11)).code).toBe("invalid");
    for (let i = 0; i < 19; i++) t.adjust(t.seed.miraId, "fortune", 5);
    expect(t.adjust(t.seed.miraId, "fortune", 4)).toEqual({ held: 99 });
    expect(errOf(() => t.adjust(t.seed.miraId, "fortune", 1))).toEqual({
      code: "invalid",
      message: "At most 99 Fortune gems",
    });
    expect(errOf(() => t.adjust("nope", "fortune", 1)).code).toBe("not_found");
    expect(errOf(() => t.adjust(t.seed.strangerId, "fortune", 1)).code).toBe("not_found");
    expect(errOf(() => t.adjust(t.seed.goblinId, "fortune", 1)).code).toBe("not_found");
    expect(errOf(() => t.adjust(t.seed.miraId, "fortune", -1, t.seed.p1Actor)).code).toBe(
      "forbidden",
    );
    // One row per character (FR-GEM-06), whatever the number of writes.
    expect(t.rows()).toHaveLength(1);
  });

  test('FR-GEM-43 quick awards make one line: delta 10 accepted, 11 → invalid; one line "6 Fortune gems"', () => {
    const t = setup();
    expect(t.adjust(t.seed.miraId, "fortune", 10)).toEqual({ held: 10 });
    expect(errOf(() => t.adjust(t.seed.miraId, "fortune", 11)).code).toBe("invalid");
    expect(t.adjust(t.seed.miraId, "fortune", -10)).toEqual({ held: 0 });
    t.adjust(t.seed.miraId, "fortune", 6);
    const lines = t.entries("gem.award");
    expect(lines.map((l) => (l.payload as { count: number }).count)).toEqual([10, 6]);
    const last = lines.at(-1) as GameLogEntryRecord;
    expect(lineText(formatEntry(last).segments)).toBe("DM awards Mira 6 Fortune gems (6 held)");
  });

  test("FR-GEM-09 award public, removal silent: one public gem.award line per award; GemsAdjusted carries row + line", () => {
    const t = setup();
    t.events.length = 0;
    t.adjust(t.seed.miraId, "inspiration", 2);
    t.adjust(t.seed.miraId, "inspiration", -1);
    const lines = t.entries("gem.award");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      public: true,
      category: "other",
      rollerRole: "dm",
      actorName: "Mira",
      payload: { characterId: t.seed.miraId, gem: "inspiration", count: 2, held: 2 },
      rollIds: [],
    });
    const [award, removal] = t.events.map((e) => e.event);
    expect(award?.type).toBe(GemsAdjusted.type);
    expect(award?.payload).toEqual({
      characterId: t.seed.miraId,
      gem: "inspiration",
      delta: 2,
      held: 2,
      entryId: lines[0]?.id,
    });
    expect(award?.changes.map((c) => c.type)).toEqual([CHARACTER_GEMS_TYPE, "game-log-entry"]);
    expect(removal?.payload).toEqual({
      characterId: t.seed.miraId,
      gem: "inspiration",
      delta: -1,
      held: 1,
    });
    expect(removal?.changes.map((c) => c.type)).toEqual([CHARACTER_GEMS_TYPE]);
    // Logged, not undoable.
    expect(
      readEventLog(t.s.db)
        .filter((r) => r.type === GemsAdjusted.type)
        .map((r) => r.payload),
    ).toHaveLength(2);
  });

  test("FR-GEM-10 visibility: DM and every player get every row whole (counts only, OQ-GEM-01 A)", () => {
    const t = setup();
    t.adjust(t.seed.miraId, "inspiration", 1);
    t.adjust(t.seed.thornId, "action", 3);
    const dm = t.gemsOf("dm");
    expect(dm).toHaveLength(2);
    expect(t.gemsOf("player", t.seed.p1.id)).toEqual(dm);
    expect(t.gemsOf("player", t.seed.p2.id)).toEqual(dm);
    expect(Object.keys(dm?.[0] ?? {}).sort()).toEqual(
      [
        "id",
        "campaignId",
        "characterId",
        "inspiration",
        "fortune",
        "combat",
        "divine",
        "action",
      ].sort(),
    );
  });

  test("FR-GEM-12 spend each kind: count − cost, one public gem.spend line, GemSpent; too few → conflict", () => {
    const t = setup();
    for (const [gem, n] of [
      ["fortune", 1],
      ["divine", 1],
      ["action", 4],
      ["inspiration", 1],
    ] as const)
      t.adjust(t.seed.miraId, gem, n);
    t.events.length = 0;
    expect(t.spend({ characterId: t.seed.miraId, gem: "fortune" }).held).toBe(0);
    expect(t.spend({ characterId: t.seed.miraId, gem: "divine" }).held).toBe(0);
    expect(t.spend({ characterId: t.seed.miraId, gem: "action", use: "bonus" }).held).toBe(3);
    expect(t.spend({ characterId: t.seed.miraId, gem: "action", use: "reaction" }).held).toBe(2);
    const full = t.spend({ characterId: t.seed.miraId, gem: "action", use: "action" });
    expect(full.held).toBe(0);
    expect(t.spend({ characterId: t.seed.miraId, gem: "inspiration" }).held).toBe(0);
    const lines = t.entries("gem.spend");
    expect(lines.map((e) => e.payload)).toEqual([
      { characterId: t.seed.miraId, gem: "fortune", count: 1 },
      { characterId: t.seed.miraId, gem: "divine", count: 1 },
      { characterId: t.seed.miraId, gem: "action", count: 1, use: "bonus" },
      { characterId: t.seed.miraId, gem: "action", count: 1, use: "reaction" },
      { characterId: t.seed.miraId, gem: "action", count: 2, use: "action" },
      { characterId: t.seed.miraId, gem: "inspiration", count: 1 },
    ]);
    expect(lines.every((e) => e.public && e.actorName === "Mira")).toBe(true);
    const spent = t.events.map((e) => e.event);
    expect(spent.map((e) => e.type)).toEqual(Array(6).fill(GemSpent.type));
    expect(spent[4]?.payload).toEqual({
      characterId: t.seed.miraId,
      gem: "action",
      cost: 2,
      held: 0,
      entryId: full.entryId,
      rollIds: [],
    });
    expect(spent[4]?.changes.map((c) => c.type)).toEqual([CHARACTER_GEMS_TYPE, "game-log-entry"]);
    expect(errOf(() => t.spend({ characterId: t.seed.miraId, gem: "fortune" }))).toEqual({
      code: "conflict",
      message: "No Fortune gem left",
    });
    // No row yet (Thorn): also "none left".
    expect(
      errOf(() => t.spend({ characterId: t.seed.thornId, gem: "fortune" }, t.seed.p2Actor)),
    ).toEqual({ code: "conflict", message: "No Fortune gem left" });
  });

  test("FR-GEM-16 action costs 2: Action (2) with 1 held → conflict, nothing written", () => {
    const t = setup();
    t.adjust(t.seed.miraId, "action", 1);
    const before = t.entries().length;
    expect(
      errOf(() => t.spend({ characterId: t.seed.miraId, gem: "action", use: "action" })),
    ).toEqual({ code: "conflict", message: "2 Action gems needed, 1 left" });
    expect(t.rows()[0]?.action).toBe(1);
    expect(t.entries()).toHaveLength(before);
    expect(t.spend({ characterId: t.seed.miraId, gem: "action", use: "bonus" }).held).toBe(0);
  });

  test("FR-GEM-11 owner check: a player spends only their own character's gems (entity owner); the DM any", () => {
    const t = setup();
    t.adjust(t.seed.miraId, "fortune", 3);
    expect(
      errOf(() => t.spend({ characterId: t.seed.miraId, gem: "fortune" }, t.seed.p2Actor)),
    ).toEqual({ code: "forbidden", message: "Not your character" });
    expect(t.spend({ characterId: t.seed.miraId, gem: "fortune" }).held).toBe(2);
    expect(t.spend({ characterId: t.seed.miraId, gem: "fortune" }, t.seed.dm).held).toBe(1);
    expect(
      errOf(() => t.spend({ characterId: t.seed.strangerId, gem: "fortune" }, t.seed.p1Actor)).code,
    ).toBe("not_found");
    // No owner copy on the row (FR-GEM-11).
    expect(Object.keys(t.rows()[0] ?? {})).not.toContain("ownerPlayerId");
  });

  test("FR-GEM-13 lines public whoever sends; roller = sender (DM default: hidden categories)", () => {
    const t = setup();
    t.adjust(t.seed.miraId, "fortune", 2);
    t.spend({ characterId: t.seed.miraId, gem: "fortune" });
    t.spend({ characterId: t.seed.miraId, gem: "fortune" }, t.seed.dm);
    const [byPlayer, byDm] = t.entries("gem.spend");
    expect(byPlayer).toMatchObject({
      public: true,
      rollerRole: "player",
      rollerPlayerId: t.seed.p1.id,
    });
    expect(byDm).toMatchObject({ public: true, rollerRole: "dm", rollerPlayerId: null });
    // Every player receives both lines (redacted = no dmPayload).
    const p2 = (t.seed.snapshot(t.seed.viewer("player", t.seed.p2.id))["game-log-entry"] ??
      []) as GameLogEntryRecord[];
    expect(p2.filter((e) => e.kind === "gem.spend")).toHaveLength(2);
  });

  test("FR-GEM-37 races: spend vs switch-off — the first commit wins", () => {
    const t = setup();
    t.adjust(t.seed.miraId, "fortune", 2);
    expect(t.spend({ characterId: t.seed.miraId, gem: "fortune" }).held).toBe(1);
    t.sw(false);
    expect(errOf(() => t.spend({ characterId: t.seed.miraId, gem: "fortune" })).code).toBe(
      "forbidden",
    );
    expect(t.rows()[0]?.fortune).toBe(1);
    expect(t.entries("gem.spend")).toHaveLength(1);
  });

  test("FR-GEM-39 owner change: the gems stay with the character; the new owner spends, the old one can't", () => {
    const t = setup();
    t.adjust(t.seed.miraId, "fortune", 2);
    t.s.commands.run(
      "entities.update",
      { id: t.seed.miraId, name: "Mira", statBlock: miraBlock, ownerPlayerId: t.seed.p2.id },
      { actor: t.seed.dm },
    );
    expect(t.rows()[0]?.fortune).toBe(2);
    expect(errOf(() => t.spend({ characterId: t.seed.miraId, gem: "fortune" })).code).toBe(
      "forbidden",
    );
    expect(t.spend({ characterId: t.seed.miraId, gem: "fortune" }, t.seed.p2Actor).held).toBe(1);
  });

  test("FR-GEM-40 campaign isolation: rows and switch per campaign; never in another campaign's snapshot", () => {
    const t = setup();
    t.adjust(t.seed.miraId, "fortune", 2);
    const dmSecond: Actor = { ...t.seed.dm, campaignId: t.seed.secondCampaignId };
    // Gems are off in the second campaign: its DM can't award there.
    expect(errOf(() => t.adjust(t.seed.strangerId, "fortune", 1, dmSecond)).code).toBe("forbidden");
    t.sw(true, dmSecond);
    expect(t.adjust(t.seed.strangerId, "fortune", 1, dmSecond).held).toBe(1);
    // Mira isn't a character of the second campaign.
    expect(errOf(() => t.adjust(t.seed.miraId, "fortune", 1, dmSecond)).code).toBe("not_found");
    const second = t.gemsOf("dm", null, t.seed.secondCampaignId);
    expect(second?.map((r) => r.id)).toEqual([t.seed.strangerId]);
    expect(t.gemsOf("dm")?.map((r) => r.id)).toEqual([t.seed.miraId]);
    // Off in the first campaign leaves the second one on.
    t.sw(false);
    expect(t.gemsOf("dm")).toBeNull();
    expect(t.gemsOf("dm", null, t.seed.secondCampaignId)).toHaveLength(1);
  });

  test("GEM §11 crash: gem.spend before-commit → nothing (digest equal); after-commit → spent once", () => {
    const t = setup();
    t.adjust(t.seed.miraId, "fortune", 2);
    class Killed extends Error {}
    const kill = () => {
      throw new Killed();
    };
    const before = stateDigest(t.s.db.$client).sha256;
    armCrashHook({ point: "before-commit", target: spendGem.name }, kill);
    expect(() => t.spend({ characterId: t.seed.miraId, gem: "fortune" })).toThrow();
    armCrashHook(null);
    expect(stateDigest(t.s.db.$client).sha256).toBe(before);
    armCrashHook({ point: "after-commit", target: spendGem.name }, kill);
    expect(() => t.spend({ characterId: t.seed.miraId, gem: "fortune" })).toThrow(Killed);
    armCrashHook(null);
    expect(t.rows()[0]?.fortune).toBe(1);
    expect(t.entries("gem.spend")).toHaveLength(1);
    expect(readEventLog(t.s.db).filter((r) => r.type === GemSpent.type)).toHaveLength(1);
    expect(
      t.s.db.select().from(characterGems).where(eq(characterGems.id, t.seed.miraId)).get()?.fortune,
    ).toBe(1);
  });
});
