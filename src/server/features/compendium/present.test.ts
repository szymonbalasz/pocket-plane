// CMP §13 integration (in-process), entry present (FR-CMP-78–82; DM #457): `cmp.presentEntry`,
// `cmp.closeEntryPresent`, unshare / delete closing rows, the `entry-present` record through the
// registry (snapshot, filtered changes) and the crash hook.
import { describe, expect, test } from "bun:test";
import {
  ENTRY_PRESENT_INTENTS,
  ENTRY_PRESENT_TYPE,
  type EntryPresentRecord,
  MONSTER_NOT_SHOWN,
  SHARE_ENTRY_FIRST,
} from "@shared/compendium/present";
import { asc, eq } from "drizzle-orm";
import { SRD_MINI_VERSION, srdMini } from "../../../../fixtures/srd/open5e";
import { armCrashHook } from "../../commands/crash";
import { CommandError } from "../../commands/errors";
import { compendiumEntry, entryPresent } from "../../db/schema";
import { readEventLog } from "../../events/log";
import type { Actor, RecordChange } from "../../events/types";
import { seedParty } from "../party-board/testing";
import { DELETE_ENTRY, PUT_ENTRY } from "./homebrew";
import { IMPORT_RECORDED } from "./import";
import { SRD_51_SOURCE } from "./sources/srd-5.1/source";

type Seed = ReturnType<typeof setup>;

function setup() {
  const t = seedParty();
  t.run(
    IMPORT_RECORDED,
    { source: { ...SRD_51_SOURCE }, version: SRD_MINI_VERSION, responses: srdMini },
    { actor: t.dm },
  );
  const imported = (name: string) =>
    t.s.db
      .select({ id: compendiumEntry.id })
      .from(compendiumEntry)
      .where(eq(compendiumEntry.name, name))
      .get()?.id as string;
  return { ...t, potion: imported("Potion of Healing"), goblin: imported("Goblin") };
}

const item = (name: string) => ({
  kind: "item" as const,
  name,
  facets: { category: "magic" as const, rarity: "rare" as const, attunement: false },
  body: { typeLine: "Wondrous item", text: `${name} text` },
});
const put = (t: Seed, name: string, shared: boolean, id?: string) =>
  (
    t.run(PUT_ENTRY, { ...(id ? { id } : {}), entry: item(name), shared }, { actor: t.dm }) as {
      entryId: string;
    }
  ).entryId;

function fail(fn: () => unknown): { code: string; message: string } {
  try {
    fn();
  } catch (e) {
    if (e instanceof CommandError) return { code: e.code, message: e.message };
    throw e;
  }
  return { code: "ok", message: "" };
}

const present = (t: Seed, entryId: string, actor: Actor = t.dm) =>
  (t.run(ENTRY_PRESENT_INTENTS.present, { entryId }, { actor }) as { presentIds: string[] })
    .presentIds;
const close = (t: Seed, presentId: string, actor: Actor = t.dm) =>
  t.run(ENTRY_PRESENT_INTENTS.close, { presentId }, { actor });
const rows = (t: Seed): EntryPresentRecord[] =>
  t.s.db.select().from(entryPresent).orderBy(asc(entryPresent.presentedAt)).all();
const byPlayer = (t: Seed) => Object.fromEntries(rows(t).map((r) => [r.playerId, r.entryId]));
const rowOf = (t: Seed, playerId: string) =>
  (rows(t).find((r) => r.playerId === playerId) as EntryPresentRecord).id;
const lastChanges = (t: Seed, type: string) =>
  (t.events.findLast((e) => e.event.type === type)?.event.changes ?? []) as RecordChange[];
const snap = (t: Seed, v: ReturnType<Seed["viewer"]>) =>
  (t.snapshot(v)[ENTRY_PRESENT_TYPE] ?? []) as EntryPresentRecord[];

describe("FR-CMP-79 cmp.presentEntry", () => {
  test("FR-CMP-79 an imported item opens for every player of the campaign, never the other campaign's", () => {
    const t = setup();
    const ids = present(t, t.potion);
    expect(ids).toHaveLength(2);
    expect(byPlayer(t)).toEqual({ [t.p1.id]: t.potion, [t.p2.id]: t.potion });
    expect(rows(t).some((r) => r.playerId === t.secondPlayerId)).toBe(false);
    const log = readEventLog(t.s.db).filter((e) => e.type === "EntryPresented");
    expect(log).toHaveLength(1);
  });

  test("FR-CMP-79 a shared homebrew item opens; an unshared one → conflict, nothing written", () => {
    const t = setup();
    const secret = put(t, "Saddlebag Secret", false);
    expect(fail(() => present(t, secret))).toEqual({
      code: "conflict",
      message: SHARE_ENTRY_FIRST,
    });
    expect(rows(t)).toEqual([]);
    const open = put(t, "Saddlebag Lantern", true);
    present(t, open);
    expect(byPlayer(t)).toEqual({ [t.p1.id]: open, [t.p2.id]: open });
  });

  test("FR-CMP-79 monster → invalid; unknown id or another campaign's homebrew → not_found; a player → forbidden", () => {
    const t = setup();
    expect(fail(() => present(t, t.goblin))).toEqual({
      code: "invalid",
      message: MONSTER_NOT_SHOWN,
    });
    expect(fail(() => present(t, "nope")).code).toBe("not_found");
    const other = (
      t.run(PUT_ENTRY, { entry: item("Elsewhere Bag"), shared: true }, { actor: t.dmSecond }) as {
        entryId: string;
      }
    ).entryId;
    expect(fail(() => present(t, other)).code).toBe("not_found");
    expect(fail(() => present(t, t.potion, t.p1Actor)).code).toBe("forbidden");
    expect(rows(t)).toEqual([]);
  });

  test("FR-CMP-79 a new present replaces each player's open one (one row per player)", () => {
    const t = setup();
    const a = put(t, "Bag A", true);
    present(t, a);
    const firstP1 = rowOf(t, t.p1.id);
    present(t, t.potion);
    expect(rows(t)).toHaveLength(2);
    expect(byPlayer(t)).toEqual({ [t.p1.id]: t.potion, [t.p2.id]: t.potion });
    const ops = lastChanges(t, "EntryPresented").map((c) => (c.after === null ? "del" : "up"));
    expect(ops).toEqual(["del", "up", "del", "up"]);
    expect(rowOf(t, t.p1.id)).not.toBe(firstP1);
  });
});

