// CHARX sprint 3 (V5) over real sockets: FR-CHARX-51 leak per player (snapshot, event frames,
// View-as load acks, a fresh connection after the edits) and FR-CHARX-53 live. Bundle: `scenes` +
// `vision-senses` (test-only composition; FOG's bundle `vision` lands in V2).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { library } from "@fixtures/index";
import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";
import { loadInProcess } from "@server/features/fixtures-adapters/loader";
import { CHARX_INTENTS } from "@shared/character-sheet/sheet";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import type { ServerFrame } from "@shared/protocol/frames";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { entity, player, scene } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";
import { SEES_INVISIBLE_DM_ONLY } from "./edit";

const DM = { role: "dm" as const, secret: TEST_SECRET };
const DEVIL = { visionFt: 0, darkvisionFt: 60, seesMagicalDarkness: true };

async function answer(c: TestClient, intentId: string) {
  for (;;) {
    const f = await c.next(undefined, 1500);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}
async function until(pred: () => boolean, ms = 1500) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("condition not reached in time");
    await Bun.sleep(10);
  }
}

/** Every record of `type` a frame carried: snapshots, event upserts, load acks. */
function recordsIn(frames: readonly ServerFrame[], type: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const f of frames) {
    if (f.type === "snapshot") out.push(...((f.records[type] ?? []) as never[]));
    if (f.type === "event") {
      for (const ch of f.changes) {
        const data = (ch as { data?: Record<string, unknown> }).data;
        if (ch.type === type && data) out.push(data);
      }
    }
    if (f.type === "ack") {
      const recs = (f.result as { records?: Record<string, unknown[]> } | undefined)?.records;
      out.push(...((recs?.[type] ?? []) as never[]));
    }
  }
  return out;
}
/** `senses` of creature `id` in every frame that carried it (absent entries skipped). */
const sensesIn = (c: TestClient, id: string) =>
  recordsIn(c.frames, ENTITY_TYPE)
    .filter((r) => r.id === id)
    .map((r) => (r.statBlock as { senses?: object } | undefined)?.senses)
    .filter((s) => s !== undefined);

describe("FR-CHARX-51 / -53 senses over WS (scenes + vision-senses)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let links: Record<string, string>;
  let ids: Record<string, string>;
  const p = (name: string) => ({ role: "player" as const, token: links[name] as string });

  beforeAll(async () => {
    const lib = {
      ...library,
      bundles: [
        ...library.bundles,
        defineBundle({ name: "senses-test", includes: ["scenes"], fixtures: ["vision-senses"] }),
      ],
    };
    const loaded = await loadInProcess(lib, "senses-test", {
      dmSecret: TEST_SECRET,
      testMode: true,
    });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    const rows = db.select().from(player).all();
    links = Object.fromEntries(rows.map((r) => [r.name, r.linkToken]));
    ids = Object.fromEntries(
      db
        .select()
        .from(entity)
        .all()
        .map((e) => [e.name, e.id]),
    );
    ids.p1 = rows.find((r) => r.name === "Player 1")?.id as string;
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

  test("FR-CHARX-51 FR-CHARX-53 player-2 never gets Mira's senses, player-1 never Thorn's (snapshot, events, View-as acks, fresh connection); no token carries senses", async () => {
    const mira = ids.Mira as string;
    const thorn = ids.Thorn as string;
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    // Owners hold their own (fixture vision-senses).
    expect(sensesIn(p1, mira)).toEqual([
      { visionFt: 30, darkvisionFt: 0, seesMagicalDarkness: false },
    ]);
    expect(sensesIn(p2, thorn)).toEqual([DEVIL]);

    // Owner flips Sees invisible → forbidden; the DM sets it, then the owner edits darkvision.
    const rej = await answer(
      p2,
      p2.intent(CHARX_INTENTS.edit, {
        creatureId: thorn,
        set: { senses: { ...DEVIL, seesInvisible: true } },
      }),
    );
    expect(rej).toMatchObject({
      type: "reject",
      code: "forbidden",
      message: SEES_INVISIBLE_DM_ONLY,
    });
    for (const [c, creatureId, senses] of [
      [dm, thorn, { ...DEVIL, seesInvisible: true }],
      [p2, thorn, { ...DEVIL, darkvisionFt: 30 }],
      [dm, mira, { visionFt: 60, darkvisionFt: 0, seesMagicalDarkness: false }],
    ] as const) {
      const a = await answer(c, c.intent(CHARX_INTENTS.edit, { creatureId, set: { senses } }));
      expect(a.type).toBe("ack");
    }
    const thornNow = { ...DEVIL, darkvisionFt: 30, seesInvisible: true };
    await until(() => JSON.stringify(sensesIn(p2, thorn).at(-1)) === JSON.stringify(thornNow));
    await until(() => (sensesIn(p1, mira).at(-1) as { visionFt?: number }).visionFt === 60);
    // The DM's View as Player 1 on every scene: load acks carry no entity senses.
    for (const s of db.select().from(scene).all()) {
      expect((await answer(dm, dm.loadViewAs(s.id, ids.p1 as string))).type).toBe("ack");
    }

    const fresh1 = await h.live(p("Player 1"));
    const fresh2 = await h.live(p("Player 2"));
    for (const c of [p1, fresh1]) {
      expect(sensesIn(c, thorn)).toEqual([]);
      expect(c.raw()).not.toContain("seesInvisible");
      expect(c.raw()).not.toContain('"darkvisionFt":30');
    }
    for (const c of [p2, fresh2]) {
      expect(sensesIn(c, mira)).toEqual([]);
      expect(c.raw()).not.toContain('"visionFt":60');
      expect(c.raw()).not.toContain('"visionFt":30');
    }
    expect(sensesIn(fresh2, thorn)).toEqual([thornNow]);
    for (const c of [dm, p1, p2, fresh1, fresh2]) {
      expect(JSON.stringify(recordsIn(c.frames, TOKEN_TYPE))).not.toContain("isionFt");
      expect(leakScan(h.s, c)).toEqual([]);
    }
    expect(
      JSON.stringify(
        recordsIn(
          dm.frames.filter((f) => f.type === "ack"),
          ENTITY_TYPE,
        ),
      ),
    ).not.toContain("senses");
    for (const [live, fresh] of [
      [p1, fresh1],
      [p2, fresh2],
    ] as const) {
      const c = convergence(h.s, live, fresh);
      expect(c.live[ENTITY_TYPE]).toEqual(c.fresh[ENTITY_TYPE] ?? {});
    }
  });
});
