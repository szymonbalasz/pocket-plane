// Sprint 9 PM2 (party-board FR-PARTY-61, -65) over real sockets on `combat-polish`: the Party
// status tab's model (`partySummary`, the client's pure rows) built from each viewer's own store.
// No new data (0 new keys): other PCs stay on ADR-0063's whitelist, other players' pets on
// FR-ENT-37's redaction; the tab shows another player's companions with a band only (no numbers,
// no Card, no menu record, no base), never a monster; the DM lists every pet. Same after a
// reconnect. The server-side frame rules themselves: `entities/party-status.test.ts`.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { CREATURE_SHEET_TYPE } from "@shared/character-sheet/sheet";
import { EFFECT_TYPE, type EffectView } from "@shared/combat-extras/schemas";
import {
  COMBATANT_TYPE,
  type CombatantRecord,
  ENCOUNTER_TYPE,
} from "@shared/combat-tracker/schemas";
import {
  ENTITY_TYPE,
  type EntityRecord,
  REDACTED_CHARACTER_KEYS,
  REDACTED_PET_KEYS,
} from "@shared/entities/schemas";
import { SCENE_TYPE, TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { partySummary } from "@ui/features/party-board/summary-logic";
import { eq } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { encounter, player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { leakScan } from "../../ws/testing/convergence";

const DM = { role: "dm" as const, secret: TEST_SECRET };
type Row = Record<string, unknown>;

const recs = (c: TestClient, type: string) => Object.values(c.store.records[type] ?? {}) as Row[];
const sorted = (o: Row) => Object.keys(o).sort();

/** The tab's model as the client builds it from its own store. */
function tabOf(c: TestClient, playerId: string | null) {
  const s = partySummary(
    {
      entities: recs(c, ENTITY_TYPE),
      combatants: recs(c, COMBATANT_TYPE),
      encounters: recs(c, ENCOUNTER_TYPE),
      effects: recs(c, EFFECT_TYPE) as unknown as EffectView[],
      sheets: recs(c, CREATURE_SHEET_TYPE),
      tokens: recs(c, TOKEN_TYPE),
      scenes: recs(c, SCENE_TYPE),
    },
    { role: playerId === null ? "dm" : "player", playerId },
  );
  return { ...s, companions: [...s.pcs.flatMap((p) => p.companions), ...s.others] };
}

describe("PM2 Party status tab per viewer on combat-polish over WS", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let links: Record<string, { id: string; token: string }>;
  let dm: TestClient;
  let p1: TestClient;
  let p2: TestClient;
  const live = (name: string) => h.live({ role: "player", token: links[name]?.token as string });

  /** FR-PARTY-65: the frames a player holds carry no key the tab added, and the tab's rows. */
  function assertPlayerTab(c: TestClient, playerId: string) {
    const dmEntities = recs(dm, ENTITY_TYPE) as unknown as EntityRecord[];
    const dmCs = recs(dm, COMBATANT_TYPE) as unknown as CombatantRecord[];
    for (const e of recs(c, ENTITY_TYPE)) {
      if (e.ownerPlayerId === playerId) continue;
      if (e.kind === "character") expect(sorted(e)).toEqual([...REDACTED_CHARACTER_KEYS].sort());
      else expect(sorted(e)).toEqual([...REDACTED_PET_KEYS].sort());
    }
    expect(leakScan(h.s, c)).toEqual([]);
    const tab = tabOf(c, playerId);
    expect(tab.pcs.length).toBeGreaterThan(0);
    for (const r of tab.companions) {
      // Never a monster: a pet entity or an owned combatant of the DM's, owner known.
      const pet = dmEntities.find((x) => x.id === r.id);
      const owned = dmCs.find((x) => x.id === r.id);
      expect(
        (pet?.kind === "monster" && pet.companionOf !== null) ||
          (owned !== undefined && owned.ownerPlayerId !== null),
      ).toBe(true);
      expect(r.hidden).toBe(false);
      expect(r.record).toBeNull();
      expect(r.baseId).toBeNull();
      if (r.ownerPlayerId === playerId) continue;
      // Another player's companion: the band only.
      expect([r.hp, r.card]).toEqual([null, false]);
    }
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

  test("FR-PARTY-65 leak: the tab per player shows today's data only (other PCs' whitelist, other players' companions as a band, never a monster), before and after a reconnect; the DM lists every pet", async () => {
    const p1Id = links["Player 1"]?.id as string;
    const p2Id = links["Player 2"]?.id as string;
    assertPlayerTab(p1, p1Id);
    assertPlayerTab(p2, p2Id);
    // Each player sees the other's companions while they are in the fight (band).
    const owned = (recs(dm, COMBATANT_TYPE) as unknown as CombatantRecord[]).filter(
      (x) => x.ownerPlayerId !== null && x.active && !x.removed && !x.hidden && !x.ownerHidden,
    );
    expect(owned.length).toBeGreaterThan(0);
    for (const c of owned) {
      const other = c.ownerPlayerId === p1Id ? p2 : p1;
      const mine = c.ownerPlayerId === p1Id ? p1 : p2;
      expect(tabOf(other, c.ownerPlayerId === p1Id ? p2Id : p1Id).companions).toContainEqual(
        expect.objectContaining({ ownerPlayerId: c.ownerPlayerId, hp: null }),
      );
      const own = tabOf(mine, c.ownerPlayerId as string).companions;
      expect(own.some((r) => r.ownerPlayerId === c.ownerPlayerId && r.hp !== null)).toBe(true);
    }
    // The DM: every pet it holds, under its owner or in "Other companions".
    const pets = (recs(dm, ENTITY_TYPE) as unknown as EntityRecord[]).filter(
      (e) => e.kind === "monster" && e.companionOf !== null,
    );
    const dmTab = tabOf(dm, null);
    for (const p of pets) expect(dmTab.companions.map((r) => r.id)).toContain(p.id);

    for (const c of [p1, p2]) c.close();
    p1 = await live("Player 1");
    p2 = await live("Player 2");
    assertPlayerTab(p1, p1Id);
    assertPlayerTab(p2, p2Id);
  }, 60_000);
});