describe("FR-CMP-78 record entry-present", () => {
  test("FR-CMP-78 snapshot: DM every row, each player only their own, other campaign none", () => {
    const t = setup();
    present(t, t.potion);
    expect(snap(t, t.viewer("dm"))).toHaveLength(2);
    expect(snap(t, t.viewer("player", t.p1.id)).map((r) => r.playerId)).toEqual([t.p1.id]);
    expect(snap(t, t.viewer("player", t.p2.id)).map((r) => r.playerId)).toEqual([t.p2.id]);
    expect(snap(t, t.viewer("player", t.secondPlayerId, t.secondCampaignId as string))).toEqual([]);
  });

  test("FR-CMP-78 changes: a player receives only their own row's upsert", () => {
    const t = setup();
    present(t, t.potion);
    const changes = lastChanges(t, "EntryPresented");
    const wire = (v: ReturnType<Seed["viewer"]>) =>
      t.s.records.filterChanges(changes, v).changes.map((c) => c.id);
    expect(wire(t.viewer("dm"))).toHaveLength(2);
    expect(wire(t.viewer("player", t.p1.id))).toEqual([rowOf(t, t.p1.id)]);
  });
});

describe("FR-CMP-81 cmp.closeEntryPresent", () => {
  test("FR-CMP-81 a player closes their own row; another's → not_found; again → ack, no event", () => {
    const t = setup();
    present(t, t.potion);
    const mine = rowOf(t, t.p1.id);
    const theirs = rowOf(t, t.p2.id);
    expect(fail(() => close(t, theirs, t.p1Actor)).code).toBe("not_found");
    close(t, mine, t.p1Actor);
    expect(Object.keys(byPlayer(t))).toEqual([t.p2.id]);
    const ev = t.events.findLast((e) => e.event.type === "EntryPresentClosed");
    expect(ev?.event.payload).toEqual({ entryId: t.potion, playerIds: [t.p1.id], by: "player" });
    const n = t.events.length;
    close(t, mine, t.p1Actor);
    expect(t.events.length).toBe(n);
  });

  test("FR-CMP-81 the DM closes any row of the campaign", () => {
    const t = setup();
    present(t, t.potion);
    close(t, rowOf(t, t.p2.id));
    expect(Object.keys(byPlayer(t))).toEqual([t.p1.id]);
  });
});

describe("FR-CMP-82 access loss closes rows", () => {
  test("FR-CMP-82 unsharing a homebrew entry deletes its rows inside CompendiumEntrySaved", () => {
    const t = setup();
    const id = put(t, "Bag B", true);
    present(t, id);
    put(t, "Bag B", true, id); // still shared: rows stay
    expect(rows(t)).toHaveLength(2);
    put(t, "Bag B", false, id);
    expect(rows(t)).toEqual([]);
    const changes = lastChanges(t, "CompendiumEntrySaved");
    expect(changes.map((c) => [c.type, c.after])).toEqual([
      [ENTRY_PRESENT_TYPE, null],
      [ENTRY_PRESENT_TYPE, null],
    ]);
  });

  test("FR-CMP-82 deleting a homebrew entry deletes its rows inside CompendiumEntryDeleted", () => {
    const t = setup();
    const id = put(t, "Bag C", true);
    present(t, id);
    t.run(DELETE_ENTRY, { id }, { actor: t.dm });
    expect(rows(t)).toEqual([]);
    expect(lastChanges(t, "CompendiumEntryDeleted")).toHaveLength(2);
  });
});

test("FR-CMP-83 crash hook cmp.presentEntry:before-commit → no row, no log row", () => {
  const t = setup();
  armCrashHook({ point: "before-commit", target: ENTRY_PRESENT_INTENTS.present }, (w) => {
    throw new Error(w);
  });
  try {
    expect(() => present(t, t.potion)).toThrow();
  } finally {
    armCrashHook(null);
  }
  expect(rows(t)).toEqual([]);
  expect(readEventLog(t.s.db).filter((e) => e.type === "EntryPresented")).toHaveLength(0);
});
