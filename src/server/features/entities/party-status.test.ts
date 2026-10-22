// Sprint 8 CB3 server part (ADR-0063, party-board FR-PARTY-52) over real sockets on
// `combat-polish`: other players get a PC's `hpCurrent`, `hpMax`, `tempHp`, `ac` on the one
// whitelist; companions per ADR-0056 (owner numbers, others a band); monsters never (no unowned
// or hostile creature's numbers). Player 1 = Mira + Brakka, Player 2 = Thorn (temp HP 5).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import {
  COMBATANT_TYPE,
  type CombatantRecord,
  ENCOUNTER_TYPE,
  type EncounterRecord,
} from "@shared/combat-tracker/schemas";
import {
  ENTITY_TYPE,
  type EntityRecord,
  REDACTED_CHARACTER_KEYS,
  REDACTED_PET_KEYS,
} from "@shared/entities/schemas";
import { eq } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { encounter, player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { leakScan } from "../../ws/testing/convergence";

const DM = { role: "dm" as const, secret: TEST_SECRET };
type Row = Record<string, unknown>;

const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
async function ok(c: TestClient, name: string, payload: unknown) {
  const id = c.intent(name, payload);
  for (;;) {
    const f = await c.next(undefined, 3000);
    if (f.type === "reject" && f.intentId === id) throw new Error(`${name}: ${f.message}`);
    if (f.type === "ack" && f.intentId === id) return f;
  }
}
const recs = (c: TestClient, type: string) => Object.values(c.store.records[type] ?? {}) as Row[];
const pc = (c: TestClient, name: string) =>
  recs(c, ENTITY_TYPE).find((e) => e.kind === "character" && e.name === name) as Row;
const sorted = (o: Row) => Object.keys(o).sort();

describe("CB3 party status visibility (ADR-0063) on combat-polish over WS", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let links: Record<string, { id: string; token: string }>;
  let dm: TestClient;
  let p1: TestClient;
  let p2: TestClient;
  const live = (name: string) => h.live({ role: "player", token: links[name]?.token as string });
  const dmChar = (name: string) =>
    pc(dm, name) as unknown as Extract<EntityRecord, { kind: "character" }>;

  /**
   * The rules every player frame keeps: own PCs full; other PCs exactly the whitelist with the
   * DM's figures; pets per FR-ENT-37; companion combatants per ADR-0056; monsters never.
   */
  function assertPlayerView(c: TestClient, playerId: string) {
    const dmCs = recs(dm, COMBATANT_TYPE) as unknown as CombatantRecord[];
    for (const e of recs(c, ENTITY_TYPE)) {
      const full = recs(dm, ENTITY_TYPE).find((x) => x.id === e.id) as EntityRecord;
      if (e.kind === "character") {
        if (e.ownerPlayerId === playerId) {
          expect(e).toHaveProperty("statBlock");
          continue;
        }
        const ch = full as Extract<EntityRecord, { kind: "character" }>;
        expect(sorted(e)).toEqual([...REDACTED_CHARACTER_KEYS].sort());
        expect(e).toMatchObject({
          hpCurrent: ch.hpCurrent,
          hpMax: ch.statBlock.hpMax,
          tempHp: ch.tempHp,
          ac: ch.statBlock.ac,
        });
        continue;
      }
      // Monsters never: only pets reach a player (FR-ENT-37).
      expect(full.kind === "monster" && full.companionOf !== null).toBe(true);
      if (e.ownerPlayerId !== playerId) expect(sorted(e)).toEqual([...REDACTED_PET_KEYS].sort());
    }
    for (const x of recs(c, COMBATANT_TYPE)) {
      expect(x).not.toHaveProperty("tieOrder");
      if (x.kind !== "monster") continue;
      const d = dmCs.find((y) => y.id === x.id) as CombatantRecord;
      const owned = d.ownerPlayerId !== null && d.ownerPlayerId === playerId;
      if (owned) continue;
      // Monster or another player's companion: a band only, never the numbers.
      for (const k of ["hpCurrent", "hpMax", "tempHp", "card", "statBlock"]) {
        expect(x).not.toHaveProperty(k);
      }
    }
    expect(leakScan(h.s, c)).toEqual([]);
  }

  beforeAll(async () => {
    const loaded = await loadBundle("combat-polish", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    links = Object.fromEntries(
      db
        .select()
        .from(player)
        .all()
        .map((r) => [r.name, { id: r.id, token: r.linkToken }]),
    );
    h = await startTestServer({ db, fake: false });
    const fight = db.select().from(encounter).where(eq(encounter.status, "started")).get();
    const actor = { role: "dm" as const, playerId: null, campaignId: fight?.campaignId as string };
    h.s.commands.run("map.activateScene", { sceneId: fight?.sceneId }, { actor });
    dm = await h.live(DM);
    p1 = await live("Player 1");
    p2 = await live("Player 2");
  }, 60_000);

  afterAll(async () => {
    await h.stop();
    closeDb(db);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  });

  test("FR-PARTY-52 party summary per player", async () => {
    const p1Id = links["Player 1"]?.id as string;
    const p2Id = links["Player 2"]?.id as string;
    // Snapshot: P1 sees Thorn's figures (temp HP 5 from cb-party); P2 sees Mira's and Brakka's.
    const thorn = dmChar("Thorn");
    expect(pc(p1, "Thorn")).toMatchObject({
      hpCurrent: thorn.hpCurrent,
      hpMax: thorn.statBlock.hpMax,
      tempHp: 5,
      ac: thorn.statBlock.ac,
    });
    expect(pc(p2, "Brakka")).toMatchObject({ hpCurrent: 35, hpMax: 55 });
    expect(pc(p2, "Mira")).toMatchObject({ ac: dmChar("Mira").statBlock.ac });
    for (const [c, other] of [
      [p1, "Thorn"],
      [p2, "Mira"],
    ] as const) {
      expect(pc(c, other)).not.toHaveProperty("deathSuccesses");
      expect(pc(c, other)).toHaveProperty("deathState");
    }
    // Companions (ADR-0056): the owner holds numbers, other players a band.
    const companions = (recs(dm, COMBATANT_TYPE) as unknown as CombatantRecord[]).filter(
      (x) => x.ownerPlayerId !== null && x.active && !x.removed && !x.hidden && !x.ownerHidden,
    );
    expect(companions.length).toBeGreaterThan(0);
    for (const d of companions) {
      const [own, other] = d.ownerPlayerId === p1Id ? [p1, p2] : [p2, p1];
      expect(recs(own, COMBATANT_TYPE).find((x) => x.id === d.id)).toHaveProperty("hpCurrent");
      const theirs = recs(other, COMBATANT_TYPE).find((x) => x.id === d.id);
      expect(theirs).toHaveProperty("band");
      expect(theirs).not.toHaveProperty("hpCurrent");
    }
    assertPlayerView(p1, p1Id);
    assertPlayerView(p2, p2Id);

    // Live (FR-PARTY-55): a temp HP set reaches the other player as an entity upsert; damage too.
    await ok(dm, "cbtx.setTempHp", { target: { characterId: dmChar("Mira").id }, value: 3 });
    await barrier(p2);
    expect(pc(p2, "Mira")).toMatchObject({ tempHp: 3 });
    const thornC = (recs(dm, COMBATANT_TYPE) as unknown as CombatantRecord[]).find(
      (x) => x.name === "Thorn",
    ) as CombatantRecord;
    await ok(dm, "cbt.applyHp", { combatantId: thornC.id, kind: "damage", amount: 4 });
    await barrier(p1);
    expect(pc(p1, "Thorn")).toMatchObject({ tempHp: 1, hpCurrent: thorn.hpCurrent });
    assertPlayerView(p1, p1Id);
    assertPlayerView(p2, p2Id);

    // A PC hidden from players (#141, OQ-PARTY-31 A) still shows its figures to others.
    await ok(dm, "map.setTokenHidden", { tokenId: thornC.tokenId, hidden: true });
    await barrier(p1);
    expect(pc(p1, "Thorn")).toMatchObject({ tempHp: 1, ac: thorn.statBlock.ac });

    // After a reconnect: the snapshot carries the same figures, nothing more.
    for (const c of [p1, p2]) c.close();
    p1 = await live("Player 1");
    p2 = await live("Player 2");
    expect(pc(p1, "Thorn")).toMatchObject({ tempHp: 1 });
    expect(pc(p2, "Mira")).toMatchObject({ tempHp: 3 });
    assertPlayerView(p1, p1Id);
    assertPlayerView(p2, p2Id);
  }, 60_000);

  test("FR-PARTY-52 monsters never", async () => {
    const p1Id = links["Player 1"]?.id as string;
    const p2Id = links["Player 2"]?.id as string;
    // Damage a monster and a companion: no player frame carries a monster's HP number.
    const dmCs = recs(dm, COMBATANT_TYPE) as unknown as CombatantRecord[];
    const goblin = dmCs.find((x) => x.name === "Goblin 2") as CombatantRecord;
    const wolf = dmCs.find((x) => x.name === "Wolf") as CombatantRecord;
    const marks = [p1.frames.length, p2.frames.length];
    await ok(dm, "cbt.applyHp", { combatantId: wolf.id, kind: "damage", amount: 3 });
    await ok(dm, "cbt.applyHp", { combatantId: goblin.id, kind: "damage", amount: 1 });
    for (const c of [p1, p2]) await barrier(c);
    const enc = recs(dm, ENCOUNTER_TYPE).find((e) => e.status === "started") as EncounterRecord;
    expect(enc).toBeDefined();
    for (const [i, c] of [p1, p2].entries()) {
      const id = i === 0 ? p1Id : p2Id;
      for (const f of c.frames.slice(marks[i])) {
        if (f.type !== "event") continue;
        for (const ch of f.changes) {
          if (ch.op !== "upsert") continue;
          const r = ch.data as Row;
          if (ch.type === ENTITY_TYPE && r.kind === "monster" && r.ownerPlayerId !== id) {
            expect(r).not.toHaveProperty("hpCurrent");
          }
          if (ch.type === COMBATANT_TYPE && r.kind === "monster" && r.ownerPlayerId !== id) {
            expect(r).not.toHaveProperty("hpCurrent");
            expect(r).not.toHaveProperty("hpMax");
          }
        }
      }
      assertPlayerView(c, id);
    }
    // The pets' and monsters' stat blocks never reach another player.
    for (const c of [p1, p2]) {
      for (const e of recs(c, ENTITY_TYPE)) {
        if (e.kind === "monster" && e.ownerPlayerId !== (c === p1 ? p1Id : p2Id)) {
          expect(e).not.toHaveProperty("statBlock");
        }
      }
    }
  }, 60_000);
});
