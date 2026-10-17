// CMP §13 S4 integration on `compendium-full` (full bundled SRD + `cmp-search-homebrew`):
// FR-CMP-33 ranking table, word order, FR-CMP-38 source rank, FR-CMP-35 / -36 groups + `sameAs`
// + paging, FR-CMP-14 players never see hidden entries, FR-CMP-34 index freshness + timing,
// FR-CMP-37 matcher parity (client `nameTier` = server tier).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { HB_POTION_MARKER } from "@fixtures/units/compendium/cmp-search-homebrew";
import { nameTier, queryWords } from "@shared/compendium/match";
import { type EntrySummary, SearchQuery, SearchResponse } from "@shared/compendium/rest";
import { and, eq, isNull } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { campaign, compendiumEntry, entity, player } from "../../db/schema";
import { startTestServer, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { IMPORT_RECORDED } from "./import";
import { rowTier, searchEntries } from "./search";
import { dropSearchIndex, searchIndex } from "./search-index";
import { loadSrd51, SRD_51_SOURCE } from "./sources/srd-5.1";
import type { EntryViewer } from "./visibility";

let h: TestServer;
let db: Db;
let dir: string;
let cid: string;
let tokens: Record<string, string>;

beforeAll(async () => {
  const loaded = await loadBundle("compendium-full", { dmSecret: TEST_SECRET, testMode: true });
  dir = loaded.dir;
  db = openFileDb(loaded.config.dbPath);
  cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
  tokens = Object.fromEntries(
    db
      .select({ name: player.name, token: player.linkToken })
      .from(player)
      .all()
      .map((r) => [r.name, r.token]),
  );
  h = await startTestServer({ db, fake: false });
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

type Who = "dm" | "Player 1" | "Player 2";
const auth = (who: Who): Record<string, string> =>
  who === "dm"
    ? { Authorization: `Bearer ${TEST_SECRET}` }
    : { Authorization: `Player ${tokens[who]}` };
/** Every player response body, for the leak scan. */
const playerBodies: string[] = [];

async function get(path: string, who: Who, headers: Record<string, string> = {}) {
  const res = await fetch(`${h.http}/api/compendium${path}`, {
    headers: { ...auth(who), ...headers },
  });
  const text = await res.text();
  if (who !== "dm") playerBodies.push(text);
  return { status: res.status, text };
}

async function page(params: Record<string, string>, who: Who) {
  const r = await get(`/search?${new URLSearchParams(params)}`, who);
  expect({ params, status: r.status }).toEqual({ params, status: 200 });
  return SearchResponse.parse(JSON.parse(r.text));
}

/** Every page of a search, joined. */
async function all(params: Record<string, string>, who: Who): Promise<EntrySummary[]> {
  const out: EntrySummary[] = [];
  let cursor: string | null = null;
  do {
    const p = await page(cursor ? { ...params, cursor } : params, who);
    out.push(...p.results);
    cursor = p.nextCursor;
  } while (cursor);
  return out;
}

const SOURCE: Record<string, string> = {
  "SRD 5.1": "SRD",
  Homebrew: "Homebrew",
  fixture: "Fixture",
};
const label = (r: EntrySummary) => `${r.name} ${SOURCE[r.sourceLabel] ?? r.sourceLabel}`;
/** `cmp-homebrew`'s entries (part of `compendium`): not in the §13 ranking prototype. */
const CMP_HOMEBREW = ["Moonblade Shard", "CMP-SECRET-ITEM", "Fireball (house)", "Divine Fury"];
/** The table's "Hits": matching entries (group members counted), without `cmp-homebrew`. */
const hits = (rows: readonly EntrySummary[]) =>
  rows.filter((r) => !CMP_HOMEBREW.includes(r.name)).reduce((n, r) => n + (r.group?.count ?? 1), 0);

const DM_VIEW = (): EntryViewer => ({ role: "dm", campaignId: cid, playerId: null });
const entryId = (name: string, source: string | null) =>
  db
    .select()
    .from(compendiumEntry)
    .where(
      and(
        eq(compendiumEntry.name, name),
        source === null ? isNull(compendiumEntry.source) : eq(compendiumEntry.source, source),
      ),
    )
    .get()?.id as string;

describe("compendium search S4 (C-search)", () => {
  test("FR-CMP-33 ranking table: exact first rows and hits per query (DM unless marked)", async () => {
    const table: [string, string[], number][] = [
      [
        "goblin",
        [
          "Goblin SRD",
          "Goblin Fixture",
          "Hobgoblin SRD",
          "Worg SRD",
          "Bugbear SRD",
          "Deck of Illusions SRD",
        ],
        7,
      ],
      [
        "potion heal",
        [
          "Potion of Healing Homebrew",
          "Potion of Healing SRD",
          "Healing Draught Homebrew",
          "Potion of Poison SRD",
          "Robe of Useful Items SRD",
        ],
        5,
      ],
      ["hunters mark", ["Hunter's Mark SRD"], 1],
      ["HUNTER'S MARK", ["Hunter's Mark SRD"], 1],
      [
        "fire",
        [
          "Fireball SRD",
          "Fire Bolt SRD",
          "Fire Giant SRD",
          "Fire Storm SRD",
          "Fire Shield SRD",
          "Fire Elemental SRD",
        ],
        136,
      ],
      [
        "cure wound",
        [
          "Cure Wounds SRD",
          "Mass Cure Wounds SRD",
          "Couatl SRD",
          "Priest SRD",
          "Acolyte SRD",
          "Raise Dead SRD",
        ],
        18,
      ],
      [
        "potions",
        [
          "Potion of Healing Homebrew",
          "Potion of Speed SRD",
          "Potion of Flying SRD",
          "Potion of Growth SRD",
          "Potion of Poison SRD",
          "Potion of Healing SRD",
        ],
        24,
      ],
      ["a", ["Aid SRD", "Ape SRD", "Azer SRD", "Alarm SRD", "Ankheg SRD", "Augury SRD"], 816],
      ["zzqx", [], 0],
    ];
    for (const [q, first, n] of table) {
      const rows = await all({ q }, "dm");
      const shown = rows.filter((r) => !CMP_HOMEBREW.includes(r.name)).map(label);
      expect({ q, first: shown.slice(0, first.length), hits: hits(rows) }).toEqual({
        q,
        first,
        hits: n,
      });
    }
    // `cmp-homebrew`'s "Fireball (house)" is tier 1 like Fireball and ranks first (FR-CMP-38).
    expect((await page({ q: "fire" }, "dm")).results.slice(0, 2).map(label)).toEqual([
      "Fireball (house) Homebrew",
      "Fireball SRD",
    ]);
    // "a" reaches no text-only row: every result has an "a" in its name.
    expect((await all({ q: "a" }, "dm")).every((r) => r.name.toLowerCase().includes("a"))).toBe(
      true,
    );
    const player = await all({ q: "potion heal" }, "Player 1");
    expect({ first: player.map(label), hits: hits(player) }).toEqual({
      first: [
        "Potion of Healing SRD",
        "Healing Draught Homebrew",
        "Potion of Poison SRD",
        "Robe of Useful Items SRD",
      ],
      hits: 4,
    });
  });

  test('FR-CMP-33 "potion heal" → Potion of Healing first; FR-CMP-33 word order: "heal potion" returns the same list', async () => {
    const dm = await all({ q: "potion heal" }, "dm");
    expect(dm.slice(0, 2).map(label)).toEqual([
      "Potion of Healing Homebrew",
      "Potion of Healing SRD",
    ]);
    expect(await all({ q: "heal potion" }, "dm")).toEqual(dm);
    expect(await all({ q: "HEAL   Potion" }, "dm")).toEqual(dm);
    const p1 = await all({ q: "potion heal" }, "Player 1");
    expect(p1[0] && label(p1[0])).toBe("Potion of Healing SRD");
    expect(await all({ q: "heal potion" }, "Player 1")).toEqual(p1);
  });

  test("FR-CMP-38 SRD Goblin above fixture Goblin (search; lookup merge and Creatures order: client tests)", async () => {
    const cases: Record<string, string>[] = [
      { q: "goblin" },
      { q: "gob", kind: "monster" },
      { kind: "monster" },
    ];
    for (const params of cases) {
      const rows = (await all(params, "dm")).filter((r) => r.name === "Goblin");
      expect({ params, rows: rows.map((r) => r.sourceLabel) }).toEqual({
        params,
        rows: ["SRD 5.1", "fixture"],
      });
    }
  });

  test("FR-CMP-35/36 All tab default: one Ability Score Improvement row (12) among the first 50; sameAs → 12 members by line; sameAs + kind → invalid", async () => {
    const first = (await page({}, "dm")).results;
    const asi = first.filter((r) => r.name === "Ability Score Improvement");
    expect(asi).toHaveLength(1);
    expect(asi[0]?.group).toEqual({ count: 12 });
    expect(asi[0]?.line).toStartWith("12 entries · Barbarian, Bard, Cleric");
    expect(asi[0]?.line.length).toBeLessThanOrEqual(80);
    // Default list: by folded name (groups collapsed).
    const names = first.map((r) => r.name.toLowerCase());
    expect(names).toEqual([...names].sort());
    const members = (await page({ sameAs: asi[0]?.id as string }, "dm")).results;
    expect(members).toHaveLength(12);
    expect(members[0]?.line).toBe("Barbarian · 4th level");
    expect(members.map((m) => m.line)).toEqual(members.map((m) => m.line).sort());
    expect(members.some((m) => m.id === asi[0]?.id)).toBe(true);
    // Every tab: no second ASI row anywhere in the list.
    expect(
      (await all({}, "dm")).filter((r) => r.name === "Ability Score Improvement"),
    ).toHaveLength(1);
    expect(
      (await all({ kind: "feature" }, "Player 1")).filter(
        (r) => r.name === "Ability Score Improvement",
      ),
    ).toHaveLength(1);
    const bads: Record<string, string>[] = [
      { sameAs: asi[0]?.id as string, kind: "feature" },
      { sameAs: asi[0]?.id as string, cursor: "x" },
    ];
    for (const bad of bads) {
      const r = await get(`/search?${new URLSearchParams(bad)}`, "dm");
      expect([r.status, (JSON.parse(r.text) as { code: string }).code]).toEqual([400, "invalid"]);
    }
  });

  test("FR-CMP-35 group count = expanded rows: a query matching some members counts only those; one match → a plain row", async () => {
    for (const [q, n] of [
      ["ability bar", 2],
      ["ability score", 12],
      ["spellcasting", 7],
      ["extra attack", 5],
    ] as const) {
      const row = (await page({ q }, "dm")).results.find((r) => r.group !== undefined);
      expect({ q, count: row?.group?.count }).toEqual({ q, count: n });
      const members = (await page({ sameAs: row?.id as string, q }, "dm")).results;
      expect({ q, rows: members.length }).toEqual({ q, rows: n });
    }
    const fighter = (await page({ q: "ability fighter" }, "dm")).results.filter(
      (r) => r.name === "Ability Score Improvement",
    );
    expect(fighter.map((r) => [r.name, r.line, r.group])).toEqual([
      ["Ability Score Improvement", "Fighter · 4th level", undefined],
    ]);
  });

  test("FR-CMP-35 paging across a group: page size 3; pages joined = the full collapsed order, no repeat, no skip, the group row once", () => {
    const join = (params: Record<string, string>, size: number) => {
      const out: string[] = [];
      let cursor: string | undefined;
      do {
        const p = searchEntries(
          db,
          DM_VIEW(),
          SearchQuery.parse(cursor ? { ...params, cursor } : params),
          size,
        );
        out.push(...p.results.map((r) => r.id));
        cursor = p.nextCursor ?? undefined;
      } while (cursor);
      return out;
    };
    const cases: Record<string, string>[] = [{}, { q: "a" }, { kind: "feature" }, { q: "ability" }];
    for (const params of cases) {
      const small = join(params, 3);
      const big = join(params, 50);
      expect({ params, same: small.join() === big.join() }).toEqual({ params, same: true });
      expect(new Set(small).size).toBe(small.length);
    }
    const ab = join({ q: "ability" }, 3);
    expect(ab.filter((id) => id === entryId("Ability Score Improvement", "srd-5.1"))).toHaveLength(
      0,
    );
  });

  test("FR-CMP-14 player search never returns hidden entries: pages, groups, counts and sameAs", async () => {
    const hidden = entryId("Potion of Healing", null);
    const secret = entryId("CMP-SECRET-ITEM", null);
    const entryless = db
      .select({ id: entity.id })
      .from(entity)
      .where(and(isNull(entity.campaignId), eq(entity.source, "fixture")))
      .all()
      .map((r) => r.id);
    expect(entryless).toHaveLength(2);
    for (const who of ["Player 1", "Player 2"] as const) {
      for (const q of ["potion heal", "potion", "CMP-HB", "", "healing"]) {
        for (const kind of [undefined, "spell", "item", "condition", "feature", "monster"]) {
          const rows = await all(kind ? { q, kind } : { q }, who);
          for (const r of rows) expect(r.kind).not.toBe("monster");
          expect(rows.some((r) => r.id === hidden || r.id === secret)).toBe(false);
          // The hidden homebrew potion never groups or counts with anything.
          const potions = rows.filter((r) => r.name === "Potion of Healing");
          expect(potions.map((r) => [r.sourceLabel, r.group])).toEqual(
            potions.length ? [["SRD 5.1", undefined]] : [],
          );
        }
      }
      for (const id of [hidden, secret, ...entryless]) {
        expect((await page({ sameAs: id }, who)).results).toEqual([]);
        expect((await page({ sameAs: id, q: "potion" }, who)).results).toEqual([]);
      }
      for (const headers of [{}, { "If-None-Match": "*" }] as Record<string, string>[]) {
        expect((await get(`/entries/${hidden}`, who, headers)).status).toBe(404);
      }
    }
    // The DM sees it, grouped with nothing (different source from the SRD one).
    const dm = (await all({ q: "potion of healing" }, "dm")).filter(
      (r) => r.name === "Potion of Healing",
    );
    expect(dm.map((r) => [label(r), r.group])).toEqual([
      ["Potion of Healing Homebrew", undefined],
      ["Potion of Healing SRD", undefined],
    ]);
    const raw = playerBodies.join("\n");
    for (const s of [HB_POTION_MARKER, "CMP-SECRET-ITEM", hidden, secret, ...entryless]) {
      expect({ s, leaked: raw.includes(s) }).toEqual({ s, leaked: false });
    }
    expect(raw.includes('"kind":"monster"')).toBe(false);
  });

  test("FR-CMP-37 matcher parity: client nameTier = server tier for 40 SRD names × 10 queries", () => {
    const idx = searchIndex(db);
    const srd = idx.rows.filter((r) => r.source === "srd-5.1");
    const step = Math.floor(srd.length / 40);
    const sample = Array.from({ length: 40 }, (_, i) => srd[i * step]).filter(
      (r) => r !== undefined,
    );
    expect(sample).toHaveLength(40);
    const queries = [
      "goblin",
      "fire",
      "a",
      "cure wound",
      "potions",
      "hunter's mark",
      "dragon red",
      "of",
      "ball",
      "wolf dire",
    ];
    let named = 0;
    for (const row of sample) {
      for (const q of queries) {
        const words = queryWords(q);
        const server = rowTier(row, words);
        const client: number | null = nameTier(row.name, words);
        const expected: number | null = server !== null && server <= 3 ? server : null;
        expect({ name: row.name, q, client }).toEqual({ name: row.name, q, client: expected });
        if (client !== null) named++;
      }
    }
    expect(named).toBeGreaterThan(20);
  });

  test("FR-CMP-34 index freshness: put → found, delete → gone, re-import with an edited goblin → new name; timing over the full import (fail > 50 ms)", async () => {
    // Timing: build once, then p95 per search (logged; budget 5 ms, fails above 50 ms).
    dropSearchIndex(db);
    const t0 = performance.now();
    searchIndex(db);
    const build = performance.now() - t0;
    const lines: string[] = [];
    let worst = 0;
    for (const v of [DM_VIEW(), { role: "player" as const, campaignId: cid, playerId: "p" }]) {
      for (const q of ["", "a", "gob", "goblin", "fire", "potion heal", "the"]) {
        const times: number[] = [];
        for (let i = 0; i < 30; i++) {
          const s = performance.now();
          searchEntries(db, v, SearchQuery.parse({ q }));
          times.push(performance.now() - s);
        }
        times.sort((a, b) => a - b);
        const p95 = times[28] as number;
        worst = Math.max(worst, p95);
        lines.push(`${v.role} "${q}" median ${times[15]?.toFixed(2)} p95 ${p95.toFixed(2)} ms`);
      }
    }
    console.log(`FR-CMP-34 index build ${build.toFixed(1)} ms; ${lines.join("; ")}`);
    expect(worst).toBeLessThan(50);

    const dm = { "Content-Type": "application/json", ...auth("dm") };
    const created = await fetch(`${h.http}/api/compendium/entries`, {
      method: "POST",
      headers: dm,
      body: JSON.stringify({
        shared: true,
        entry: {
          kind: "item",
          name: "Qwyxl Lantern",
          facets: { category: "gear", attunement: false },
          body: { typeLine: "Adventuring gear", text: "Glows when the wind blows." },
        },
      }),
    });
    expect(created.status).toBe(201);
    const { entryId: zid } = (await created.json()) as { entryId: string };
    expect((await page({ q: "qwyxl" }, "Player 1")).results.map((r) => r.id)).toEqual([zid]);
    expect((await page({ q: "qwyxl wind" }, "dm")).results.map((r) => r.id)).toEqual([zid]);
    const del = await fetch(`${h.http}/api/compendium/entries/${zid}`, {
      method: "DELETE",
      headers: auth("dm"),
    });
    expect(del.status).toBeLessThan(300);
    expect((await page({ q: "qwyxl" }, "dm")).results).toEqual([]);

    const goblin = structuredClone(
      loadSrd51().responses.monsters?.find((m) => (m as { slug?: string }).slug === "goblin"),
    ) as Record<string, unknown>;
    goblin.name = "Goblin Grunt";
    h.s.commands.run(
      IMPORT_RECORDED,
      { source: { ...SRD_51_SOURCE }, version: "edited", responses: { monsters: [goblin] } },
      { actor: { role: "dm", playerId: null, campaignId: cid } },
    );
    const grunt = (await page({ q: "grunt" }, "dm")).results;
    expect(grunt.map((r) => [r.name, r.sourceLabel])).toEqual([["Goblin Grunt", "SRD 5.1"]]);
    expect(
      (await page({ q: "goblin", kind: "monster" }, "dm")).results.map(label).slice(0, 2),
    ).toEqual(["Goblin Fixture", "Goblin Grunt SRD"]);
  });
});
