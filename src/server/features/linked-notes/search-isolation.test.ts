// NOTES build §1.2 campaign isolation, the search part (slice N4): REST search with each token
// (the DM, player-1, player-2, and the Second Player) before and after a switch to
// `campaign-second` and back. Checks: `CANARY-OTHER` is never a hit or in a response in the main
// campaign, and no main-campaign title or body reaches the second campaign's answers; a token
// whose campaign isn't active gets 409. Timing: a search reads only its campaign's live notes
// (`scanned`, and the cache never holds another campaign's note), so another campaign's notes,
// however many and however large, cost it nothing that a test could measure.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { NOTES_BINNED } from "@fixtures/units/linked-notes/notes-binned";
import { NOTES_SECOND } from "@fixtures/units/linked-notes/notes-second-campaign";
import { NOTES_SHARED } from "@fixtures/units/linked-notes/notes-shared";
import { NoteSearchResponse } from "@shared/linked-notes/search";
import { fold } from "@shared/search/match";
import { and, eq, isNull } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { campaign, note, player } from "../../db/schema";
import type { Actor } from "../../events/types";
import { startTestServer, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { noteSearchIndex, runNoteSearch } from "./search";

const MAIN_TEXT = [
  NOTES_SHARED.ledgerBody,
  NOTES_SHARED.questBody,
  NOTES_SHARED.dukeBody,
  NOTES_SHARED.quest,
  NOTES_SHARED.duke,
  NOTES_BINNED.body,
  NOTES_BINNED.title,
];
const QUERIES = ["canary", "canary other", "ledger", "burnt ledger", "duke", "rumour", "quest"];

describe("FR-NOTES-22 search campaign isolation", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let links: Record<string, string>;
  let main: string;
  let second: string;

  beforeAll(async () => {
    const loaded = await loadBundle("notes", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    links = Object.fromEntries(
      db
        .select()
        .from(player)
        .all()
        .map((p) => [p.name, p.linkToken]),
    );
    const camps = Object.fromEntries(
      db
        .select()
        .from(campaign)
        .all()
        .map((c) => [c.name, c.id]),
    );
    main = camps["Fixture Campaign"] as string;
    second = camps["Second Campaign"] as string;
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

  const dmIn = (cid: string): Actor => ({ role: "dm", playerId: null, campaignId: cid });
  const auths = () => ({
    dm: `Bearer ${TEST_SECRET}`,
    p1: `Player ${links["Player 1"]}`,
    p2: `Player ${links["Player 2"]}`,
    second: `Player ${links["Second Player"]}`,
  });
  const ids = (cid: string) =>
    db
      .select({ id: note.id })
      .from(note)
      .where(eq(note.campaignId, cid))
      .all()
      .map((r) => r.id);
  const secondFixtureId = () =>
    db
      .select({ id: note.id })
      .from(note)
      .where(and(eq(note.campaignId, second), eq(note.title, NOTES_SECOND.title)))
      .get()?.id as string;
  const liveCount = (cid: string) =>
    db
      .select({ id: note.id })
      .from(note)
      .where(and(eq(note.campaignId, cid), isNull(note.deletedAt)))
      .all().length;

  async function get(q: string, auth: string): Promise<{ status: number; text: string }> {
    const r = await fetch(`${h.http}/api/notes/search?q=${encodeURIComponent(q)}`, {
      headers: { Authorization: auth },
    });
    return { status: r.status, text: await r.text() };
  }

  /** Every query with `auth`: 200, only `cid`'s notes, nothing of `forbidden` in the bytes. */
  async function onlyFrom(auth: string, cid: string, forbidden: readonly string[]) {
    const own = new Set(ids(cid));
    for (const q of QUERIES) {
      const r = await get(q, auth);
      expect(r.status).toBe(200);
      const body = NoteSearchResponse.parse(JSON.parse(r.text));
      for (const hit of body.results) expect(own.has(hit.id)).toBe(true);
      for (const f of forbidden) expect([q, r.text.includes(f)]).toEqual([q, false]);
    }
  }

  test("FR-NOTES-22 each token searches its own campaign only, before and after a switch", async () => {
    const a = auths();
    const secondIds = ids(second);
    expect(secondIds).toHaveLength(1);
    // Main campaign active: the canary never shows, nor the second campaign's note ID.
    for (const auth of [a.dm, a.p1, a.p2]) {
      await onlyFrom(auth, main, [NOTES_SECOND.body, ...secondIds]);
      const canary = NoteSearchResponse.parse(JSON.parse((await get("canary", auth)).text));
      expect(canary.results).toEqual([]);
    }
    // A token of an inactive campaign: 409, nothing else.
    const off = await get("ledger", a.second);
    expect(off.status).toBe(409);
    expect(off.text).not.toContain(NOTES_SHARED.ledger);

    // Switch: the DM bearer and the Second Player see only the second campaign.
    h.s.commands.run("campaign.activate", { id: second }, { actor: dmIn(main) });
    const mainIds = ids(main);
    for (const auth of [a.dm, a.second]) {
      await onlyFrom(auth, second, [...MAIN_TEXT, ...mainIds]);
      const canary = NoteSearchResponse.parse(JSON.parse((await get("canary", auth)).text));
      expect(canary.results.map((r) => r.id)).toEqual(secondIds);
      expect(canary.results[0]?.snippet).toBe(NOTES_SECOND.body);
    }
    for (const auth of [a.p1, a.p2]) expect((await get("ledger", auth)).status).toBe(409);

    // And back.
    h.s.commands.run("campaign.activate", { id: main }, { actor: dmIn(second) });
    for (const auth of [a.dm, a.p1, a.p2])
      await onlyFrom(auth, main, [NOTES_SECOND.body, ...secondIds]);
    expect((await get("canary", a.second)).status).toBe(409);
  });

  test("FR-NOTES-22 a search reads only its campaign: another campaign's size costs it nothing", async () => {
    const before = liveCount(main);
    const scan = (q: string) => runNoteSearch(h.s, main, q).scanned;
    expect(scan("canary")).toBe(before);
    expect(scan("zzzz")).toBe(before);

    // Grow the second campaign by 200 notes of 32 KiB, every one a canary.
    const big = `CANARY-OTHER ${"canary ".repeat(4600)}`.slice(0, 32 * 1024);
    const at = "2026-03-01T00:00:00.000Z";
    for (let i = 0; i < 200; i++) {
      db.insert(note)
        .values({
          id: `iso-second-${i}`,
          campaignId: second,
          title: `Canary ${i}`,
          titleFold: fold(`Canary ${i}`),
          createdByRole: "dm",
          createdAt: at,
          updatedAt: at,
          updatedByRole: "dm",
          body: big,
          bodyFold: fold(big),
        })
        .run();
    }
    const idx = noteSearchIndex(h.s);
    for (const q of ["canary", "zzzz", "ledger"]) {
      const r = runNoteSearch(h.s, main, q);
      // The same notes read whatever the query or the other campaign holds.
      expect([q, r.scanned]).toEqual([q, before]);
      expect(r.response.results.some((x) => x.title.startsWith("Canary "))).toBe(false);
    }
    // None of the other campaign's new notes was ever read into the search cache (its one
    // fixture note is there only from the searches made while it was active, above).
    const own = new Set(ids(main));
    for (const [id, e] of idx.entries) {
      expect(id.startsWith("iso-second-")).toBe(false);
      if (!own.has(id)) expect([id, e.campaignId]).toEqual([secondFixtureId(), second]);
    }
    // The REST answer for the canary is byte-for-byte the empty one.
    expect((await get("canary", auths().p1)).text).toBe(
      JSON.stringify({ results: [], more: false }),
    );
  });
});
