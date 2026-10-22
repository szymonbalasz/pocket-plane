// Sprint 8 CB2 over real sockets on `combat-polish` (CBTX §13.1 CB1, CB7, CB12, CB13): combat's
// `cbt` overlay line (FR-CBT-166) run on each client's own store (DM, player-1, player-2) through
// a whole round of Next: which tokens ring, dashed only for the DM, never a hidden / fog-hidden
// combatant's for players (no data reaches them), the same after a reconnect, gone after End;
// leak scan per player. The ring is derived (0 B on the wire, FR-MAP-111).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import {
  CBT_INTENTS,
  COMBATANT_TYPE,
  type CombatantRecord,
  ENCOUNTER_TYPE,
  type EncounterRecord,
} from "@shared/combat-tracker/schemas";
import { TOKEN_TYPE, type TokenView } from "@shared/scenes-map/schemas";
import { cbtTokenOverlay } from "@ui/features/combat-tracker/token-overlay";
import { eq } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { encounter, player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { leakScan } from "../../ws/testing/convergence";

const DM = { role: "dm" as const, secret: TEST_SECRET };

const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
async function ok(c: TestClient, name: string, payload: unknown) {
  const id = c.intent(name, payload);
  for (;;) {
    const f = await c.next(undefined, 3000);
    if (f.type === "reject" && f.intentId === id) throw new Error(`${name}: ${JSON.stringify(f)}`);
    if (f.type === "ack" && f.intentId === id) return f;
  }
}

const encounterOf = (c: TestClient) =>
  (Object.values(c.store.records[ENCOUNTER_TYPE] ?? {}) as EncounterRecord[]).find(
    (e) => e.status === "started",
  );
const combatant = (c: TestClient, id: string | null | undefined) =>
  id ? (c.store.records[COMBATANT_TYPE]?.[id] as CombatantRecord | undefined) : undefined;

/** Ringed tokens on a client, by token name → dashed (`hidden`). */
function rings(c: TestClient): Record<string, boolean> {
  const client = c.store.you?.role === "dm" ? "dm" : "player";
  const out: Record<string, boolean> = {};
  for (const t of Object.values(c.store.records[TOKEN_TYPE] ?? {}) as TokenView[]) {
    const d = cbtTokenOverlay.decorate?.(t, c.store, { client, selected: false, targeting: false });
    if (!d?.turn) continue;
    expect(d.turn.id).toBe("cbt-token-turn");
    out[t.name] = d.turn.hidden === true;
  }
  return out;
}
const tokenNames = (c: TestClient) =>
  new Set((Object.values(c.store.records[TOKEN_TYPE] ?? {}) as TokenView[]).map((t) => t.name));

describe("CB2 turn ring per viewer on combat-polish over WS", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let dm: TestClient;
  let p1: TestClient;
  let p2: TestClient;
  let links: Record<string, string>;
  const settle = async () => {
    for (const c of [dm, p1, p2]) await barrier(c);
  };
  const next = async () => {
    const e = encounterOf(dm) as EncounterRecord;
    await ok(dm, CBT_INTENTS.nextTurn, {
      encounterId: e.id,
      expectedRound: e.round,
      expectedTurnId: e.turnCombatantId,
    });
    await settle();
  };
  const leaks = () => {
    for (const c of [p1, p2]) expect(leakScan(h.s, c)).toEqual([]);
  };

  beforeEach(async () => {
    const loaded = await loadBundle("cb-turn-ring-e2e", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    links = Object.fromEntries(
      db
        .select()
        .from(player)
        .all()
        .map((r) => [r.name, r.linkToken]),
    );
    h = await startTestServer({ db, fake: false });
    const ambush = db.select().from(encounter).where(eq(encounter.status, "started")).get();
    const actor = { role: "dm" as const, playerId: null, campaignId: ambush?.campaignId as string };
    h.s.commands.run("map.activateScene", { sceneId: ambush?.sceneId }, { actor });
    dm = await h.live(DM);
    p1 = await h.live({ role: "player", token: links["Player 1"] as string });
    p2 = await h.live({ role: "player", token: links["Player 2"] as string });
  }, 60_000);

  afterEach(async () => {
    await h.stop();
    closeDb(db);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  });

  test("FR-CBT-166 turn ring per viewer: a whole round of Next for the DM, player-1 and player-2", async () => {
    const seen = new Map<
      string,
      { dm: Record<string, boolean>; p1: Record<string, boolean>; p2: Record<string, boolean> }
    >();
    // The fog-hidden Goblin loads Down (skipped); healed, it takes its turn (CB7).
    const goblin = (Object.values(dm.store.records[COMBATANT_TYPE] ?? {}) as CombatantRecord[]).find(
      (c) => c.name === "Goblin",
    ) as CombatantRecord;
    expect(goblin.hidden).toBe(true);
    await ok(dm, CBT_INTENTS.applyHp, { combatantId: goblin.id, kind: "heal", amount: 5 });
    await settle();
    const start = encounterOf(dm) as EncounterRecord;
    for (let i = 0; i < 30; i++) {
      const e = encounterOf(dm) as EncounterRecord;
      const turn = combatant(dm, e.turnCombatantId) as CombatantRecord;
      const r = { dm: rings(dm), p1: rings(p1), p2: rings(p2) };
      seen.set(turn.name, r);
      const dark = turn.hidden || turn.ownerHidden;
      // DM: its turn token rings, dashed iff players don't see this turn.
      if (turn.tokenId) expect(Object.values(r.dm).length).toBeGreaterThan(0);
      for (const dashed of Object.values(r.dm)) expect(dashed).toBe(dark);
      for (const [c, mine] of [
        [p1, r.p1],
        [p2, r.p2],
      ] as const) {
        // Players: never dashed; exactly the DM's rings on the tokens they hold; none on a
        // hidden / fog-hidden / ownerHidden turn (its id never reaches them).
        expect(Object.values(mine).every((d) => d === false)).toBe(true);
        const have = tokenNames(c);
        const want = dark
          ? {}
          : Object.fromEntries(
              Object.keys(r.dm)
                .filter((n) => have.has(n))
                .map((n) => [n, false]),
            );
        expect(mine).toEqual(want);
        if (dark) {
          expect(encounterOf(c)?.playerTurnCombatantId ?? null).toBeNull();
          expect(c.store.records[COMBATANT_TYPE]?.[turn.id]).toBeUndefined();
        }
      }
      await next();
      const after = encounterOf(dm) as EncounterRecord;
      if (after.round > start.round && after.turnCombatantId === start.turnCombatantId) break;
    }
    // CB1: Mira's turn rings Mira only; her Owlbear and Goblin 2 have turns of their own.
    expect(seen.get("Mira")).toEqual({
      dm: { Mira: false },
      p1: { Mira: false },
      p2: { Mira: false },
    });
    // CB7: Brakka's turn rings Brakka and his in-turn companions for everyone who has them.
    const brakka = { Brakka: false, "Drake Companion": false, "Fire Elemental 2": false };
    expect(seen.get("Brakka")?.dm).toEqual(brakka);
    expect(seen.get("Brakka")?.p1).toEqual(brakka);
    expect(seen.get("Brakka")?.p2).toEqual(brakka);
    // CB7: the hidden Elite, the hidden Wolf and the fog-hidden Goblin → DM dashed, players none.
    for (const name of ["Elite Goblin Warrior", "Wolf", "Goblin"]) {
      const s = seen.get(name);
      if (!s) throw new Error(`no ${name} turn in the round (${[...seen.keys()].join(", ")})`);
      expect(Object.values(s.dm)).toEqual([true]);
      expect(s.p1).toEqual({});
      expect(s.p2).toEqual({});
    }
    leaks();
  }, 60_000);

  test("FR-CBT-166 turn ring per viewer: same rings after a reconnect; none after End; leak scan", async () => {
    // To Brakka's turn (companions ring too), then reconnect player-1.
    for (
      let i = 0;
      i < 12 && combatant(dm, encounterOf(dm)?.turnCombatantId)?.name !== "Brakka";
      i++
    )
      await next();
    const before = rings(p1);
    expect(before.Brakka).toBe(false);
    p1.close();
    p1 = await h.live({ role: "player", token: links["Player 1"] as string });
    expect(rings(p1)).toEqual(before);
    leaks();
    // End: rings gone everywhere (CB13).
    const e = encounterOf(dm) as EncounterRecord;
    await ok(dm, CBT_INTENTS.end, { encounterId: e.id });
    await settle();
    for (const c of [dm, p1, p2]) expect(rings(c)).toEqual({});
    leaks();
  }, 60_000);
});
