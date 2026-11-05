// FR-NOTES-22 search over REST (slice N4), on the `notes` bundle over a real server: titles and
// bodies, binned notes skipped, the live text of open notes (and of notes closed before their next
// fold), 50 results at most, auth like compendium search. Campaign isolation: ./search-isolation.test.ts.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { NOTES_BINNED } from "@fixtures/units/linked-notes/notes-binned";
import { NOTES_SHARED } from "@fixtures/units/linked-notes/notes-shared";
import { NOTES_FOLD_EVERY } from "@shared/linked-notes/collab";
import { NOTE_SEARCH_LIMIT, NoteSearchResponse } from "@shared/linked-notes/search";
import type { Credential } from "@shared/protocol/frames";
import { and, eq } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { campaign, note, player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { CMP_CACHE_CONTROL } from "../compendium/auth";
import { NOTES_COLLAB_INTENTS as C } from "./collab-commands";
import { NOTES_INTENTS as N } from "./commands";
import { Peer } from "./testing";

const DM: Credential = { role: "dm", secret: TEST_SECRET };

describe("FR-NOTES-22 note search", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let links: Record<string, string>;
  let main: string;

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
    main = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
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

  const idOf = (title: string) =>
    db
      .select({ id: note.id })
      .from(note)
      .where(and(eq(note.campaignId, main), eq(note.title, title)))
      .get()?.id as string;

  async function raw(q: string | null, auth: string | null) {
    const url = `${h.http}/api/notes/search${q === null ? "" : `?q=${encodeURIComponent(q)}`}`;
    return fetch(url, { headers: auth ? { Authorization: auth } : {} });
  }
  async function search(q: string, auth = `Bearer ${TEST_SECRET}`) {
    const r = await raw(q, auth);
    expect(r.status).toBe(200);
    return NoteSearchResponse.parse(await r.json());
  }
  const titles = async (q: string, auth?: string) =>
    (await search(q, auth)).results.map((r) => r.title);

  async function answer(c: TestClient, intentId: string) {
    for (;;) {
      const f = await c.next(undefined, 3000);
      if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
    }
  }
  const ok = async (c: TestClient, intentId: string) => {
    const a = await answer(c, intentId);
    expect(a.type === "reject" ? JSON.stringify(a) : a.type).toBe("ack");
    return (a as { result?: unknown }).result;
  };

  test("FR-NOTES-22 titles and bodies, best tier first; the same for the DM and each player", async () => {
    for (const auth of [
      `Bearer ${TEST_SECRET}`,
      `Player ${links["Player 1"]}`,
      `Player ${links["Player 2"]}`,
    ]) {
      // "Burnt Ledger" by title; Quest log and Duke Varen link it in their bodies.
      expect(await titles("ledger", auth)).toEqual([
        NOTES_SHARED.ledger,
        NOTES_SHARED.duke,
        NOTES_SHARED.quest,
      ]);
      const office = await search("office", auth);
      expect(office.results).toEqual([
        {
          id: idOf(NOTES_SHARED.ledger),
          title: NOTES_SHARED.ledger,
          // Links read as their chips; the matching word marked.
          snippet: "Found in Duke Varen's office. Roll 2d6 to search it. See Quest log.",
          marks: [[22, 28]],
        },
      ]);
      expect(office.more).toBe(false);
      // A title hit whose body lacks the word: the body's first line, plain.
      const duke = (await search("duke", auth)).results.find((r) => r.title === NOTES_SHARED.duke);
      expect(duke).toMatchObject({ snippet: "Keeps the ledger close.", marks: [] });
      // Every word must match the title or the body.
      expect(await titles("ledger office", auth)).toEqual([NOTES_SHARED.ledger]);
      expect(await titles("nothing-here", auth)).toEqual([]);
    }
  });

  test("FR-NOTES-22 an empty or blank query finds nothing; a long one is invalid", async () => {
    expect(await search("")).toEqual({ results: [], more: false });
    expect(await search("  ' -- ")).toEqual({ results: [], more: false });
    expect((await raw("x".repeat(101), `Bearer ${TEST_SECRET}`)).status).toBe(400);
    expect((await raw(null, `Bearer ${TEST_SECRET}`)).status).toBe(400);
  });

  test("FR-NOTES-22 auth like compendium search, checked on every call; no caching", async () => {
    expect((await raw("ledger", null)).status).toBe(401);
    expect((await raw("ledger", "Bearer wrong-secret-xyz")).status).toBe(401);
    expect((await raw("ledger", "Player nope")).status).toBe(401);
    const r = await raw("ledger", `Player ${links["Player 1"]}`);
    expect(r.headers.get("Cache-Control")).toBe(CMP_CACHE_CONTROL);
  });

  test("FR-NOTES-04 / -22 a binned note is never a hit; restored, it is again", async () => {
    expect(await titles("rumour")).toEqual([]);
    expect(await titles("old rumours")).toEqual([]);
    const dm = await h.live(DM);
    const id = idOf(NOTES_BINNED.title);
    await ok(dm, dm.intent(N.restore, { noteId: id }));
    expect(await titles("rumour")).toEqual([NOTES_BINNED.title]);
    await ok(dm, dm.intent(N.delete, { noteId: id }));
    expect(await titles("rumour")).toEqual([]);
    dm.close();
  });

  test("FR-NOTES-22 a rename is searched by its new title at once", async () => {
    const dm = await h.live(DM);
    const id = idOf(NOTES_SHARED.quest);
    await ok(dm, dm.intent(N.rename, { noteId: id, title: "Quest journal" }));
    // N6: Burnt Ledger's `[[Quest log]]` was rewritten to the new title, so it is found too.
    expect((await titles("journal")).sort()).toEqual([NOTES_SHARED.ledger, "Quest journal"]);
    await ok(dm, dm.intent(N.rename, { noteId: id, title: NOTES_SHARED.quest }));
    expect(await titles("journal")).toEqual([]);
    dm.close();
  });

  test("FR-NOTES-22 open notes are searched by their live text; closed before a fold, too", async () => {
    const p1 = await h.live({ role: "player", token: links["Player 1"] as string });
    const id = idOf(NOTES_SHARED.duke);
    const peer = new Peer(p1, id, "search-p1");
    await peer.open();
    peer.type("end", " A wyvern nests on the tower.");
    await peer.flush();
    const row = db.select().from(note).where(eq(note.id, id)).get();
    expect(row?.version).toBeGreaterThan(row?.bodyVersion as number); // not folded yet
    expect(row?.bodyFold).not.toContain("wyvern");
    const open = await search("wyvern");
    expect(open.results.map((r) => r.title)).toEqual([NOTES_SHARED.duke]);
    expect(open.results[0]?.snippet).toContain("A wyvern nests on the tower.");

    // Typed again: the next search sees the new text (the cached words follow the version).
    peer.type("end", " Its rider is Captain Ilsk.");
    await peer.flush();
    expect(await titles("ilsk")).toEqual([NOTES_SHARED.duke]);

    // Closed by everyone before the next fold: the body plus the stored change rows.
    await ok(p1, p1.intent(C.close, { noteId: id }));
    p1.close();
    expect(await titles("wyvern ilsk")).toEqual([NOTES_SHARED.duke]);
    const after = await search("rider");
    expect(after.results[0]?.snippet).toContain("Its rider is Captain Ilsk.");

    // Removed text stops matching.
    const p1b = await h.live({ role: "player", token: links["Player 1"] as string });
    const again = new Peer(p1b, id, "search-p1b");
    await again.open();
    const doc = again.doc;
    const at = doc.indexOf(" Its rider");
    if (!again.state) throw new Error("not open");
    again.state = again.state.update({ changes: { from: at, to: doc.length } }).state;
    await again.flush();
    expect(await titles("ilsk")).toEqual([]);
    expect(await titles("wyvern")).toEqual([NOTES_SHARED.duke]);
    await ok(p1b, p1b.intent(C.close, { noteId: id }));
    p1b.close();
  });

  test("FR-NOTES-22 after a fold the stored body is searched", async () => {
    const dm = await h.live(DM);
    const id = idOf(NOTES_SHARED.ledger);
    const peer = new Peer(dm, id, "search-dm");
    await peer.open();
    for (let i = 0; i < NOTES_FOLD_EVERY; i++) {
      peer.type("end", i === 0 ? " basilisk" : ".");
      await peer.flush();
    }
    const row = db.select().from(note).where(eq(note.id, id)).get();
    expect(row?.bodyFold).toContain("basilisk");
    await ok(dm, dm.intent(C.close, { noteId: id }));
    dm.close();
    expect(await titles("basilisk")).toEqual([NOTES_SHARED.ledger]);
  });

  test("FR-NOTES-22 at most 50 results, `more` set when there are others", async () => {
    const dm = await h.live(DM);
    for (let i = 0; i < NOTE_SEARCH_LIMIT + 5; i++)
      await ok(dm, dm.intent(N.create, { title: `Bulk ${String(i).padStart(2, "0")}` }));
    const r = await search("bulk");
    expect(r.results).toHaveLength(NOTE_SEARCH_LIMIT);
    expect(r.more).toBe(true);
    // Same tier: by title.
    expect(r.results[0]?.title).toBe("Bulk 00");
    expect(r.results[49]?.title).toBe("Bulk 49");
    expect((await search("bulk 07")).results.map((x) => x.title)).toEqual(["Bulk 07"]);
    dm.close();
  });
});
