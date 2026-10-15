// FR-SCN-29 over real sockets on the `scene-tools` bundle: the DM's `scn.setDiagonalRule` reaches
// the DM and both players as one `map-settings` upsert (cause `DiagonalRuleSet`); a player's try
// is refused with nothing sent; a reconnecting player and a restarted server serve the row in
// the snapshot; convergence holds.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { DiagonalRuleSet } from "@shared/events/scene-tools";
import {
  MAP_SETTINGS_TYPE,
  type MapSettingsRecord,
  SCN_INTENTS as S,
} from "@shared/scene-tools/schemas";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { campaign, player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { convergence } from "../../ws/testing/convergence";

const DM = { role: "dm" as const, secret: TEST_SECRET };

async function answer(c: TestClient, intentId: string) {
  for (;;) {
    const f = await c.next(undefined, 1500);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}
async function until(pred: () => boolean, ms = 1000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("condition not reached in time");
    await Bun.sleep(10);
  }
}

describe("FR-SCN-29 diagonal rule over WS (build/scene-tools-settings)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let links: Record<string, string>;
  let cid: string;
  const p = (name: string) => ({ role: "player" as const, token: links[name] as string });
  const ruleOf = (c: TestClient) =>
    (c.store.records[MAP_SETTINGS_TYPE]?.[cid] as MapSettingsRecord | undefined)?.diagonalRule;

  beforeAll(async () => {
    const loaded = await loadBundle("scene-tools", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    links = Object.fromEntries(
      db
        .select({ name: player.name, token: player.linkToken })
        .from(player)
        .all()
        .map((r) => [r.name, r.token]),
    );
    cid = db
      .select()
      .from(campaign)
      .all()
      .find((c) => c.active)?.id as string;
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

  test("FR-SCN-29 the DM's rule reaches everyone as one upsert; a player's try is refused; reconnect + restart keep it", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    expect(ruleOf(dm)).toBeUndefined();
    expect(ruleOf(p1)).toBeUndefined();

    const n1 = p1.frames.length;
    const tryIt = p1.intent(S.setDiagonalRule, { rule: "5" });
    const rejected = await answer(p1, tryIt);
    expect(rejected).toMatchObject({ type: "reject", code: "forbidden" });
    await Bun.sleep(100);
    expect(p2.frames.filter((f) => f.type === "event")).toHaveLength(0);
    expect(p1.frames.slice(n1).filter((f) => f.type === "event")).toHaveLength(0);

    const id = dm.intent(S.setDiagonalRule, { rule: "5" });
    expect((await answer(dm, id)).type).toBe("ack");
    for (const c of [dm, p1, p2]) await until(() => ruleOf(c) === "5");
    const ev = p2.frames.find((f) => f.type === "event");
    expect(ev).toMatchObject({
      cause: { name: DiagonalRuleSet.type },
      changes: [
        { type: MAP_SETTINGS_TYPE, id: cid, op: "upsert", data: { id: cid, diagonalRule: "5" } },
      ],
    });
    for (const [live, cred] of [
      [dm, DM],
      [p1, p("Player 1")],
      [p2, p("Player 2")],
    ] as const) {
      const fresh = await h.live(cred);
      const c = convergence(h.s, live, fresh);
      expect(c.live[MAP_SETTINGS_TYPE]).toEqual(c.fresh[MAP_SETTINGS_TYPE] ?? {});
      fresh.close();
    }

    p1.close();
    const back = await h.live(p("Player 1"));
    expect(ruleOf(back)).toBe("5");

    for (const c of [dm, back, p2]) c.close();
    await h.stop();
    h = await startTestServer({ db, fake: false });
    const dm2 = await h.live(DM);
    const p1b = await h.live(p("Player 1"));
    expect(ruleOf(dm2)).toBe("5");
    expect(ruleOf(p1b)).toBe("5");
    // Leave the bundle as loaded for later suites on this server (none share it, but stay tidy).
    const reset = dm2.intent(S.setDiagonalRule, { rule: "5-10-5" });
    expect((await answer(dm2, reset)).type).toBe("ack");
    await until(() => ruleOf(p1b) === "5-10-5");
    dm2.close();
    p1b.close();
  });
});
