// PARTY §13.1 integration (in-process), S5 P0: `party.presentHandout`, `party.closePresent`, the
// share `present` flag (gainers only, review #23), access loss closing presents (FR-PARTY-35) and
// the `handout-present` record type through the registry (snapshot, filtered changes). The
// FR-PARTY-35 invariant is checked after every command of this suite (`cmd`).
import { describe, expect, test } from "bun:test";
import {
  cantSeeMessage,
  HANDOUT_PRESENT_TYPE,
  type HandoutPresentRecord,
  SHARE_FIRST_MESSAGE,
  type SharedWith,
} from "@shared/party-board/schemas";
import { asc, eq } from "drizzle-orm";
import { armCrashHook } from "../../commands/crash";
import { CommandError } from "../../commands/errors";
import { handoutPresent, notification } from "../../db/schema";
import { readEventLog } from "../../events/log";
import type { Actor, RecordChange } from "../../events/types";
import type { Viewer } from "../../ws/records";
import { createHandout, deleteHandout, PARTY_INTENTS, shareHandout } from "./commands";
import { closePresent, presentHandout } from "./present-commands";
import { type PartySeed, presentInvariantViolations, seedParty } from "./testing";

const NONE: SharedWith = { mode: "none", playerIds: [] };
const ALL: SharedWith = { mode: "all", playerIds: [] };
const only = (...playerIds: string[]): SharedWith => ({ mode: "players", playerIds });

function fail(fn: () => unknown): { code: string; message: string } {
  try {
    fn();
  } catch (e) {
    if (e instanceof CommandError) return { code: e.code, message: e.message };
    throw e;
  }
  return { code: "ok", message: "" };
}

/** Runs a command, then asserts the FR-PARTY-35 invariant (also after a rejected command). */
function cmd(t: PartySeed, name: string, input: unknown, actor: Actor = t.dm): unknown {
  try {
    return t.run(name, input, { actor });
  } finally {
    expect(presentInvariantViolations(t.s.db)).toEqual([]);
  }
}
const newHandout = (t: PartySeed, title = "Ransom Note", sharedWith: SharedWith = NONE) => {
  const { handoutId } = cmd(t, createHandout.name, {
    title,
    body: `${title} body`,
    imageAssetIds: [],
  }) as { handoutId: string };
  if (sharedWith.mode !== "none") share(t, handoutId, sharedWith);
  return handoutId;
};
const share = (t: PartySeed, handoutId: string, sharedWith: SharedWith, present?: boolean) =>
  cmd(t, shareHandout.name, {
    handoutId,
    sharedWith,
    ...(present === undefined ? {} : { present }),
  });
const present = (t: PartySeed, handoutId: string, to: unknown, actor: Actor = t.dm) =>
  (cmd(t, presentHandout.name, { handoutId, to }, actor) as { presentIds: string[] }).presentIds;
const close = (t: PartySeed, input: unknown, actor: Actor = t.dm) =>
  cmd(t, closePresent.name, input, actor);
const toPlayers = (...playerIds: string[]) => ({ mode: "players", playerIds });

const rows = (t: PartySeed): HandoutPresentRecord[] =>
  t.s.db.select().from(handoutPresent).orderBy(asc(handoutPresent.presentedAt)).all();
const byPlayer = (t: PartySeed) =>
  Object.fromEntries(rows(t).map((r) => [r.playerId, r.handoutId]));
/** The present row id of a player (target order follows player creation, ties by id). */
const rowOf = (t: PartySeed, playerId: string) =>
  (rows(t).find((r) => r.playerId === playerId) as HandoutPresentRecord).id;
const types = (t: PartySeed) => t.events.map((e) => e.event.type);
const changesOf = (t: PartySeed, type: string) =>
  (t.events.find((e) => e.event.type === type)?.event.changes ?? []) as RecordChange[];
