// CHAR §13 integration over real sockets on the `character-sheet` bundle: live HP and rolls,
// visibility (FR-CHAR-14, FR-CHAR-17), leak scan, convergence, restart.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { entity, player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";

const DM = { role: "dm" as const, secret: TEST_SECRET };
const SHEET_KEYS = ["hpCurrent", "statBlock", "hpMax", "ac", "initBonus", "attacks"];

async function nextEvent(c: TestClient, cause: string) {
  for (;;) {
    const e = await c.next("event", 1000);
    if (e.cause.name === cause) return e;
  }
}
const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};

/** Every object with `id === targetId` in any frame `c` received that carries sheet data. */
function sheetLeaks(c: TestClient, targetId: string): string[] {
  const out: string[] = [];
  const walk = (v: unknown, holderId: string | null): void => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x, holderId);
      return;
    }
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : holderId;
    if (id === targetId && o.type !== GAME_LOG_ENTRY_TYPE) {
      for (const k of SHEET_KEYS) if (k in o) out.push(k);
    }
    for (const [k, x] of Object.entries(o)) {
      // Roll lines are public by #73: game-log entries are excluded.
      if (k === GAME_LOG_ENTRY_TYPE) continue;
      walk(x, id);
    }
  };
  for (const f of c.frames) walk(f, null);
  return out;
}

const entriesOf = (c: TestClient) =>
  (Object.values(c.store.records[GAME_LOG_ENTRY_TYPE] ?? {}) as GameLogEntryRecord[]).sort(
    (a, b) => a.n - b.n,
  );
const ent = (c: TestClient, id: string) =>
  c.store.records[ENTITY_TYPE]?.[id] as Record<string, unknown> | undefined;

