// CMP §13 integration (C2) on the `compendium` bundle over real HTTP: FR-CMP-10 / -11 search,
// FR-CMP-12 entry + ETag / 304 / Cache-Control, FR-CMP-13 auth (DM secret, `Authorization:
// Player`, inactive campaign 409, no credential 401), FR-CMP-14 visibility, player leak scan.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { EntryResponse, type EntrySummary, SearchResponse } from "@shared/compendium/rest";
import { eq } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { compendiumEntry, player } from "../../db/schema";
import { startTestServer, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { CMP_CACHE_CONTROL } from "./auth";

/** CMP §13 leak strings: never in a player's REST body. */
const PLAYER_LEAKS = [
  "CMP-SECRET-ITEM",
  "CMP-SECOND-HOMEBREW",
  "Nimble Escape",
  "Fireball (house)",
];

let h: TestServer;
let db: Db;
let dir: string;
let tokens: Record<string, string>;
/** Every player response body, for the leak scan. */
const playerBodies: string[] = [];

beforeAll(async () => {
  const loaded = await loadBundle("compendium", { dmSecret: TEST_SECRET, testMode: true });
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

type Who = "dm" | "Player 1" | "Player 2" | "Second Player" | null;

function auth(who: Who): Record<string, string> {
  if (who === null) return {};
  if (who === "dm") return { Authorization: `Bearer ${TEST_SECRET}` };
  return { Authorization: `Player ${tokens[who]}` };
}

async function get(path: string, who: Who, headers: Record<string, string> = {}) {
  const res = await fetch(`${h.http}/api/compendium${path}`, {
    headers: { ...auth(who), ...headers },
  });
  const text = await res.text();
  if (who !== null && who !== "dm") playerBodies.push(text);
  expect({ path, cache: res.headers.get("cache-control") }).toEqual({
    path,
    cache: CMP_CACHE_CONTROL,
  });
  return { res, text, json: () => JSON.parse(text) as unknown };
}

async function search(params: Record<string, string>, who: Who): Promise<EntrySummary[]> {
  const r = await get(`/search?${new URLSearchParams(params)}`, who);
  expect(r.res.status).toBe(200);
  return SearchResponse.parse(r.json()).results;
}

const entryId = (name: string) =>
  db.select().from(compendiumEntry).where(eq(compendiumEntry.name, name)).get()?.id as string;

describe("compendium REST (C2)", () => {
  test("FR-CMP-13 auth: no credential 401; wrong secret / unknown link 401; inactive campaign's player 409; Cache-Control on every answer", async () => {
    expect((await get("/search", null)).res.status).toBe(401);
    expect(
      (await get("/search", null, { Authorization: "Bearer wrong-secret-xyz" })).res.status,
    ).toBe(401);
    expect((await get("/search", null, { Authorization: "Player nope" })).res.status).toBe(401);
    expect((await get("/search", null, { Authorization: "Basic abc" })).res.status).toBe(401);
    const inactive = await get("/search", "Second Player");
    expect(inactive.res.status).toBe(409);
    expect((inactive.json() as { code: string }).code).toBe("conflict");
    expect((await get(`/entries/${entryId("Fireball")}`, "Second Player")).res.status).toBe(409);
    expect((await get("/search", "dm")).res.status).toBe(200);
    expect((await get("/search", "Player 1")).res.status).toBe(200);
    // Auth runs before validation: a bad query without a credential is 401, with one 400.
    expect((await get("/search?bogus=1", null)).res.status).toBe(401);
    expect((await get("/search?bogus=1", "dm")).res.status).toBe(400);
  });

  test("FR-CMP-10 FR-CMP-14 search: DM 'goblin' → Goblin then Hobgoblin with definitions; player gets no monsters; kind=monster empty for a player", async () => {
    const dm = await search({ q: "goblin" }, "dm");
    expect(dm.slice(0, 2).map((r) => [r.name, r.kind, r.sourceLabel])).toEqual([
      ["Goblin", "monster", "SRD 5.1"],
      ["Hobgoblin", "monster", "SRD 5.1"],
    ]);
    expect(dm[0]?.definitionId).toBeTruthy();
    expect(dm[0]?.line).toBe("CR 1/4 · Small humanoid");
    const p1 = await search({ q: "goblin" }, "Player 1");
    expect(p1.every((r) => r.kind !== "monster")).toBe(true);
    expect(await search({ kind: "monster" }, "Player 1")).toEqual([]);
    expect((await search({ kind: "monster" }, "dm")).map((r) => r.name)).toEqual([
      "Adult Red Dragon",
      "Goblin",
      "Hobgoblin",
      "Ogre",
      "Wolf",
    ]);
  });

  test("FR-CMP-14 homebrew: DM sees own shared + hidden, never another campaign's; players own shared only", async () => {
    const dmNames = (await search({ q: "" }, "dm")).map((r) => r.name);
    const dmAll: string[] = [...dmNames];
    let page = SearchResponse.parse((await get("/search", "dm")).json());
    while (page.nextCursor) {
      page = SearchResponse.parse(
        (await get(`/search?${new URLSearchParams({ cursor: page.nextCursor })}`, "dm")).json(),
      );
      dmAll.push(...page.results.map((r) => r.name));
    }
    for (const n of ["Moonblade Shard", "CMP-SECRET-ITEM", "Fireball (house)", "Divine Fury"]) {
      expect(dmAll).toContain(n);
    }
    expect(dmAll).not.toContain("CMP-SECOND-HOMEBREW");
    expect(await search({ q: "CMP-SECOND" }, "dm")).toEqual([]);
    const brew = (await search({ q: "moonblade" }, "dm"))[0];
    expect(brew?.sourceLabel).toBe("Homebrew");

    expect((await search({ q: "moon" }, "Player 1")).map((r) => r.name)).toEqual([
      "Moonblade Shard",
    ]);
    expect(await search({ q: "CMP-SECRET" }, "Player 1")).toEqual([]);
    expect(await search({ q: "CMP-SECOND" }, "Player 2")).toEqual([]);
    expect((await search({ q: "fire" }, "Player 2")).map((r) => r.name)).toEqual(["Fireball"]);
    // Name prefixes first, then text matches (the dragon's fire breath).
    expect((await search({ q: "fire" }, "dm")).map((r) => r.name)).toEqual([
      "Fireball",
      "Fireball (house)",
      "Adult Red Dragon",
    ]);
  });

  test("FR-CMP-11 filters: spell level / school / class, monster CR range + type, item category, feature class; bad filters 400", async () => {
    const names = async (p: Record<string, string>, who: Who = "dm") =>
      (await search(p, who)).map((r) => r.name);
    expect(await names({ kind: "spell", level: "3" }, "Player 1")).toEqual(["Fireball"]);
    expect(await names({ kind: "spell", level: "3" })).toEqual(["Fireball", "Fireball (house)"]);
    expect(await names({ kind: "spell", school: "evocation", className: "Wizard" })).toEqual([
      "Fireball",
      "Fireball (house)",
    ]);
    expect(await names({ kind: "monster", crMin: "1", crMax: "5" })).toEqual(["Ogre"]);
    expect(await names({ kind: "monster", crMax: "1/4" })).toEqual(["Goblin", "Wolf"]);
    expect(await names({ kind: "monster", crMin: "10" })).toEqual(["Adult Red Dragon"]);
    expect(await names({ kind: "monster", type: "Beast" })).toEqual(["Wolf"]);
    expect(await names({ kind: "item", category: "armor" })).toEqual(["Chain mail"]);
    const rogue = await names({ kind: "feature", className: "Rogue" }, "Player 1");
    expect(rogue).toContain("Sneak Attack");
    expect(rogue.every((n) => n !== "Rage")).toBe(true);
    for (const bad of [
      "kind=spell&colour=red",
      "level=3",
      "kind=item&level=3",
      "kind=spell&level=x",
      "q=a&q=b",
    ]) {
      const r = await get(`/search?${bad}`, "dm");
      expect({ bad, status: r.res.status }).toEqual({ bad, status: 400 });
      expect((r.json() as { code: string }).code).toBe("invalid");
    }
  });

  test("FR-CMP-12 entry: monster carries its stat block + attribution; ETag → 304 (no body); a stale tag → 200", async () => {
    const r = await get(`/entries/${entryId("Goblin")}`, "dm");
    expect(r.res.status).toBe(200);
    const body = EntryResponse.parse(r.json());
    expect(body.entry.name).toBe("Goblin");
    expect(body.definition?.statBlock).toMatchObject({ ac: 15, hpMax: 7, hpFormula: "2d6" });
    expect(body.source).toMatchObject({ key: "srd-5.1", licence: "CC BY 4.0" });
    expect(body.source?.attribution).toContain("System Reference Document 5.1");
    expect(r.text).not.toContain("searchText");
    expect(r.text).not.toContain("dataHash");
    const etag = r.res.headers.get("etag") as string;
    expect(etag).toMatch(/^".+"$/);
    const again = await get(`/entries/${entryId("Goblin")}`, "dm", { "If-None-Match": etag });
    expect(again.res.status).toBe(304);
    expect(again.text).toBe("");
    expect(again.res.headers.get("etag")).toBe(etag);
    const weak = await get(`/entries/${entryId("Goblin")}`, "dm", {
      "If-None-Match": `"x", W/${etag}`,
    });
    expect(weak.res.status).toBe(304);
    const stale = await get(`/entries/${entryId("Goblin")}`, "dm", { "If-None-Match": '"stale"' });
    expect(stale.res.status).toBe(200);

    const fb = await get(`/entries/${entryId("Fireball")}`, "Player 1");
    expect(fb.res.status).toBe(200);
    const fireball = EntryResponse.parse(fb.json());
    expect(fireball.entry.line).toBe("Level 3 evocation");
    expect(fireball.definition).toBeUndefined();
    const brew = EntryResponse.parse(
      (await get(`/entries/${entryId("Moonblade Shard")}`, "Player 1")).json(),
    );
    expect(brew.source).toBeNull();
    expect(brew.entry.shared).toBe(true);
  });

  test("FR-CMP-12 FR-CMP-14 not visible → 404 before any conditional check (never 304); unknown id 404", async () => {
    const secret = entryId("CMP-SECRET-ITEM");
    const dmTag = (await get(`/entries/${secret}`, "dm")).res.headers.get("etag") as string;
    expect(dmTag).toBeTruthy();
    for (const who of ["Player 1", "Player 2"] as const) {
      for (const id of [
        secret,
        entryId("Goblin"),
        entryId("Fireball (house)"),
        entryId("CMP-SECOND-HOMEBREW"),
      ]) {
        const plain = await get(`/entries/${id}`, who);
        expect({ who, id, status: plain.res.status }).toEqual({ who, id, status: 404 });
        const cond = await get(`/entries/${id}`, who, { "If-None-Match": "*" });
        expect(cond.res.status).toBe(404);
      }
      const tagged = await get(`/entries/${secret}`, who, { "If-None-Match": dmTag });
      expect(tagged.res.status).toBe(404);
      expect(tagged.res.headers.get("etag")).toBeNull();
    }
    expect((await get(`/entries/${entryId("CMP-SECOND-HOMEBREW")}`, "dm")).res.status).toBe(404);
    const unknown = await get("/entries/no-such-entry", "Player 1");
    expect(unknown.res.status).toBe(404);
    expect(unknown.json()).toEqual((await get(`/entries/${secret}`, "Player 1")).json());
  });

  test("CMP §13 leak scan: no player REST body carries a leak string or a monster entry", () => {
    expect(playerBodies.length).toBeGreaterThan(20);
    const all = playerBodies.join("\n");
    for (const s of PLAYER_LEAKS)
      expect({ s, leaked: all.includes(s) }).toEqual({ s, leaked: false });
    expect(all.includes('"kind":"monster"')).toBe(false);
  });
});