const ops = (changes: RecordChange[]) =>
  changes.map((c) => `${c.type}:${c.after === null ? "delete" : "upsert"}:${c.id}`);
const wire = (t: PartySeed, changes: RecordChange[], v: Viewer) =>
  t.s.records.filterChanges(changes, v).changes.map((c) => `${c.type}:${c.op}:${c.id}`);
const snapRows = (t: PartySeed, v: Viewer) =>
  (t.snapshot(v)[HANDOUT_PRESENT_TYPE] ?? []) as HandoutPresentRecord[];
const logged = (t: PartySeed) => readEventLog(t.s.db).length;

describe("party.presentHandout (FR-PARTY-31, -32)", () => {
  test("FR-PARTY-32 present to one player: a row for player-1 only; player-2's frames hold no row and no handout id", () => {
    const t = seedParty();
    const h = newHandout(t, "Thieves' Map", only(t.p1.id));
    t.events.length = 0;
    t.clock.advance(1_000);
    const ids = present(t, h, toPlayers(t.p1.id));
    expect(ids).toHaveLength(1);
    expect(rows(t)).toEqual([
      {
        id: ids[0] as string,
        campaignId: t.campaignId,
        handoutId: h,
        playerId: t.p1.id,
        presentedAt: t.clock.iso(),
      },
    ]);
    expect(types(t)).toEqual(["HandoutPresented"]);
    expect(t.events[0]?.event.payload).toEqual({ handoutId: h, playerIds: [t.p1.id] });
    // No notification: the popup is the alert.
    expect(
      t.s.db
        .select()
        .from(notification)
        .all()
        .map((n) => n.kind),
    ).toEqual(["handout-shared"]);
    const changes = changesOf(t, "HandoutPresented");
    const p1 = t.viewer("player", t.p1.id);
    const p2 = t.viewer("player", t.p2.id);
    expect(wire(t, changes, t.viewer("dm"))).toEqual([`${HANDOUT_PRESENT_TYPE}:upsert:${ids[0]}`]);
    expect(wire(t, changes, p1)).toEqual([`${HANDOUT_PRESENT_TYPE}:upsert:${ids[0]}`]);
    expect(wire(t, changes, p2)).toEqual([]);
    expect(snapRows(t, t.viewer("dm")).map((r) => r.id)).toEqual(ids);
    expect(snapRows(t, p1).map((r) => r.id)).toEqual(ids);
    expect(snapRows(t, p2)).toEqual([]);
    const p2Snap = JSON.stringify(t.snapshot(p2));
    for (const s of [h, ids[0] as string]) expect(p2Snap).not.toContain(s);
  });

  test("FR-PARTY-32 present to all: `all` = players who can see it (players-only → player-1; all → every player)", () => {
    const t = seedParty();
    const h2 = newHandout(t, "Thieves' Map", only(t.p1.id));
    const h1 = newHandout(t, "Mayor's Letter", ALL);
    expect(present(t, h2, { mode: "all" })).toHaveLength(1);
    expect(byPlayer(t)).toEqual({ [t.p1.id]: h2 });
    t.events.length = 0;
    expect(present(t, h1, { mode: "all" })).toHaveLength(2);
    expect(byPlayer(t)).toEqual({ [t.p1.id]: h1, [t.p2.id]: h1 });
    const payload = t.events[0]?.event.payload as { playerIds: string[] };
    expect([...payload.playerIds].sort()).toEqual([t.p1.id, t.p2.id].sort());
  });

  test("FR-PARTY-32 refusals: can't see → conflict naming them; unshared → Share it first; unknown player / handout → not_found; player → forbidden; nothing written", () => {
    const t = seedParty();
    const h = newHandout(t, "Thieves' Map", only(t.p1.id));
    const prep = newHandout(t, "Ship Manifest");
    const other = t.run(
      createHandout,
      { title: "Second", body: "", imageAssetIds: [] },
      { actor: t.dmSecond },
    ).handoutId;
    const before = { rows: rows(t), log: logged(t) };
    t.events.length = 0;
    expect(fail(() => present(t, h, toPlayers(t.p1.id, t.p2.id)))).toEqual({
      code: "conflict",
      message: cantSeeMessage("Player 2"),
    });
    for (const to of [{ mode: "all" }, toPlayers(t.p1.id)]) {
      const r = fail(() => present(t, prep, to));
      expect(r.code).toBe("conflict");
    }
    expect(fail(() => present(t, prep, { mode: "all" })).message).toBe(SHARE_FIRST_MESSAGE);
    expect(fail(() => present(t, h, toPlayers(t.secondPlayerId))).code).toBe("not_found");
    expect(fail(() => present(t, other, { mode: "all" })).code).toBe("not_found");
    expect(fail(() => present(t, "nope", { mode: "all" })).code).toBe("not_found");
    expect(fail(() => present(t, h, { mode: "all" }, t.p1Actor)).code).toBe("forbidden");
    expect({ rows: rows(t), log: logged(t) }).toEqual(before);
    expect(t.events).toHaveLength(0);
  });

  test("FR-PARTY-32 a second present replaces the first: one row per player (delete + upsert)", () => {
    const t = seedParty();
    const h1 = newHandout(t, "Mayor's Letter", ALL);
    const h2 = newHandout(t, "Thieves' Map", only(t.p1.id));
    present(t, h1, { mode: "all" });
    const first = rowOf(t, t.p1.id);
    const p2Row = rowOf(t, t.p2.id);
    t.events.length = 0;
    const [second] = present(t, h2, toPlayers(t.p1.id));
    expect(byPlayer(t)).toEqual({ [t.p1.id]: h2, [t.p2.id]: h1 });
    const changes = changesOf(t, "HandoutPresented");
    expect(ops(changes)).toEqual([
      `${HANDOUT_PRESENT_TYPE}:delete:${first}`,
      `${HANDOUT_PRESENT_TYPE}:upsert:${second}`,
    ]);
    expect(wire(t, changes, t.viewer("player", t.p1.id))).toEqual(ops(changes));
    expect(wire(t, changes, t.viewer("player", t.p2.id))).toEqual([]);
    // Re-presenting the same handout also gives a new row (the popup reopens).
    const [third] = present(t, h2, toPlayers(t.p1.id));
    expect(third).not.toBe(second);
    expect(
      rows(t)
        .map((r) => r.id)
        .sort(),
    ).toEqual([p2Row, third as string].sort());
  });

  test("FR-PARTY-31 crash hook party.presentHandout:after-commit → the row is committed and in the next snapshot", () => {
    const t = seedParty();
    const h = newHandout(t, "Thieves' Map", only(t.p1.id));
    armCrashHook({ point: "after-commit", target: PARTY_INTENTS.presentHandout }, (w) => {
      throw new Error(w);
    });
    try {
      expect(() =>
        t.run(presentHandout, { handoutId: h, to: { mode: "all" } }, { actor: t.dm }),
      ).toThrow();
    } finally {
      armCrashHook(null);
    }
    expect(snapRows(t, t.viewer("player", t.p1.id)).map((r) => r.handoutId)).toEqual([h]);
    expect(readEventLog(t.s.db).at(-1)?.type).toBe("HandoutPresented");
  });
});

