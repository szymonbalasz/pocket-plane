// Sprint 9 rules (CMP §13.3 integration) on the `sp-rules` bundle over real HTTP: the page routes
// (FR-CMP-65: DM / player bodies, ETag / 304, unknown page 404, house-rule edits change the
// ETag), house rules shared only (FR-CMP-67, also via search), rules in search but not the
// default list (FR-CMP-62), the schema no-op (FR-CMP-59) and the player leak scan (CMP §11).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { SECRET_HOUSE_RULE, SHARED_HOUSE_RULE } from "@fixtures/units/compendium/cmp-rule-house";
import { type EntrySummary, SearchResponse } from "@shared/compendium/rest";
import { RulesIndexResponse, RulesPageResponse } from "@shared/compendium/rules";
import { HOUSE_RULES_CHAPTER } from "@shared/compendium/schemas";
import { and, eq } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { campaign, compendiumEntry, player } from "../../db/schema";
import { startTestServer, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { CMP_CACHE_CONTROL } from "./auth";
import { DELETE_ENTRY, PUT_ENTRY } from "./homebrew";

/** CMP §13.3 R8: never in a player's body. */
const PLAYER_LEAKS = [SECRET_HOUSE_RULE, "CMP-SECRET-ITEM", "Nimble Escape", "Fireball (house)"];

let h: TestServer;
let db: Db;
let dir: string;
let tokens: Record<string, string>;
let campaignId: string;
const playerBodies: string[] = [];

beforeAll(async () => {
  const loaded = await loadBundle("sp-rules", { dmSecret: TEST_SECRET, testMode: true });
  dir = loaded.dir;
  db = openFileDb(loaded.config.dbPath);
  tokens = Object.fromEntries(
    db
      .select({ name: player.name, token: player.linkToken })
      .from(player)
      .all()
      .map((r) => [r.name, r.token]),
  );
  campaignId = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id ?? "";
  // Fake clock: every write below stamps the same instant (the ETag must still move).
  h = await startTestServer({ db });
}, 120_000);

afterAll(async () => {
  await h.stop();
  closeDb(db);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows may hold the WAL briefly; a leftover temp dir is harmless.
  }
});

type Who = "dm" | "Player 1";

const auth = (who: Who): Record<string, string> =>
  who === "dm"
    ? { Authorization: `Bearer ${TEST_SECRET}` }
    : { Authorization: `Player ${tokens[who]}` };

async function get(path: string, who: Who, headers: Record<string, string> = {}) {
  const res = await fetch(`${h.http}/api/compendium${path}`, {
    headers: { ...auth(who), ...headers },
  });
  const text = await res.text();
  if (who !== "dm") playerBodies.push(text);
  expect({ path, cache: res.headers.get("cache-control") }).toEqual({
    path,
    cache: CMP_CACHE_CONTROL,
  });
  return { res, text, json: () => JSON.parse(text) as unknown };
}

async function page(id: string, who: Who) {
  const r = await get(`/rules/${id}`, who);
  expect(r.res.status).toBe(200);
  return { ...RulesPageResponse.parse(r.json()), etag: r.res.headers.get("etag") ?? "" };
}

async function search(params: Record<string, string>, who: Who): Promise<EntrySummary[]> {
  const r = await get(`/search?${new URLSearchParams(params)}`, who);
  expect(r.res.status).toBe(200);
  return SearchResponse.parse(r.json()).results;
}

const DM_ACTOR = () => ({ actor: { role: "dm" as const, playerId: null, campaignId } });

