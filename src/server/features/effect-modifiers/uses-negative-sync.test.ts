// FR-MOD-59 / FR-CHARX-58 over real sockets on the `rules-effects` units (S4-2): Brakka's Rage is
// at 0 / 3 (`uses-rage-spent`); player-1 (owner) toggles without `overspend` → reject, with it →
// −1 / 3, Rage on; a pip past zero → −2 / 3; Reset → 3 / 3. The DM and player-1 hold the
// overspent sheet; player-2 never receives Brakka's `creature-sheet` (nor Mira's, whose Searing
// Strike row `trg-mira-uses` adds). Leak scan per player over snapshots, events, `sync.load` acks
// and raw frames, before and after reconnect.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadRulesEffects } from "@fixtures/units/effect-modifiers/rules-effects";
import { CHARX_INTENTS, CREATURE_SHEET_TYPE } from "@shared/character-sheet/sheet";
import { MOD_INTENTS } from "@shared/effect-modifiers/intents";
import { RULE_TRIGGER_TYPE } from "@shared/effect-modifiers/trigger-records";
import { and, eq } from "drizzle-orm";
import { closeDb, type Db } from "../../db/client";
import { effectPreset, entity, player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";

const DM = { role: "dm" as const, secret: TEST_SECRET };

const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
type Sheet = { features: { id: string; name: string; usesMax?: number; used: number }[] };
const sheetOf = (c: TestClient, id: string) =>
  c.store.records[CREATURE_SHEET_TYPE]?.[id] as Sheet | undefined;
const rageOf = (c: TestClient, id: string) =>
  sheetOf(c, id)?.features.find((f) => f.name === "Rage");

describe("FR-MOD-59 negative uses over WS", () => {
  let h: TestServer;
  let db: Db;
  let cleanup: () => void;
  let tokens: Record<string, string>;
  let brakka: string;
  let mira: string;
  let rage: string;
  const p = (name: string) => ({ role: "player" as const, token: tokens[name] as string });

  beforeAll(async () => {
    const loaded = await loadRulesEffects({ dmSecret: TEST_SECRET, testMode: true });
    cleanup = loaded.cleanup;
    db = loaded.openDb();
    tokens = Object.fromEntries(
      db
        .select({ name: player.name, token: player.linkToken })
        .from(player)
        .all()
        .map((r) => [r.name, r.token]),
    );
    const idOf = (name: string) =>
      db.select().from(entity).where(eq(entity.name, name)).get()?.id as string;
    brakka = idOf("Brakka");
    mira = idOf("Mira");
    rage = db
      .select()
      .from(effectPreset)
      .where(and(eq(effectPreset.characterId, brakka), eq(effectPreset.name, "Rage")))
      .get()?.id as string;
    h = await startTestServer({ db, fake: false });
  });

  afterAll(async () => {
    await h.stop();
    closeDb(db);
    try {
      cleanup();
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  });

  /** player-2 holds no sheet of Brakka's or Mira's, in the store or in any frame. */
  const scan = async (c: TestClient, o: { owner: boolean }) => {
    await barrier(c);
    if (!o.owner) {
      expect(sheetOf(c, brakka)).toBeUndefined();
      expect(sheetOf(c, mira)).toBeUndefined();
      const sheetIds = c.frames.flatMap((f) =>
        f.type === "event"
          ? f.changes.filter((x) => x.type === CREATURE_SHEET_TYPE).map((x) => x.id)
          : [],
      );
      expect(sheetIds).not.toContain(brakka);
      expect(sheetIds).not.toContain(mira);
      for (const leak of ["Searing Strike", '"usesMax"']) {
        expect({ leak, found: c.raw().includes(leak) }).toEqual({ leak, found: false });
      }
    }
    expect(leakScan(h.s, c)).toEqual([]);
  };

  test("FR-MOD-59 overspend over WS: reject without overspend, −1 / 3 with it, a pip past zero −2 / 3, Reset 3 / 3; player-2 gets no sheet; reconnect converges", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    expect(rageOf(dm, brakka)).toMatchObject({ usesMax: 3, used: 3 });
    expect(rageOf(p1, brakka)).toMatchObject({ usesMax: 3, used: 3 });
    await scan(p2, { owner: false });

    p1.intent(MOD_INTENTS.toggle, { characterId: brakka, presetId: rage, on: true });
    const rej = await p1.next("reject");
    expect([rej.code, rej.message]).toEqual(["conflict", "No Rage uses left"]);

    p1.intent(MOD_INTENTS.toggle, {
      characterId: brakka,
      presetId: rage,
      on: true,
      overspend: true,
    });
    await p1.next("ack");
    for (const c of [dm, p1, p2]) await barrier(c);
    expect(rageOf(dm, brakka)?.used).toBe(4);
    expect(rageOf(p1, brakka)?.used).toBe(4);

    // A pip past zero from the sheet (the DM's), then the owner's Reset.
    const row = rageOf(dm, brakka)?.id;
    dm.intent(CHARX_INTENTS.useResource, {
      characterId: brakka,
      resource: { feature: row },
      delta: 1,
    });
    await dm.next("ack");
    await barrier(p1);
    expect(rageOf(p1, brakka)?.used).toBe(5);
    await scan(p1, { owner: true });
    await scan(p2, { owner: false });
    for (const c of [p1, p2]) {
      c.load(RULE_TRIGGER_TYPE);
      await c.next("ack");
    }
    await scan(p1, { owner: true });
    await scan(p2, { owner: false });

    // Reconnect: fresh snapshots equal the live stores; still no leak.
    for (const [c, cred] of [
      [p1, p("Player 1")],
      [p2, p("Player 2")],
      [dm, DM],
    ] as const) {
      const fresh = await h.live(cred);
      const r = convergence(h.s, c, fresh);
      expect(r.live[CREATURE_SHEET_TYPE] ?? {}).toEqual(r.fresh[CREATURE_SHEET_TYPE] ?? {});
      if (cred.role === "player") {
        await scan(fresh, { owner: cred.token === tokens["Player 1"] });
      }
      fresh.close();
    }

    p1.intent(CHARX_INTENTS.useResource, {
      characterId: brakka,
      resource: { feature: row },
      reset: true,
    });
    await p1.next("ack");
    await barrier(dm);
    expect(rageOf(dm, brakka)?.used).toBe(0);
    for (const c of [dm, p1, p2]) c.close();
  });
});