describe("party.shareHandout present flag (FR-PARTY-33)", () => {
  test("FR-PARTY-33 share and present: one tx, event order; gainers only (player-1 had it and closed it → a row for player-2 only)", () => {
    const t = seedParty();
    const h = newHandout(t, "Thieves' Map", only(t.p1.id));
    const [mine] = present(t, h, toPlayers(t.p1.id));
    close(t, { presentId: mine }, t.p1Actor);
    t.events.length = 0;
    share(t, h, only(t.p1.id, t.p2.id), true);
    expect(types(t)).toEqual(["HandoutShared", "NotificationCreated", "HandoutPresented"]);
    expect(byPlayer(t)).toEqual({ [t.p2.id]: h });
    expect(t.events[2]?.event.payload).toEqual({ handoutId: h, playerIds: [t.p2.id] });
    // All three in the event log, one transaction (same intent).
    expect(
      readEventLog(t.s.db)
        .slice(-3)
        .map((e) => e.type),
    ).toEqual(types(t));
  });

  test("FR-PARTY-33 unchanged share + present → no row, no event; none → all + present → every player, one `all` notification", () => {
    const t = seedParty();
    const h = newHandout(t, "Thieves' Map", only(t.p1.id));
    t.events.length = 0;
    share(t, h, only(t.p1.id), true);
    expect(rows(t)).toEqual([]);
    expect(t.events).toHaveLength(0);
    const g = newHandout(t, "Mayor's Letter");
    t.events.length = 0;
    share(t, g, ALL, true);
    expect(types(t)).toEqual(["HandoutShared", "NotificationCreated", "HandoutPresented"]);
    expect(byPlayer(t)).toEqual({ [t.p1.id]: g, [t.p2.id]: g });
    // present: false (or absent) never presents.
    const k = newHandout(t, "Old Bounty");
    share(t, k, ALL, false);
    expect(byPlayer(t)).toEqual({ [t.p1.id]: g, [t.p2.id]: g });
  });

  test("FR-PARTY-33 `none` + present → invalid; a crash before commit leaves nothing (share, notifications, presents)", () => {
    const t = seedParty();
    const h = newHandout(t, "Thieves' Map");
    expect(fail(() => share(t, h, NONE, true)).code).toBe("invalid");
    const before = {
      rows: rows(t),
      log: logged(t),
      notes: t.s.db.select().from(notification).all(),
    };
    armCrashHook({ point: "before-commit", target: PARTY_INTENTS.shareHandout }, (w) => {
      throw new Error(w);
    });
    try {
      expect(fail(() => share(t, h, ALL, true)).code).toBe("internal");
    } finally {
      armCrashHook(null);
    }
    expect({
      rows: rows(t),
      log: logged(t),
      notes: t.s.db.select().from(notification).all(),
    }).toEqual(before);
  });
});

