import { describe, expect, test } from "bun:test";
import { defineEvent } from "@shared/events";
import { z } from "zod";
import { campaign } from "../db/schema";
import { openTestDb } from "../db/testing";
import { EventBus } from "../events/bus";
import { readEventLog } from "../events/log";
import type { DispatchedEvent } from "../events/types";
import { silentLogger } from "../log";
import { Commands, defineCommand } from "./commands";
import { fixedClock, realContext, SeedNotAllowedError, seededContext } from "./context";
import { CommandError } from "./errors";

const TestCreated = defineEvent({
  type: "TestCreated",
  payload: z.object({ id: z.string() }),
  logged: true,
  undoable: false,
});
const TestTransient = defineEvent({
  type: "TestTransient",
  payload: z.object({}),
  logged: false,
  undoable: false,
});

const create = defineCommand({
  name: "test.create",
  input: z.object({ name: z.string().min(1), fail: z.boolean().default(false) }),
  roles: ["dm", "player"],
  execute(input, { tx, ctx, emit }) {
    const id = ctx.ids.next();
    const now = ctx.clock.iso();
    tx.insert(campaign).values({ id, name: input.name, createdAt: now, updatedAt: now }).run();
    emit({ type: "TestCreated", campaignId: null, payload: { id }, changes: [] });
    emit({ type: "TestTransient", campaignId: null, payload: {}, changes: [] });
    if (input.fail) throw new Error("injected failure");
    return { id };
  },
});
const dmOnly = defineCommand({ name: "test.dm", input: z.object({}), execute: () => 1 });

function setup() {
  const db = openTestDb();
  const bus = new EventBus(silentLogger);
  const seen: DispatchedEvent[] = [];
  bus.subscribe("record", (e) => seen.push(e));
  const ctx = realContext(fixedClock("2026-02-02T00:00:00Z"));
  const cmds = new Commands(db, bus, () => ctx, silentLogger);
  cmds.register(create);
  cmds.register(dmOnly);
  cmds.registerEvent(TestCreated);
  cmds.registerEvent(TestTransient);
  return { db, bus, seen, cmds };
}

const dm = { role: "dm" as const, playerId: null, campaignId: null };

describe("command layer", () => {
  test("FR-SYNC-16 commits row + log entry, dispatches after commit; non-logged events skip the log", () => {
    const { db, cmds, seen, bus } = setup();
    let rowsAtDispatch = -1;
    bus.subscribe("probe", () => {
      rowsAtDispatch = db.select().from(campaign).all().length;
    });
    const r = cmds.run(create, { name: "A" }, { actor: dm, intentId: "i1" });
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen.map((e) => e.event.type)).toEqual(["TestCreated", "TestTransient"]);
    expect(seen[0]?.meta.intentId).toBe("i1");
    expect(rowsAtDispatch).toBe(1);
    const log = readEventLog(db);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      type: "TestCreated",
      actorRole: "dm",
      intentId: "i1",
      at: "2026-02-02T00:00:00.000Z",
    });
  });

  test("FR-SYNC-16 rollback → no row, no event, no log entry", () => {
    const { db, cmds, seen } = setup();
    expect(() => cmds.run(create, { name: "A", fail: true }, { actor: dm })).toThrow(CommandError);
    expect(db.select().from(campaign).all()).toHaveLength(0);
    expect(readEventLog(db)).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });

  test("FR-SYNC-16 a failing listener never rolls back", () => {
    const { db, cmds, bus, seen } = setup();
    bus.subscribe("boom", () => {
      throw new Error("listener failure");
    });
    cmds.run(create, { name: "A" }, { actor: dm });
    expect(db.select().from(campaign).all()).toHaveLength(1);
    expect(seen).toHaveLength(2);
  });

  test("FR-SYNC-12/13 unknown → unknown_intent, bad input → invalid, role → forbidden", () => {
    const { cmds } = setup();
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return (e as CommandError).code;
      }
      return "ok";
    };
    expect(code(() => cmds.run("nope", {}, { actor: dm }))).toBe("unknown_intent");
    expect(code(() => cmds.run("test.create", { name: "" }, { actor: dm }))).toBe("invalid");
    const player = { role: "player" as const, playerId: "p", campaignId: "c" };
    expect(code(() => cmds.run("test.dm", {}, { actor: player }))).toBe("forbidden");
  });

  test("event log orders by timestamp, then insertion order (ADR-0022)", () => {
    const { db, cmds } = setup();
    for (const name of ["c", "a", "b"]) cmds.run(create, { name }, { actor: dm });
    const ids = db.select().from(campaign).all();
    const log = readEventLog(db);
    expect(log.map((l) => l.seq)).toEqual([1, 2, 3]);
    expect(log.map((l) => (l.payload as { id: string }).id)).toEqual(ids.map((c) => c.id));
  });
});

describe("ID / token / clock seam (ADR-0022)", () => {
  test("seeded context refuses non-disposable data", () => {
    expect(() => seededContext({ disposable: false, key: "x" })).toThrow(SeedNotAllowedError);
  });

  test("seeded values are deterministic per key and have the real format", () => {
    const a = seededContext({ disposable: true, key: "player-1" });
    const b = seededContext({ disposable: true, key: "player-1" });
    const c = seededContext({ disposable: true, key: "player-2" });
    const real = realContext();
    const idA = a.ids.next();
    expect(idA).toBe(b.ids.next());
    expect(idA).not.toBe(c.ids.next());
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(idA).toMatch(uuid);
    expect(real.ids.next()).toMatch(uuid);
    const tok = /^[A-Za-z0-9_-]{22}$/;
    expect(a.tokens.next()).toMatch(tok);
    expect(real.tokens.next()).toMatch(tok);
    // Token draws don't shift the ID stream.
    const d = seededContext({ disposable: true, key: "player-1" });
    d.tokens.next();
    expect(d.ids.next()).toBe(idA);
    expect(a.clock.iso()).toBe("2026-01-01T00:00:00.000Z");
  });
});
