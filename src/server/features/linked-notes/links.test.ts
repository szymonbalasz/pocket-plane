// NOTES N5 server (build §1.2): `note_link` rows follow the text (push, fixtures' seed), the boot
// rebuild for notes written before N5, backlinks in the open result, and `notes.backlinks`
// refreshed after a push that changes links, a rename, delete or restore, sent only where a list
// changed and never to another campaign (FR-NOTES-07, -12).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { NOTES_SHARED } from "@fixtures/units/linked-notes/notes-shared";
import {
  NOTES_BACKLINKS_SIGNAL,
  type NoteBacklinksSignal,
  type OpenNoteResult,
} from "@shared/linked-notes/collab";
import type { Credential } from "@shared/protocol/frames";
import { eq } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { campaign, note, noteLink, player } from "../../db/schema";
import { startTestServer, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { NOTES_INTENTS as N } from "./commands";
import { backlinksOf, rebuildLinks, storedFolds } from "./links";
import { Peer } from "./testing";

const DM: Credential = { role: "dm", secret: TEST_SECRET };

describe("linked-notes links and backlinks (N5)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let links: Record<string, string>;
  let ids: Record<string, string>;
  let main: string;
  const as = (name: string): Credential => ({ role: "player", token: links[name] as string });
  const backlinkSignals = (p: Peer) =>
    p.signals
      .filter((x) => x.name === NOTES_BACKLINKS_SIGNAL)
      .map((x) => (x.data as NoteBacklinksSignal).backlinks.map((b) => b.title));

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
    main = db
      .select()
      .from(campaign)
      .all()
      .find((c) => c.name === "Fixture Campaign")?.id as string;
    ids = Object.fromEntries(
      db
        .select()
        .from(note)
        .all()
        .filter((n) => n.campaignId === main)
        .map((n) => [n.title, n.id]),
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

  test("FR-NOTES-07 the fixtures' text has its link rows; the boot rebuild restores missing rows and is idempotent", () => {
    const ledger = ids[NOTES_SHARED.ledger] as string;
    expect(storedFolds(db, ledger)).toEqual(["duke varen", "quest log"]);
    expect(storedFolds(db, ids[NOTES_SHARED.duke] as string)).toEqual(["burnt ledger"]);
    // A DB from before N5: no rows. The start-up rebuild writes them from the text.
    db.delete(noteLink).run();
    expect(storedFolds(db, ledger)).toEqual([]);
    expect(rebuildLinks(db)).toBeGreaterThanOrEqual(3);
    expect(storedFolds(db, ledger)).toEqual(["duke varen", "quest log"]);
    expect(rebuildLinks(db)).toBe(0);
  });

  test("FR-NOTES-12 open returns the live notes linking to the note, by title, itself left out", async () => {
    const p = new Peer(await h.live(as("Player 1")), ids[NOTES_SHARED.ledger] as string, "bl-a");
    const r = (await p.open()) as OpenNoteResult;
    expect(r.backlinks.map((b) => b.title)).toEqual([NOTES_SHARED.duke, NOTES_SHARED.quest]);
    expect(backlinksOf(db, main, ids[NOTES_SHARED.ledger] as string)).toEqual(r.backlinks);
    p.c.close();
  });

  test("FR-NOTES-07 FR-NOTES-12 a push adding a link writes its row and refreshes the target's backlinks, only where they changed; rename, delete, restore too", async () => {
    const duke = ids[NOTES_SHARED.duke] as string;
    const quest = ids[NOTES_SHARED.quest] as string;
    const reader = new Peer(await h.live(as("Player 2")), duke, "bl-reader");
    const opened = (await reader.open()) as OpenNoteResult;
    expect(opened.backlinks.map((b) => b.title)).toEqual([NOTES_SHARED.ledger]);
    const writer = new Peer(await h.live(as("Player 1")), quest, "bl-writer");
    await writer.open();
    // Quest log gains a link to Duke Varen.
    writer.type("end", "\nAsk [[duke varen|the Duke]] about it.");
    await writer.flush();
    await reader.settle();
    await writer.settle();
    expect(storedFolds(db, quest)).toEqual(["burnt ledger", "duke varen"]);
    expect(backlinkSignals(reader).at(-1)).toEqual([NOTES_SHARED.ledger, NOTES_SHARED.quest]);
    expect(backlinkSignals(writer)).toEqual([]); // Quest log's own list didn't change
    // Typing that doesn't touch a link sends nothing more.
    const n = backlinkSignals(reader).length;
    writer.type("end", " Soon.");
    await writer.flush();
    await reader.settle();
    expect(backlinkSignals(reader).length).toBe(n);

    const dm = await h.live(DM);
    const ack = async (name: string, payload: unknown) => {
      const id = dm.intent(name, payload);
      for (;;) {
        const f = await dm.next(undefined, 3000);
        if ((f.type === "ack" || f.type === "reject") && f.intentId === id) return f;
      }
    };
    await ack(N.rename, { noteId: quest, title: "Quest journal" });
    await reader.settle();
    expect(backlinkSignals(reader).at(-1)).toEqual([NOTES_SHARED.ledger, "Quest journal"]);
    await ack(N.delete, { noteId: quest });
    await reader.settle();
    expect(backlinkSignals(reader).at(-1)).toEqual([NOTES_SHARED.ledger]);
    await ack(N.restore, { noteId: quest });
    await reader.settle();
    expect(backlinkSignals(reader).at(-1)).toEqual([NOTES_SHARED.ledger, "Quest journal"]);
    // Nothing about these notes went to the other campaign's rows or anyone else's list.
    expect(reader.c.raw()).not.toContain("CANARY-OTHER");
    for (const p of [reader, writer]) p.c.close();
    dm.close();
    expect(db.select().from(noteLink).where(eq(noteLink.noteId, quest)).all()).toHaveLength(2);
  });
});