describe("party.closePresent (FR-PARTY-34)", () => {
  test("FR-PARTY-34 close: own row; another player's → not_found; DM any; DM by handout; player by handout → forbidden; twice → ack, no event", () => {
    const t = seedParty();
    const h = newHandout(t, "Mayor's Letter", ALL);
    present(t, h, { mode: "all" });
    const [p1Row, p2Row] = [rowOf(t, t.p1.id), rowOf(t, t.p2.id)];
    t.events.length = 0;
    expect(fail(() => close(t, { presentId: p2Row }, t.p1Actor)).code).toBe("not_found");
    expect(fail(() => close(t, { handoutId: h }, t.p1Actor)).code).toBe("forbidden");
    expect(t.events).toHaveLength(0);

    close(t, { presentId: p1Row }, t.p1Actor);
    expect(types(t)).toEqual(["HandoutPresentClosed"]);
    expect(t.events[0]?.event.payload).toEqual({
      handoutId: h,
      playerIds: [t.p1.id],
      by: "player",
    });
    const changes = changesOf(t, "HandoutPresentClosed");
    expect(wire(t, changes, t.viewer("player", t.p1.id))).toEqual([
      `${HANDOUT_PRESENT_TYPE}:delete:${p1Row}`,
    ]);
    expect(wire(t, changes, t.viewer("player", t.p2.id))).toEqual([]);
    expect(wire(t, changes, t.viewer("dm"))).toEqual([`${HANDOUT_PRESENT_TYPE}:delete:${p1Row}`]);
    // Second device closing the same row: nothing left → ack, no event.
    t.events.length = 0;
    close(t, { presentId: p1Row }, t.p1Actor);
    expect(t.events).toHaveLength(0);

    // DM closes one row, then every row of a handout.
    const [again] = present(t, h, toPlayers(t.p1.id));
    t.events.length = 0;
    close(t, { presentId: p2Row });
    expect(t.events[0]?.event.payload).toEqual({ handoutId: h, playerIds: [t.p2.id], by: "dm" });
    present(t, h, toPlayers(t.p2.id));
    t.events.length = 0;
    close(t, { handoutId: h });
    expect(rows(t)).toEqual([]);
    expect(t.events[0]?.event.payload).toMatchObject({ handoutId: h, by: "dm" });
    const closed =
      (t.events[0]?.event.payload as { playerIds: string[] } | undefined)?.playerIds ?? [];
    expect([...closed].sort()).toEqual([t.p1.id, t.p2.id].sort());
    expect(ops(changesOf(t, "HandoutPresentClosed"))).toContain(
      `${HANDOUT_PRESENT_TYPE}:delete:${again}`,
    );
    t.events.length = 0;
    close(t, { handoutId: h });
    close(t, { handoutId: "unknown" });
    expect(t.events).toHaveLength(0);
  });

  test("FR-PARTY-34 campaign scope: a DM of another campaign closes nothing", () => {
    const t = seedParty();
    const h = newHandout(t, "Mayor's Letter", ALL);
    const [p1Row] = present(t, h, { mode: "all" });
    t.events.length = 0;
    close(t, { presentId: p1Row }, t.dmSecond);
    close(t, { handoutId: h }, t.dmSecond);
    expect(t.events).toHaveLength(0);
    expect(rows(t)).toHaveLength(2);
  });
});

