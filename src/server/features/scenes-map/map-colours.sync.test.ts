// FR-MAP-73 signal frames unchanged (sprint 5, K3) over real sockets on `player-colours` (DM,
// `player-1` jade, `player-2` blue): player colours are derived on each client from `from` and the
// `player` / `campaign` records (ADR-0055), so `map.ping`, `map.pull`, `map.laser`, `map.drag` and
// `scn.template` frames keep their sprint 4 shape: `{type, name, data, from}`, `data` byte-equal to
// what was sent, `from` server-stamped, no `color` anywhere. Also after a colour change.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import type { ServerFrame } from "@shared/protocol/frames";
import { SCN_SIGNALS } from "@shared/scene-tools/schemas";
import { MAP_INTENTS, MAP_SIGNALS } from "@shared/scenes-map/schemas";
import { closeDb, type Db } from "../../db/client";
import { player, scene, token } from "../../db/schema";
import {
  startTestServer,
  TEST_SECRET,
  type TestClient,
  type TestServer,
} from "../../testing/harness";
import { leakScan } from "../../ws/testing/convergence";

let h: TestServer;
let db: Db;
let cleanup: () => void;
let p: Record<"Player 1" | "Player 2", typeof player.$inferSelect>;
let ambush: string;
let mira: string;

beforeAll(async () => {
  const loaded = await loadBundle("player-colours", { testMode: true, dmSecret: TEST_SECRET });
  cleanup = loaded.cleanup;
  db = loaded.openDb();
  p = Object.fromEntries(
    db
      .select()
      .from(player)
      .all()
      .map((r) => [r.name, r]),
  ) as typeof p;
  ambush = db
    .select()
    .from(scene)
    .all()
    .find((s) => s.name === "Goblin Ambush")?.id as string;
  mira = db
    .select()
    .from(token)
    .all()
    .find((t) => t.sceneId === ambush && t.ownerPlayerId === p["Player 1"].id)?.id as string;
  h = await startTestServer({ db, testMode: true, fake: false });
}, 60_000);

afterAll(async () => {
  await h.stop();
  closeDb(db);
  try {
    cleanup();
  } catch {
    // Windows may hold the WAL briefly; a leftover temp dir is harmless.
  }
});

const DM = { role: "dm" as const, secret: TEST_SECRET };
const P1 = () => ({ role: "player" as const, token: p["Player 1"].linkToken });
const P2 = () => ({ role: "player" as const, token: p["Player 2"].linkToken });

async function reply(c: TestClient, name: string, payload: unknown) {
  const intentId = c.intent(name, payload);
  for (;;) {
    const f = await c.next(undefined, 2000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}

type SignalFrame = Extract<ServerFrame, { type: "signal" }>;

/** The next `n` signal frames `c` receives. */
async function signals(c: TestClient, n: number): Promise<SignalFrame[]> {
  const out: SignalFrame[] = [];
  while (out.length < n) out.push((await c.next("signal", 1000)) as SignalFrame);
  return out;
}

describe("FR-MAP-73 signal frames", () => {
  test("FR-MAP-73 signal frames unchanged: ping, pull, laser, drag and scn.template keep their shape, server `from`, no `color` (also after a recolour)", async () => {
    const dm = await h.live(DM);
    const b = await h.live(P1());
    const c = await h.live(P2());
    expect((await reply(dm, MAP_INTENTS.activateScene, { sceneId: ambush })).type).toBe("ack");
    for (const x of [b, c]) await x.next("snapshot", 1000);

    const fromP1 = { role: "player" as const, playerId: p["Player 1"].id };
    const sent = {
      ping: { sceneId: ambush, x: 120, y: 340 },
      laser: { sceneId: ambush, points: [[10, 20] as const, [30, 40] as const] },
      drag: { sceneId: ambush, tokenId: mira, x: 101.5, y: 202 },
      template: { sceneId: ambush, key: "k3", shape: "cone", x: 4, y: 7, size: 15, angle: 0 },
      pull: { sceneId: ambush, x: 500, y: 260 },
    };
    const round = async () => {
      // player-1 → DM + player-2: ping, laser, drag (own Mira), an ephemeral template.
      b.send({ type: "signal", name: MAP_SIGNALS.ping, data: sent.ping });
      b.send({ type: "signal", name: MAP_SIGNALS.laser, data: sent.laser });
      b.send({ type: "signal", name: MAP_SIGNALS.drag, data: sent.drag });
      b.send({ type: "signal", name: SCN_SIGNALS.template, data: sent.template });
      for (const x of [dm, c]) {
        const got = await signals(x, 4);
        expect(got.map((f) => f.name)).toEqual([
          MAP_SIGNALS.ping,
          MAP_SIGNALS.laser,
          MAP_SIGNALS.drag,
          SCN_SIGNALS.template,
        ]);
        const data = [sent.ping, sent.laser, sent.drag, sent.template];
        got.forEach((f, i) => {
          expect(Object.keys(f).sort()).toEqual(["data", "from", "name", "type"]);
          expect(f.data).toEqual(JSON.parse(JSON.stringify(data[i])));
          expect(f.from).toEqual(fromP1);
          expect(JSON.stringify(f)).not.toContain("color");
        });
      }
      // DM → both players: a pull (the DM's colour comes from `campaign.dmColor`, not the frame).
      dm.send({ type: "signal", name: MAP_SIGNALS.pull, data: sent.pull });
      for (const x of [b, c]) {
        const [f] = await signals(x, 1);
        expect(f).toEqual({
          type: "signal",
          name: MAP_SIGNALS.pull,
          data: sent.pull,
          from: { role: "dm" },
        });
      }
    };
    await round();

    // A recolour is one record upsert; the next frames are byte-for-byte the same shape.
    expect(
      (await reply(b, "camp.setColor", { playerId: p["Player 1"].id, color: "#e08ab8" })).type,
    ).toBe("ack");
    for (const x of [dm, c]) await x.next("event", 1000);
    await round();
    for (const x of [b, c]) expect(leakScan(h.s, x)).toEqual([]);
    for (const x of [dm, b, c]) x.close();
  });
});
