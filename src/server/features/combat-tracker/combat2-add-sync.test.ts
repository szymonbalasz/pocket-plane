// Sprint 2, N5 over real sockets on `combat`: Start with a rolled extra Goblin creates one hidden
// token; players' frames carry no hidden token, combatant, HP or monster initiative line
// (FR-CBT-64, -69); restart → identical snapshots.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import {
  COMBATANT_TYPE,
  type CombatantRecord,
  ENCOUNTER_ENTRY_TYPE,
  ENCOUNTER_TYPE,
  type EncounterEntryRecord,
  type EncounterRecord,
} from "@shared/combat-tracker/schemas";
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import { SCENE_TYPE, type SceneRecord, TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";

const DM = { role: "dm" as const, secret: TEST_SECRET };

async function nextEvent(c: TestClient, cause: string) {
  for (;;) {
    const e = await c.next("event", 1500);
    if (e.cause.name === cause) return e;
  }
}
const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
const all = <T>(c: TestClient, type: string) => Object.values(c.store.records[type] ?? {}) as T[];

describe("N5 Start over WS (combat)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let tokens: Record<string, string>;
  const p = (name: string) => ({ role: "player" as const, token: tokens[name] as string });

  beforeAll(async () => {
    const loaded = await loadBundle("combat", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    tokens = Object.fromEntries(
      db
        .select({ name: player.name, token: player.linkToken })
        .from(player)
        .all()
        .map((r) => [r.name, r.token]),
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

  test("FR-CBT-64 created hidden token never reaches players over WS; restart → identical snapshots", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const enc = all<EncounterRecord>(dm, ENCOUNTER_TYPE)[0] as EncounterRecord;
    const scene = all<SceneRecord>(dm, SCENE_TYPE).find((s) => s.name === "Goblin Ambush");
    const entries = all<EncounterEntryRecord>(dm, ENCOUNTER_ENTRY_TYPE).sort(
      (a, b) => a.seq - b.seq,
    );
    // encounter-1 + one extra Goblin (rolled): the fixture's placed tokens bind the rest.
    const body = {
      name: enc.name,
      partyCharacterIds: null,
      entries: entries.map((e, i) => ({
        definitionId: e.definitionId,
        quantity: i === 0 ? e.quantity + 1 : e.quantity,
        ...(i === 0 ? { hpMode: "rolled" } : {}),
      })),
    };
    const put = await fetch(`${h.http}/api/encounters/${enc.id}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${TEST_SECRET}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(put.status).toBe(200);
    await nextEvent(dm, "EncounterUpdated");
    for (const c of [p1, p2]) await barrier(c);
    const marks = [p1.raw().length, p2.raw().length];

    dm.intent("cbt.start", { encounterId: enc.id, sceneId: scene?.id, at: { col: 10, row: 8 } });
    const started = await nextEvent(dm, "EncounterStarted");
    await dm.next("ack");
    const created = started.changes.filter((c) => c.type === TOKEN_TYPE);
    expect(created).toHaveLength(1);
    expect(created[0]?.data).toMatchObject({ name: "Goblin 3", hidden: true });
    const g3 = all<CombatantRecord>(dm, COMBATANT_TYPE).find((c) => c.name === "Goblin 3");
    expect(g3?.tokenId).toBe(created[0]?.id as string);
    const lines = started.changes
      .filter((c) => c.type === GAME_LOG_ENTRY_TYPE)
      .map((c) => c.data as GameLogEntryRecord);
    expect(lines.filter((l) => l.category === "other")).toHaveLength(3);
    expect(lines.filter((l) => l.category === "initiative")).toHaveLength(5);
    expect(lines.every((l) => l.public === false)).toBe(true);

    for (const [i, c] of [p1, p2].entries()) {
      await nextEvent(c, "EncounterStarted");
      await barrier(c);
      const since = c.raw().slice(marks[i]);
      for (const leak of [g3?.id, g3?.tokenId, "HP (2d6)", ...lines.map((l) => l.id)]) {
        expect(since).not.toContain(leak as string);
      }
      // Visible monsters ranked by their (hidden) rolls; no initiative number reaches players.
      expect(
        all<Record<string, unknown>>(c, COMBATANT_TYPE).every(
          (x) => x.kind !== "monster" || !("initiative" in x),
        ),
      ).toBe(true);
    }
    for (const c of [dm, p1, p2]) c.close();

    const snap = async () => {
      const out: Record<string, unknown> = {};
      for (const [k, cred] of Object.entries({ dm: DM, p1: p("Player 1"), p2: p("Player 2") })) {
        const client = await h.live(cred);
        out[k] = [ENCOUNTER_TYPE, COMBATANT_TYPE, TOKEN_TYPE, GAME_LOG_ENTRY_TYPE].map(
          (type) => client.store.records[type],
        );
        client.close();
      }
      return out;
    };
    const before = await snap();
    await h.restart();
    expect(await snap()).toEqual(before);
  });
});