describe("FR-CMP-59 schema", () => {
  test("FR-CMP-59 push is a no-op: `kind` is a plain TEXT column with no CHECK, so a `rule` row needs no schema change", () => {
    const row = db.$client
      .query<{ sql: string }, []>(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'compendium_entry'",
      )
      .get();
    expect(row?.sql).toMatch(/[`"]kind[`"] text NOT NULL/);
    expect(row?.sql.toUpperCase()).not.toContain("CHECK");
    expect(
      db.select().from(compendiumEntry).where(eq(compendiumEntry.kind, "rule")).all().length,
    ).toBeGreaterThan(0);
  });
});

describe("FR-CMP-65 page routes", () => {
  test("FR-CMP-65 page route: index = curated pages + House rules (names only), attribution; Combat body has the mini cards in page order with SRD text; DM and player", async () => {
    for (const who of ["dm", "Player 1"] as const) {
      const r = await get("/rules", who);
      expect(r.res.status).toBe(200);
      expect(r.res.headers.get("vary")).toBe("Authorization");
      const idx = RulesIndexResponse.parse(r.json());
      expect(idx.pages.map((p) => p.id)).toEqual([
        "combat",
        "conditions",
        "checks",
        "exploration",
        "spellcasting",
        "hazards",
        "house",
      ]);
      expect(idx.attribution?.licence).toBe("CC BY 4.0");
      expect(r.text).not.toContain('"text"');
      const combat = idx.pages.find((p) => p.id === "combat")?.cards.map((c) => c.name) ?? [];
      expect(combat.slice(0, 3)).toEqual(["Actions in Combat", "Attack", "Cast a Spell"]);
      for (const n of ["Dodge", "Help", "Cover", "Grappling", "Opportunity Attacks"]) {
        expect(combat).toContain(n);
      }
      // Mini set: no Initiative (combat-sequence isn't in it), so that key is skipped.
      expect(combat).not.toContain("Initiative");
      // Conditions: the mini set's three, in page order.
      expect(idx.pages.find((p) => p.id === "conditions")?.cards.map((c) => c.name)).toEqual([
        "Grappled",
        "Poisoned",
        "Prone",
      ]);
      const body = await page("combat", who);
      const cover = body.cards.find((c) => c.name === "Cover");
      expect(cover).toMatchObject({ section: "Cover", house: false, shared: true });
      expect(cover?.text).toContain("half cover");
      expect(body.cards.map((c) => c.name)).toEqual(combat);
    }
    const unknown = await get("/rules/races", "dm");
    expect(unknown.res.status).toBe(404);
    expect((await get("/rules/pinned", "Player 1")).res.status).toBe(404);
  });

  test("FR-CMP-65 ETag / 304: same body → 304; DM and player ETags differ", async () => {
    for (const path of ["/rules", "/rules/combat", "/rules/house"]) {
      const a = await get(path, "dm");
      const etag = a.res.headers.get("etag") ?? "";
      expect(etag).toMatch(/^"[A-Za-z0-9_-]{27}"$/);
      const again = await get(path, "dm", { "If-None-Match": etag });
      expect(again.res.status).toBe(304);
      const p = await get(path, "Player 1", { "If-None-Match": etag });
      expect(p.res.status).toBe(200);
      expect(p.res.headers.get("etag")).not.toBe(etag);
    }
  });

  test("FR-CMP-65 deleting or unsharing a non-newest house rule changes the ETag (fixed clock, no stale 304)", async () => {
    const run = (name: string, input: unknown) => h.s.commands.run(name, input, DM_ACTOR());
    const { entryId: extra } = run(PUT_ENTRY, {
      shared: true,
      entry: {
        kind: "rule",
        name: "Zz Newest rule",
        facets: { chapter: HOUSE_RULES_CHAPTER, section: "", order: 0 },
        body: { text: "Newest." },
      },
    }) as { entryId: string };
    const flanking = db
      .select()
      .from(compendiumEntry)
      .where(
        and(
          eq(compendiumEntry.campaignId, campaignId),
          eq(compendiumEntry.name, SHARED_HOUSE_RULE),
        ),
      )
      .get();
    if (!flanking) throw new Error("Flanking missing");
    const before = { dm: await page("house", "dm"), p: await page("house", "Player 1") };
    // Unshare the older "Flanking": same instant as "Zz Newest rule" (fake clock).
    run(PUT_ENTRY, {
      id: flanking.id,
      shared: false,
      entry: {
        kind: "rule",
        name: SHARED_HOUSE_RULE,
        facets: flanking.facets,
        body: flanking.body,
      },
    });
    for (const [who, was] of [
      ["dm", before.dm],
      ["Player 1", before.p],
    ] as const) {
      const r = await get("/rules/house", who, { "If-None-Match": was.etag });
      expect({ who, status: r.res.status }).toEqual({ who, status: 200 });
    }
    expect((await page("house", "Player 1")).cards.map((c) => c.name)).toEqual(["Zz Newest rule"]);
    const mid = await page("house", "dm");
    run(DELETE_ENTRY, { id: flanking.id });
    const r = await get("/rules/house", "dm", { "If-None-Match": mid.etag });
    expect(r.res.status).toBe(200);
    // Restore the bundle's state for the other tests.
    run(DELETE_ENTRY, { id: extra });
    run(PUT_ENTRY, {
      shared: true,
      entry: {
        kind: "rule",
        name: SHARED_HOUSE_RULE,
        facets: flanking.facets,
        body: flanking.body,
      },
    });
  });
});

describe("FR-CMP-67 house rules", () => {
  test("FR-CMP-67 house rules shared only: DM sees Flanking + Critical fumbles (DM only marked), the player Flanking only; also via search; chapter House rules", async () => {
    const dm = await page("house", "dm");
    expect(dm.cards.map((c) => [c.name, c.house, c.shared])).toEqual([
      [SECRET_HOUSE_RULE, true, false],
      [SHARED_HOUSE_RULE, true, true],
    ]);
    const p = await page("house", "Player 1");
    expect(p.cards.map((c) => c.name)).toEqual([SHARED_HOUSE_RULE]);
    const idx = RulesIndexResponse.parse((await get("/rules", "Player 1")).json());
    expect(idx.pages.find((x) => x.id === "house")?.cards.map((c) => c.name)).toEqual([
      SHARED_HOUSE_RULE,
    ]);
    expect((await search({ q: "fumbles", kind: "rule" }, "Player 1")).length).toBe(0);
    expect((await search({ q: "critical fumbles" }, "Player 1")).length).toBe(0);
    expect(
      (await search({ q: "critical fumbles", kind: "rule" }, "dm")).map((r) => r.name),
    ).toEqual([SECRET_HOUSE_RULE]);
    const row = db
      .select()
      .from(compendiumEntry)
      .where(eq(compendiumEntry.name, SECRET_HOUSE_RULE))
      .get();
    expect(row?.facets).toMatchObject({ chapter: HOUSE_RULES_CHAPTER });
    expect(row?.line).toBe(`Combat · ${HOUSE_RULES_CHAPTER}`);
  });
});

describe("FR-CMP-62 search", () => {
  test("FR-CMP-62 rules searchable, not in the default list: All's empty list has no rule; 'cover' finds the Cover card; kind=rule matches text ('grapple' → Grappling); All matches rule names only ('goblin' → no rule); players too", async () => {
    for (const who of ["dm", "Player 1"] as const) {
      const all = await search({}, who);
      expect(all.length).toBeGreaterThan(0);
      expect(all.some((r) => r.kind === "rule")).toBe(false);
      const cover = await search({ q: "cover" }, who);
      expect(cover[0]).toMatchObject({ name: "Cover", kind: "rule", line: "Cover · Combat" });
      const grapple = await search({ q: "grapple", kind: "rule" }, who);
      expect(grapple.map((r) => r.name)).toContain("Grappling");
      expect((await search({ q: "goblin" }, who)).some((r) => r.kind === "rule")).toBe(false);
      const filtered = await search({ kind: "rule", section: "Cover" }, who);
      expect(filtered.map((r) => r.name)).toEqual(["Cover"]);
      const chapter = await search({ kind: "rule", chapter: "Combat", q: "dodge" }, who);
      expect(chapter.map((r) => r.name)).toEqual(["Dodge"]);
    }
  });

  test("CMP §11 leak scan: no player body above holds an unshared house rule, a monster or unshared homebrew", () => {
    expect(playerBodies.length).toBeGreaterThan(10);
    for (const body of playerBodies) {
      for (const leak of PLAYER_LEAKS) expect(body.includes(leak)).toBe(false);
      expect(body.includes('"kind":"monster"')).toBe(false);
    }
  });
});