describe("character-sheet bundle over WS", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let tokens: Record<string, string>;
  let ids: Record<string, string>;
  const p = (name: string) => ({ role: "player" as const, token: tokens[name] as string });

  beforeAll(async () => {
    const loaded = await loadBundle("character-sheet", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    tokens = Object.fromEntries(
      db
        .select({ name: player.name, token: player.linkToken })
        .from(player)
        .all()
        .map((r) => [r.name, r.token]),
    );
    ids = Object.fromEntries(
      db
        .select()
        .from(entity)
        .all()
        .map((e) => [e.name, e.id]),
    );
    h = await startTestServer({ db, fake: false });
  });

  afterAll(async () => {
    await h.stop();
    closeDb(db);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  });

  test("FR-CHAR-10 FR-CHAR-03 player-1 damages Mira: DM and owner ≤ 1 s; player-2 redacted, no HP", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    expect(ent(dm, ids.Thorn as string)).toMatchObject({ hpCurrent: 3 });
    expect(ent(p2, ids.Thorn as string)).toMatchObject({ hpCurrent: 3 });
    const started = performance.now();
    const intentId = p1.intent("char.adjustHp", { characterId: ids.Mira, delta: -3 });
    const ev = await nextEvent(p1, "CharacterHpAdjusted");
    expect(ev.cause.intentId).toBe(intentId);
    expect((await p1.next("ack", 1000)).result).toEqual({ hpBefore: 12, hpAfter: 9 });
    await nextEvent(dm, "CharacterHpAdjusted");
    expect(performance.now() - started).toBeLessThan(1000);
    expect(ent(dm, ids.Mira as string)).toMatchObject({ hpCurrent: 9 });
    expect(ent(p1, ids.Mira as string)).toMatchObject({ hpCurrent: 9 });
    // Accepted timing tell: player-2 gets the redacted upsert, never the HP.
    await nextEvent(p2, "CharacterHpAdjusted");
    expect(ent(p2, ids.Mira as string)).not.toHaveProperty("hpCurrent");

    // Another player's character → forbidden; no frame for anyone.
    p2.intent("char.adjustHp", { characterId: ids.Mira, delta: -1 }, "x");
    expect(await p2.next("reject")).toMatchObject({ intentId: "x", code: "forbidden" });
    // No-op clamp → ack, no event.
    dm.intent("char.adjustHp", { characterId: ids.Pip, delta: 5 }, "noop");
    expect((await dm.next("ack", 1000)).result).toEqual({ hpBefore: 8, hpAfter: 8 });
    await p1.expectNoFrame(150);
    for (const c of [dm, p1, p2]) c.close();
  });

  test("FR-CHAR-08 FR-CHAR-17 player-1 attack: one public line for all; DM Thorn initiative hidden from players", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const before = entriesOf(p2).length;
    p1.intent("char.roll", { characterId: ids.Mira, kind: "attack", mode: "advantage" }, "atk");
    const ack = await p1.next("ack", 1000);
    const { entryId, rollIds } = ack.result as { entryId: string; rollIds: string[] };
    expect(rollIds).toHaveLength(2);
    for (const c of [dm, p2]) {
      const e = await nextEvent(c, "CharacterRolled");
      expect(e.changes).toEqual([expect.objectContaining({ id: entryId, op: "upsert" })]);
    }
    expect(entriesOf(p2).at(-1)).toMatchObject({ id: entryId, actorName: "Mira", public: true });
    expect(entriesOf(p2)).toHaveLength(before + 1);

    // DM rolls Thorn's initiative with the category off → DM only.
    dm.intent("char.roll", { characterId: ids.Thorn, kind: "initiative" }, "ini");
    const dmAck = await dm.next("ack", 1000);
    const hidden = (dmAck.result as { entryId: string }).entryId;
    expect(dm.store.records[GAME_LOG_ENTRY_TYPE]?.[hidden]).toMatchObject({ public: false });
    await barrier(p1);
    await barrier(p2);
    for (const c of [p1, p2]) {
      expect(c.store.records[GAME_LOG_ENTRY_TYPE]?.[hidden]).toBeUndefined();
      expect(c.raw()).not.toContain(hidden);
    }
    // Player `public` → forbidden; Pip has no attack → conflict.
    p1.intent("char.roll", { characterId: ids.Mira, kind: "initiative", public: true }, "pub");
    expect(await p1.next("reject")).toMatchObject({ intentId: "pub", code: "forbidden" });
    p1.intent("char.roll", { characterId: ids.Pip, kind: "attack" }, "pip");
    expect(await p1.next("reject")).toMatchObject({ intentId: "pip", code: "conflict" });
    for (const c of [dm, p1, p2]) c.close();
  });

  test("CHAR §13 leak scan: player-2 frames never carry Mira's sheet data; convergence; restart", async () => {
    const dm = await h.live(DM);
    const p2 = await h.live(p("Player 2"));
    dm.intent("char.adjustHp", { characterId: ids.Mira, delta: 2 });
    await dm.next("ack", 1000);
    dm.intent("char.roll", { characterId: ids.Mira, kind: "initiative", public: true });
    await dm.next("ack", 1000);
    await barrier(p2);
    expect(sheetLeaks(p2, ids.Mira as string)).toEqual([]);
    expect(sheetLeaks(p2, ids.Pip as string)).toEqual([]);
    // Positive control: player-2 does get their own sheet data.
    expect(sheetLeaks(p2, ids.Thorn as string).length).toBeGreaterThan(0);
    expect(leakScan(h.s, p2)).toEqual([]);
    const fresh = await h.live(p("Player 2"));
    const c = convergence(h.s, p2, fresh);
    expect(c.live[ENTITY_TYPE]).toEqual(c.fresh[ENTITY_TYPE] ?? {});
    expect(c.live[GAME_LOG_ENTRY_TYPE]).toEqual(c.fresh[GAME_LOG_ENTRY_TYPE] ?? {});
    for (const x of [dm, p2, fresh]) x.close();

    const snap = async () => {
      const out: Record<string, unknown> = {};
      for (const [k, cred] of Object.entries({ dm: DM, p1: p("Player 1"), p2: p("Player 2") })) {
        const client = await h.live(cred);
        out[k] = {
          entities: client.store.records[ENTITY_TYPE],
          entries: client.store.records[GAME_LOG_ENTRY_TYPE],
        };
        client.close();
      }
      return out;
    };
    const before = await snap();
    await h.restart();
    expect(await snap()).toEqual(before);
  });
});
