// CAMP sprint 7 (ADR-0058, in-process): FR-CAMP-38 wire, FR-CAMP-39 `camp.setFeature`, FR-CAMP-44
// the hub's "off" rule (tagged type, tagged log kind, traces) for every read path and viewer,
// FR-DICE-69 tagged kinds and traces, and the crash points of the switch.
import { afterEach, describe, expect, test } from "bun:test";
import { GEMS_FEATURE } from "@shared/campaign-management/features";
import type { CampaignRecord } from "@shared/campaign-management/schemas";
import { GAME_LOG_WINDOW, type GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import { CampaignFeatureSet } from "@shared/events/campaign-management";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { armCrashHook } from "../../commands/crash";
import { CommandError } from "../../commands/errors";
import { stateDigest } from "../../db/digest";
import { campaign, gameLogEntry } from "../../db/schema";
import { readEventLog } from "../../events/log";
import type { Actor, DispatchedEvent, RecordChange } from "../../events/types";
import { defineRecordType, type Viewer } from "../../ws/records";
import { registerLazyProbe } from "../../ws/testing/lazy-probe";
import { diceServices, seedDice } from "../dice-roll-log/testing";
import { adjustGems } from "../gems/commands";
import { featureOn, SET_FEATURE_INTENT, setFeature } from "./features";

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

const TaggedRecord = z.object({ id: z.string(), campaignId: z.string(), text: z.string() });
type TaggedRecord = z.infer<typeof TaggedRecord>;

function setup() {
  const { s } = diceServices("features-test");
  const seed = seedDice(s);
  const events: DispatchedEvent[] = [];
  s.bus.subscribe("test-events", (e) => {
    events.push(e);
  });
  const sw = (on: boolean, actor: Actor = seed.dm, feature = GEMS_FEATURE) =>
    s.commands.run(setFeature, { feature, on }, { actor });
  // A test-registered tagged (non-lazy) record type with one row (FR-CAMP-44).
  const tagged: TaggedRecord = { id: "t1", campaignId: seed.campaignId, text: "TAGGED-ROW" };
  s.records.register(
    defineRecordType<TaggedRecord>({
      type: "tagged-probe",
      scope: "campaign",
      feature: GEMS_FEATURE,
      schema: TaggedRecord,
      idOf: (r) => r.id,
      campaignOf: (r) => r.campaignId,
      visibility: () => "full",
      snapshot: (_src, v) => (v.campaignId === tagged.campaignId ? [tagged] : []),
    }),
  );
  const viewers: [string, Viewer][] = [
    ["DM", seed.viewer("dm")],
    ["P1", seed.viewer("player", seed.p1.id)],
    ["P2", seed.viewer("player", seed.p2.id)],
  ];
  const roll = (actor: Actor = seed.p1Actor) =>
    s.commands.run("dice.roll", { expression: "1d20+3", label: "Perception" }, { actor }) as {
      entryId: string;
    };
  const entries = (v: Viewer) => (seed.snapshot(v)["game-log-entry"] ?? []) as GameLogEntryRecord[];
  return { s, seed, events, sw, viewers, roll, entries };
}

describe("FR-CAMP-38–44 feature switches (in-process)", () => {
  test('FR-CAMP-38 features wire: off → no `features` key; on → `["gems"]`, for every viewer', () => {
    const t = setup();
    const camp = (v: Viewer) => (t.seed.snapshot(v).campaign as CampaignRecord[])[0];
    for (const [, v] of t.viewers) expect(camp(v)).not.toHaveProperty("features");
    t.sw(true);
    for (const [, v] of t.viewers) expect(camp(v)?.features).toEqual(["gems"]);
    t.sw(false);
    for (const [, v] of t.viewers) expect(camp(v)).not.toHaveProperty("features");
  });

  test("FR-CAMP-39 setFeature: DM ✓ (campaign upsert + logged CampaignFeatureSet); player forbidden; unknown invalid; same value no event", () => {
    const t = setup();
    t.events.length = 0;
    expect(t.sw(true)).toEqual({});
    expect(t.events).toHaveLength(1);
    const e = t.events[0]?.event;
    expect(e?.type).toBe(CampaignFeatureSet.type);
    expect(e?.campaignId).toBe(t.seed.campaignId);
    expect(e?.payload).toEqual({ feature: "gems", on: true });
    const change = e?.changes[0] as RecordChange;
    expect(change.type).toBe("campaign");
    expect(change.before).not.toHaveProperty("features");
    expect((change.after as CampaignRecord).features).toEqual(["gems"]);
    expect(
      readEventLog(t.s.db)
        .filter((r) => r.type === CampaignFeatureSet.type)
        .map((r) => r.payload),
    ).toEqual([{ feature: "gems", on: true }]);
    // Same value: no-op, no event, no log row.
    expect(t.sw(true)).toEqual({});
    expect(t.events).toHaveLength(1);
    expect(errOf(() => t.sw(false, t.seed.p1Actor))).toEqual({
      code: "forbidden",
      message: "Not allowed",
    });
    expect(errOf(() => t.sw(true, t.seed.dm, "stats")).code).toBe("invalid");
    expect(
      t.s.db
        .select({ f: campaign.features })
        .from(campaign)
        .where(eq(campaign.id, t.seed.campaignId))
        .get(),
    ).toEqual({ f: ["gems"] });
    expect(featureOn({ tx: t.s.db, actor: t.seed.dm } as never, GEMS_FEATURE)).toBe(true);
    // Per campaign (FR-GEM-40): the second campaign stays off.
    const dmSecond = { ...t.seed.dm, campaignId: t.seed.secondCampaignId };
    expect(featureOn({ tx: t.s.db, actor: dmSecond } as never, GEMS_FEATURE)).toBe(false);
    expect(SET_FEATURE_INTENT).toBe("camp.setFeature");
  });

  test("FR-CAMP-44 off hides tagged: a tagged type and a tagged kind are hidden in snapshot, frames and sync.load for the DM too; on shows them; rows kept", () => {
    const t = setup();
    const lazy = registerLazyProbe(t.s, { type: "tagged-lazy", feature: GEMS_FEATURE });
    t.s.commands.run(lazy.set, { text: "LAZY-ROW", hidden: false }, { actor: t.seed.dm });
    t.sw(true);
    t.s.commands.run(
      adjustGems,
      { characterId: t.seed.miraId, gem: "fortune", delta: 1 },
      { actor: t.seed.dm },
    );
    const award = t.s.db
      .select()
      .from(gameLogEntry)
      .where(eq(gameLogEntry.kind, "gem.award"))
      .get();
    expect(award).toBeDefined();
    const src = { db: t.s.db, presence: { list: () => [] } };
    const check = (on: boolean) => {
      for (const [label, v] of t.viewers) {
        const snap = t.seed.snapshot(v);
        expect([label, "tagged-probe" in snap, "character-gems" in snap]).toEqual([label, on, on]);
        expect([label, t.entries(v).some((e) => e.kind === "gem.award")]).toEqual([label, on]);
        // `sync.load` of a tagged lazy type: rows only while on (the hub answers off as unknown).
        expect([label, t.s.records.load(src, v, "tagged-lazy")["tagged-lazy"]?.length]).toEqual([
          label,
          on ? 1 : undefined,
        ]);
        // Live frames: a change to a tagged record passes only while on.
        const tagged = {
          type: "tagged-probe",
          id: "t1",
          before: null,
          after: { id: "t1", campaignId: t.seed.campaignId, text: "x" },
        };
        const line = {
          type: "game-log-entry",
          id: award?.id as string,
          before: null,
          after: { ...award, dmPayload: null },
        };
        expect([label, t.s.records.filterChange(tagged, v) !== null]).toEqual([label, on]);
        expect([label, t.s.records.filterChange(line, v) !== null]).toEqual([label, on]);
      }
    };
    check(true);
    t.sw(false);
    check(false);
    // Rows stay in the DB (FR-GEM-04).
    expect(lazy.rows.size).toBe(1);
    expect(
      t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.kind, "gem.award")).all(),
    ).toHaveLength(1);
    t.sw(true);
    check(true);
  });

  test("FR-DICE-69 tagged kind off: entries hidden for DM + players; the window is cut before the filter", () => {
    const t = setup();
    t.sw(true);
    for (let i = 0; i < GAME_LOG_WINDOW - 1; i++) t.roll();
    t.s.commands.run(
      adjustGems,
      { characterId: t.seed.miraId, gem: "fortune", delta: 1 },
      { actor: t.seed.dm },
    );
    t.roll();
    // 101 entries; the window holds the newest 100 (the award is one of them).
    for (const [, v] of t.viewers) expect(t.entries(v)).toHaveLength(GAME_LOG_WINDOW);
    t.sw(false);
    for (const [label, v] of t.viewers) {
      const got = t.entries(v);
      expect([label, got.length, got.some((e) => e.kind === "gem.award")]).toEqual([
        label,
        GAME_LOG_WINDOW - 1,
        false,
      ]);
      // The cut ids still include the award (same floor for every viewer, ADR-0029).
      expect(
        t.s.records.windowIds({ db: t.s.db, presence: { list: () => [] } }, v)["game-log-entry"],
      ).toHaveLength(GAME_LOG_WINDOW);
    }
  });

  test("FR-DICE-69 traces off / FR-GEM-05 off hides gem traces: superseded entries hidden, `replaces` stripped for DM + players; on restores", () => {
    const t = setup();
    t.sw(true);
    const old = t.roll().entryId;
    const next = t.roll().entryId;
    const nextRow = t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, next)).get();
    // What a GM1 reroll leaves (written directly: no reroll command in GM0).
    const replaced = ((nextRow?.payload ?? []) as Record<string, unknown>[]).map((i) => ({
      ...i,
      replaces: { entryId: old, total: 4 },
    }));
    t.s.db.update(gameLogEntry).set({ supersededBy: next }).where(eq(gameLogEntry.id, old)).run();
    t.s.db.update(gameLogEntry).set({ payload: replaced }).where(eq(gameLogEntry.id, next)).run();
    const view = (v: Viewer) => {
      const got = t.entries(v);
      return {
        old: got.some((e) => e.id === old),
        replaces: JSON.stringify(got.find((e) => e.id === next)?.payload).includes("replaces"),
      };
    };
    for (const [label, v] of t.viewers) {
      expect([label, view(v)]).toEqual([label, { old: true, replaces: true }]);
    }
    t.sw(false);
    for (const [label, v] of t.viewers) {
      expect([label, view(v)]).toEqual([label, { old: false, replaces: false }]);
      // A live change to the superseded entry reaches nobody while off.
      const row = t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, old)).get();
      const c = {
        type: "game-log-entry",
        id: old,
        before: null,
        after: { ...row, dmPayload: null },
      };
      expect([label, t.s.records.filterChange(c, v)]).toEqual([label, null]);
    }
    t.sw(true);
    for (const [label, v] of t.viewers) {
      expect([label, view(v)]).toEqual([label, { old: true, replaces: true }]);
    }
  });

  test("FR-CAMP-39 crash: camp.setFeature before-commit → still off (digest equal); after-commit → on, one log row", () => {
    const t = setup();
    class Killed extends Error {}
    const kill = () => {
      throw new Killed();
    };
    const before = stateDigest(t.s.db.$client).sha256;
    armCrashHook({ point: "before-commit", target: SET_FEATURE_INTENT }, kill);
    expect(() => t.sw(true)).toThrow();
    armCrashHook(null);
    expect(stateDigest(t.s.db.$client).sha256).toBe(before);
    armCrashHook({ point: "after-commit", target: SET_FEATURE_INTENT }, kill);
    expect(() => t.sw(true)).toThrow(Killed);
    armCrashHook(null);
    expect(featureOn({ tx: t.s.db, actor: t.seed.dm } as never, GEMS_FEATURE)).toBe(true);
    expect(readEventLog(t.s.db).filter((r) => r.type === CampaignFeatureSet.type)).toHaveLength(1);
  });
});
