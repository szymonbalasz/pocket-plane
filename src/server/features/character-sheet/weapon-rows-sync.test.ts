// FR-CHARX-57 weapon fields over real sockets on `rules-effects` (S4-1a): Brakka's Flame Tongue
// `bonus` / `extraDamage` live in the stat block, so the DM and the owner (`player-1`) get them,
// `player-2` never (not on the other-players whitelist, FR-CHARX-35); a custom monster's weapon
// row reaches no player. Leak scan per player over snapshots, live events, `sync.load` acks and
// raw frames, before and after reconnect.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadRulesEffects } from "@fixtures/units/effect-modifiers/rules-effects";
import { CHARX_INTENTS } from "@shared/character-sheet/sheet";
import { ENTITY_TYPE, IMPORTED_ENTITY_TYPE } from "@shared/entities/schemas";
import { eq } from "drizzle-orm";
import { closeDb, type Db } from "../../db/client";
import { entity, player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";

const DM = { role: "dm" as const, secret: TEST_SECRET };
/** A unique monster weapon (FR-CHARX-57: definition rows are DM only). */
const VENOM = "Venom Fang QX";

const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
type Ent = { id: string; name: string; statBlock?: { attacks?: Record<string, unknown>[] } };
const entOf = (c: TestClient, id: string) => c.store.records[ENTITY_TYPE]?.[id] as Ent | undefined;
const flameOf = (c: TestClient, id: string) =>
  entOf(c, id)?.statBlock?.attacks?.find((a) => a.name === "Flame Tongue greatsword");

describe("FR-CHARX-57 weapon fields leak", () => {
  let h: TestServer;
  let db: Db;
  let cleanup: () => void;
  let tokens: Record<string, string>;
  let brakka: string;
  let elite: string;
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
    elite = idOf("Elite Goblin Warrior");
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

  /** Raw frames + every record held: no weapon detail beyond what the viewer may see. */
  const scan = async (c: TestClient, o: { owner: boolean }) => {
    await barrier(c);
    const raw = c.raw();
    expect({ leak: VENOM, found: raw.includes(VENOM) }).toEqual({ leak: VENOM, found: false });
    if (!o.owner) {
      for (const leak of ["Flame Tongue", "extraDamage", '"bonus"']) {
        expect({ leak, found: raw.includes(leak) }).toEqual({ leak, found: false });
      }
      expect(entOf(c, brakka)?.statBlock).toBeUndefined();
    }
    expect(entOf(c, elite)).toBeUndefined();
    expect(leakScan(h.s, c)).toEqual([]);
  };

  test("FR-CHARX-57 weapon fields leak: owner gets Brakka's bonus + parts, player-2 none; a monster's weapon row reaches no player", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    expect(flameOf(dm, brakka)).toMatchObject({
      bonus: 1,
      extraDamage: [{ damage: "2d6", type: "fire" }],
    });
    expect(flameOf(p1, brakka)).toMatchObject({
      bonus: 1,
      extraDamage: [{ damage: "2d6", type: "fire" }],
    });
    expect(entOf(p2, brakka)?.name).toBe("Brakka");
    await scan(p1, { owner: true });
    await scan(p2, { owner: false });

    // Live: the DM edits Brakka's row (+2, a second part) and gives the Elite a weapon row.
    const row = flameOf(dm, brakka) as Record<string, unknown>;
    dm.intent(CHARX_INTENTS.putRow, {
      creatureId: brakka,
      list: "attacks",
      row: {
        ...row,
        bonus: 2,
        extraDamage: [
          { damage: "2d6", type: "fire" },
          { damage: "1d4", type: "cold" },
        ],
      },
    });
    await dm.next("ack");
    dm.intent(CHARX_INTENTS.putRow, {
      creatureId: elite,
      list: "attacks",
      row: {
        name: VENOM,
        toHit: 4,
        damage: "1d6+2",
        damageType: "piercing",
        bonus: 1,
        extraDamage: [{ damage: "2d6", type: "poison" }],
      },
    });
    await dm.next("ack");
    for (const c of [dm, p1, p2]) await barrier(c);
    expect(flameOf(p1, brakka)).toMatchObject({ bonus: 2 });
    expect(flameOf(p1, brakka)?.extraDamage).toHaveLength(2);
    await scan(p1, { owner: true });
    await scan(p2, { owner: false });

    // `sync.load` of definitions: refused for players, nothing received.
    for (const c of [p1, p2]) {
      c.load(IMPORTED_ENTITY_TYPE, [elite]);
      expect((await c.next("reject")).code).toBe("forbidden");
    }
    await scan(p1, { owner: true });
    await scan(p2, { owner: false });

    // Reconnect: fresh snapshots converge with the live stores and stay clean.
    for (const [c, cred, owner] of [
      [p1, p("Player 1"), true],
      [p2, p("Player 2"), false],
      [dm, DM, true],
    ] as const) {
      const fresh = await h.live(cred);
      const r = convergence(h.s, c, fresh);
      expect(r.live[ENTITY_TYPE]).toEqual(r.fresh[ENTITY_TYPE]);
      if (cred.role === "player") await scan(fresh, { owner });
      fresh.close();
    }
    for (const c of [dm, p1, p2]) c.close();
  }, 60_000);
});
