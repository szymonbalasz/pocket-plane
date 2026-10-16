// CMP §13 integration (C3) on the `compendium` bundle over real HTTP: FR-CMP-20 import panel
// REST: `GET /api/compendium/sources` (bundled vs stored version → Update) and `POST
// /api/compendium/import` (DM only; refused while an encounter is started; counts; Cache-Control).
// Player WS frames during the import: no monster definition, no leak string.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { CBT_INTENTS } from "@shared/combat-tracker/schemas";
import {
  entryTotal,
  ImportResponse,
  SourcesResponse,
  sourcePanelState,
} from "@shared/compendium/import";
import { and, eq } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { compendiumEntry, compendiumSource, encounter, player, scene } from "../../db/schema";
import { dmActor } from "../../http";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { CMP_CACHE_CONTROL } from "./auth";
import { END_COMBAT_FIRST } from "./import";

const PLAYER_LEAKS = ["CMP-SECRET-ITEM", "CMP-SECOND-HOMEBREW", "Nimble Escape", "imported-entity"];

let h: TestServer;
let db: Db;
let dir: string;
let token1: string;
let cid: string;

beforeAll(async () => {
  const loaded = await loadBundle("compendium", { dmSecret: TEST_SECRET, testMode: true });
  dir = loaded.dir;
  db = openFileDb(loaded.config.dbPath);
  token1 = db.select().from(player).where(eq(player.name, "Player 1")).get()?.linkToken as string;
  cid = db.select().from(player).where(eq(player.name, "Player 1")).get()?.campaignId as string;
  h = await startTestServer({ db, fake: false });
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

const DM = { Authorization: `Bearer ${TEST_SECRET}` };
const P1 = () => ({ Authorization: `Player ${token1}` });

async function req(method: "GET" | "POST", path: string, headers: Record<string, string>) {
  const res = await fetch(`${h.http}/api/compendium${path}`, {
    method,
    headers: { ...headers, ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
    body: method === "POST" ? JSON.stringify({ source: "srd-5.1" }) : undefined,
  });
  expect(res.headers.get("cache-control")).toBe(CMP_CACHE_CONTROL);
  return { status: res.status, json: (await res.json()) as unknown };
}

const sourceVersion = () =>
  db.select().from(compendiumSource).where(eq(compendiumSource.key, "srd-5.1")).get()?.version;

describe("compendium import REST (C3)", () => {
  test("FR-CMP-20 sources: DM sees SRD 5.1 · 55 entries (mini) with Update; players and no credential → 401", async () => {
    const r = await req("GET", "/sources", DM);
    expect(r.status).toBe(200);
    const [srd] = SourcesResponse.parse(r.json).sources;
    expect(srd?.key).toBe("srd-5.1");
    expect(srd?.name).toBe("SRD 5.1");
    expect(srd?.imported?.version).toBe("mini");
    expect(entryTotal(srd?.imported?.counts ?? {})).toBe(55);
    expect(srd && sourcePanelState(srd)).toBe("update");
    expect((await req("GET", "/sources", P1())).status).toBe(401);
    expect((await req("GET", "/sources", {})).status).toBe(401);
  });

  test("FR-CMP-20 import: player 401; encounter started → 409 'End combat first'; nothing written", async () => {
    const before = db.select().from(compendiumEntry).all().length;
    const p = await req("POST", "/import", P1());
    expect(p.status).toBe(401);

    const enc = db.select().from(encounter).where(eq(encounter.campaignId, cid)).get();
    const sc = db
      .select()
      .from(scene)
      .where(and(eq(scene.campaignId, cid), eq(scene.name, "Goblin Ambush")))
      .get();
    const actor = dmActor(cid);
    h.s.commands.run(CBT_INTENTS.start, { encounterId: enc?.id, sceneId: sc?.id }, { actor });
    const r = await req("POST", "/import", DM);
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ code: "conflict", message: END_COMBAT_FIRST });
    h.s.commands.run(CBT_INTENTS.end, { encounterId: enc?.id }, { actor });

    expect(db.select().from(compendiumEntry).all()).toHaveLength(before);
    expect(sourceVersion()).toBe("mini");
  });

  test("FR-CMP-20 DM import of the bundled source → 200 counts (mini rows existing / updated, the rest created); sources current; players get no definition frames", async () => {
    const p1: TestClient = await h.live({ role: "player", token: token1 });
    const seen = p1.raw().length;
    const r = await req("POST", "/import", DM);
    expect(r.status).toBe(200);
    const body = ImportResponse.parse(r.json);
    expect(body.source).toBe("srd-5.1");
    const created = Object.values(body.counts).reduce((n, c) => n + c.created, 0);
    const kept = Object.values(body.counts).reduce((n, c) => n + c.existing + c.updated, 0);
    expect(kept).toBe(55);
    expect(created).toBeGreaterThan(1_000);
    expect(body.counts.monster.created).toBeGreaterThan(300);

    const s = SourcesResponse.parse((await req("GET", "/sources", DM)).json).sources[0];
    expect(s && sourcePanelState(s)).toBe("current");
    expect(sourceVersion()).toBe(body.version);

    // Again: nothing to do, all existing.
    const again = ImportResponse.parse((await req("POST", "/import", DM)).json);
    expect(Object.values(again.counts).every((c) => c.created === 0 && c.updated === 0)).toBe(true);

    // A round trip so any frame from the import has arrived.
    await new Promise((res) => setTimeout(res, 100));
    const frames = p1.raw().slice(seen);
    for (const leak of PLAYER_LEAKS) expect(frames).not.toContain(leak);
  }, 30_000);
});
