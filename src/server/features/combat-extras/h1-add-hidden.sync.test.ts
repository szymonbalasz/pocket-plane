// Sprint 10, H1 (BL-97) over real sockets on `combat-extras`: Add… (Create tokens + Add hidden)
// binds the visible unbound "Goblin 3": players get only that token's delete; no frame, nor the
// snapshot after a reconnect or a restart, names the new combatant.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import {
  COMBATANT_TYPE,
  type CombatantRecord,
  ENCOUNTER_TYPE,
  type EncounterRecord,
} from "@shared/combat-tracker/schemas";
import { TOKEN_TYPE, type TokenRecord } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { encounter, player } from "../../db/schema";
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

describe("BL-97 Add hidden over WS (combat-extras)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let tokens: Record<string, string>;
  const p = (name: string) => ({ role: "player" as const, token: tokens[name] as string });

  beforeAll(async () => {
    const loaded = await loadBundle("combat-extras", { dmSecret: TEST_SECRET, testMode: true });
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

  test("FR-CBTX-44 Add hidden binding a visible token: players get its delete only; reconnect / restart snapshots never name the combatant", async () => {
    const ambush = db.select().from(encounter).where(eq(encounter.status, "started")).get();
    const actor = { role: "dm" as const, playerId: null, campaignId: ambush?.campaignId as string };
    h.s.commands.run("map.activateScene", { sceneId: ambush?.sceneId }, { actor });
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const enc = all<EncounterRecord>(dm, ENCOUNTER_TYPE).find((e) => e.status === "started");
    const g3 = all<TokenRecord>(dm, TOKEN_TYPE).find((t) => t.name === "Goblin 3") as TokenRecord;
    expect(g3.hidden).toBe(false);
    for (const c of [p1, p2]) {
      expect(all<TokenRecord>(c, TOKEN_TYPE).some((t) => t.id === g3.id)).toBe(true);
    }
    const marks = [p1.raw().length, p2.raw().length];

    dm.intent("cbtx.addCombatants", {
      encounterId: enc?.id,
      items: [{ definitionId: g3.definitionId }],
      createTokens: true,
      hidden: true,
    });
    const added = await nextEvent(dm, "CombatantsAdded");
    await dm.next("ack");
    expect(added.changes[0]).toMatchObject({ type: TOKEN_TYPE, id: g3.id, data: { hidden: true } });
    const row = all<CombatantRecord>(dm, COMBATANT_TYPE).find((c) => c.tokenId === g3.id);
    expect(row).toMatchObject({ name: "Goblin 3", hidden: true });

    for (const [i, c] of [p1, p2].entries()) {
      const ev = await nextEvent(c, "CombatantsAdded");
      await barrier(c);
      expect(ev.changes).toEqual([{ type: TOKEN_TYPE, id: g3.id, op: "delete" }]);
      const since = c.raw().slice(marks[i]);
      for (const leak of [row?.id as string, "Goblin 3"]) expect(since).not.toContain(leak);
      expect(all<TokenRecord>(c, TOKEN_TYPE).some((t) => t.id === g3.id)).toBe(false);
    }
    for (const c of [dm, p1, p2]) c.close();

    const snap = async () => {
      const out: Record<string, unknown> = {};
      for (const [k, cred] of Object.entries({ dm: DM, p1: p("Player 1"), p2: p("Player 2") })) {
        const client = await h.live(cred);
        if (k !== "dm") {
          const raw = client.raw();
          for (const leak of [row?.id as string, g3.id, "Goblin 3"])
            expect(raw).not.toContain(leak);
        }
        out[k] = [COMBATANT_TYPE, TOKEN_TYPE].map((type) => client.store.records[type]);
        client.close();
      }
      return out;
    };
    const before = await snap();
    await h.restart();
    expect(await snap()).toEqual(before);
  });
});