describe("access loss closes presents (FR-PARTY-35)", () => {
  test("FR-PARTY-35 share losers' rows go with HandoutShared; unshare and delete close the rest; a loser's row for another handout stays", () => {
    const t = seedParty();
    const h = newHandout(t, "Mayor's Letter", ALL);
    present(t, h, { mode: "all" });
    const [p1Row, p2Row] = [rowOf(t, t.p1.id), rowOf(t, t.p2.id)];
    t.events.length = 0;
    share(t, h, only(t.p1.id));
    expect(byPlayer(t)).toEqual({ [t.p1.id]: h });
    const shared = changesOf(t, "HandoutShared");
    expect(ops(shared)).toContain(`${HANDOUT_PRESENT_TYPE}:delete:${p2Row}`);
    expect(wire(t, shared, t.viewer("player", t.p2.id))).toContain(
      `${HANDOUT_PRESENT_TYPE}:delete:${p2Row}`,
    );
    expect(wire(t, shared, t.viewer("player", t.p1.id))).not.toContain(
      `${HANDOUT_PRESENT_TYPE}:delete:${p2Row}`,
    );

    t.events.length = 0;
    share(t, h, NONE);
    expect(rows(t)).toEqual([]);
    expect(ops(changesOf(t, "HandoutShared"))).toContain(`${HANDOUT_PRESENT_TYPE}:delete:${p1Row}`);

    // Delete: every row of the handout; player-2's present of another handout stays.
    const other = newHandout(t, "Thieves' Map", only(t.p2.id));
    share(t, h, ALL);
    present(t, h, toPlayers(t.p1.id));
    present(t, other, toPlayers(t.p2.id));
    t.events.length = 0;
    cmd(t, deleteHandout.name, { handoutId: h });
    expect(byPlayer(t)).toEqual({ [t.p2.id]: other });
    expect(
      ops(changesOf(t, "HandoutDeleted")).filter((c) => c.startsWith(HANDOUT_PRESENT_TYPE)),
    ).toHaveLength(1);
    expect(
      t.s.db.select().from(handoutPresent).where(eq(handoutPresent.handoutId, h)).all(),
    ).toEqual([]);
  });
});
