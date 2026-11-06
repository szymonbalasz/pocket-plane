// NOTES N6 (FR-NOTES-11) over real sockets on the `notes` bundle: a rename rewrites `[[Old]]` /
// `[[Old|label]]` in every linking note, binned ones included, as one server change each (editor
// "server": a `note_change` row, the version + 1, link rows, `NoteEdited`); an open editor typing
// meanwhile gets it in `notes.updates`, rebases and converges; a clash refuses before anything is
// written; a case-only rename rewrites nothing; `PP_TEST_CRASH` before / after the commit leaves
// all of it or none.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { NOTES_SHARED } from "@fixtures/units/linked-notes/notes-shared";
import { NOTE_TITLE_CLASH } from "@shared/linked-notes/schemas";
import { NoteSearchResponse } from "@shared/linked-notes/search";
import type { Credential } from "@shared/protocol/frames";
import { asc, eq } from "drizzle-orm";
import { armCrashHook } from "../../commands/crash";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { campaign, note, noteChange, player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { loadText } from "./collab";
import { NOTES_INTENTS as N } from "./commands";
import { storedFolds } from "./links";
import { SERVER_EDITOR } from "./rename";
import { Peer } from "./testing";

const DM: Credential = { role: "dm", secret: TEST_SECRET };
class Killed extends Error {}

describe("linked-notes rename rewrite (N6)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let links: Record<string, string>;
  let ids: Record<string, string>;
  const as = (name: string): Credential => ({ role: "player", token: links[name] as string });
  const row = (id: string) =>
    db.select().from(note).where(eq(note.id, id)).get() as typeof note.$inferSelect;
  const text = (id: string) => loadText(db, row(id)).toString();
  const lastChange = (id: string) =>
    db
      .select()
      .from(noteChange)
      .where(eq(noteChange.noteId, id))
      .orderBy(asc(noteChange.version))
      .all()
      .at(-1);
  const changeCount = () => db.select().from(noteChange).all().length;
  async function ask(c: TestClient, name: string, payload: unknown) {
    const id = c.intent(name, payload);
    for (;;) {
      const f = await c.next(undefined, 3000);
      if ((f.type === "ack" || f.type === "reject") && f.intentId === id) return f;
    }
  }

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
    const main = db
      .select()
      .from(campaign)
      .all()
      .find((c) => c.name === "Fixture Campaign")?.id;
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
    armCrashHook(null);
    await h.stop();
    closeDb(db);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  });

  test("FR-NOTES-11 a rename rewrites every link to the old title, binned notes included, labels kept, one server change each", async () => {
    const dm = await h.live(DM);
    // A binned note linking to Burnt Ledger (folded spelling).
    const scratch = new Peer(await h.live(as("Player 2")), "", "rn-scratch");
    const made = await ask(scratch.c, N.create, { title: "Scrap", category: "other" });
    const scrap = (made as { result: { noteId: string } }).result.noteId;
    const s2 = new Peer(scratch.c, scrap, "rn-scrap");
    await s2.open();
    s2.type(0, "See [[burnt ledger]] again.");
    await s2.flush();
    await ask(dm, N.delete, { noteId: scrap });

    const ledger = ids[NOTES_SHARED.ledger] as string;
    const duke = ids[NOTES_SHARED.duke] as string;
    const quest = ids[NOTES_SHARED.quest] as string;
    const before = {
      duke: row(duke).version,
      quest: row(quest).version,
      scrap: row(scrap).version,
    };
    expect(await ask(dm, N.rename, { noteId: ledger, title: "Ash Ledger" })).toMatchObject({
      type: "ack",
    });

    expect(text(duke)).toBe("Keeps [[Ash Ledger|the ledger]] close.");
    expect(text(quest)).toBe("# Quest log\n- Recover the [[Ash Ledger]]");
    expect(text(scrap)).toBe("See [[Ash Ledger]] again.");
    expect({
      duke: row(duke).version,
      quest: row(quest).version,
      scrap: row(scrap).version,
    }).toEqual({
      duke: before.duke + 1,
      quest: before.quest + 1,
      scrap: before.scrap + 1,
    });
    for (const id of [duke, quest, scrap]) {
      expect(lastChange(id)?.clientId).toBe(SERVER_EDITOR);
      expect(storedFolds(db, id)).toContain("ash ledger");
      expect(storedFolds(db, id)).not.toContain("burnt ledger");
    }
    expect(text(ledger)).toBe(NOTES_SHARED.ledgerBody); // it doesn't link to itself

    // A clash refuses before anything is written.
    const n = changeCount();
    expect(await ask(dm, N.rename, { noteId: duke, title: "ash-ledger" })).toMatchObject({
      type: "reject",
      code: "conflict",
      message: NOTE_TITLE_CLASH,
    });
    expect(changeCount()).toBe(n);
    // A case-only rename keeps the folded title: links still resolve, nothing rewritten.
    await ask(dm, N.rename, { noteId: ledger, title: "ASH LEDGER" });
    expect(changeCount()).toBe(n);
    expect(text(quest)).toBe("# Quest log\n- Recover the [[Ash Ledger]]");
    for (const c of [dm, scratch.c]) c.close();
  });

  test("FR-NOTES-11 FR-NOTES-14 an editor typing in a linking note gets the rewrite as an update, rebases and loses nothing", async () => {
    const quest = ids[NOTES_SHARED.quest] as string;
    const ledger = ids[NOTES_SHARED.ledger] as string;
    const p1 = new Peer(await h.live(as("Player 1")), quest, "rn-p1");
    const p2 = new Peer(await h.live(as("Player 2")), quest, "rn-p2");
    await p1.open();
    await p2.open();
    const dm = await h.live(DM);
    // P1 types (unconfirmed) while the DM renames the target.
    p1.type("end", " soon");
    const renamed = ask(dm, N.rename, { noteId: ledger, title: "Cinder Book" });
    p1.type(0, ">> ");
    expect(await renamed).toMatchObject({ type: "ack" });
    await p1.flush();
    await p2.settle();
    await p1.settle();
    const server = text(quest);
    expect(server).toBe(">> # Quest log\n- Recover the [[Cinder Book]] soon");
    expect(p1.doc).toBe(server);
    expect(p2.doc).toBe(server);
    expect(
      p2.signals.some(
        (s) =>
          (s.data as { updates?: { clientId: string }[] }).updates?.[0]?.clientId === SERVER_EDITOR,
      ),
    ).toBe(true);
    for (const c of [p1.c, p2.c, dm]) c.close();
  });

  test("FR-NOTES-11 FR-NOTES-19 crash: before the commit nothing of the rename is written; after it, all of it", async () => {
    const ledger = ids[NOTES_SHARED.ledger] as string;
    const quest = ids[NOTES_SHARED.quest] as string;
    const duke = ids[NOTES_SHARED.duke] as string;
    const snapshot = () => ({
      title: row(ledger).title,
      quest: text(quest),
      duke: text(duke),
      changes: changeCount(),
    });
    const kill = () => {
      throw new Killed();
    };
    let dm = await h.live(DM);
    const before = snapshot();
    armCrashHook({ point: "before-commit", target: N.rename }, kill);
    expect(await ask(dm, N.rename, { noteId: ledger, title: "Ember Tome" })).toMatchObject({
      type: "reject",
      code: "internal",
    });
    armCrashHook(null);
    await h.restart();
    expect(snapshot()).toEqual(before);

    dm = await h.live(DM);
    armCrashHook({ point: "after-commit", target: N.rename }, kill);
    await ask(dm, N.rename, { noteId: ledger, title: "Ember Tome" });
    armCrashHook(null);
    await h.restart();
    const after = snapshot();
    expect(after.title).toBe("Ember Tome");
    expect(after.quest).toContain("[[Ember Tome]]");
    expect(after.duke).toContain("[[Ember Tome|the ledger]]");
    expect(after.changes).toBe(before.changes + 3); // Duke Varen, Quest log and the binned Scrap
    // An editor opening after the restart gets the rewritten text.
    const p = new Peer(await h.live(as("Player 1")), quest, "rn-after");
    await p.open();
    expect(p.doc).toBe(after.quest);
    p.c.close();
  }, 30_000);

  test("FR-NOTES-11 FR-NOTES-22 search follows a rename's rewrite: the new title is found in linking notes, the old one isn't", async () => {
    const search = async (q: string) => {
      const r = await fetch(`${h.http}/api/notes/search?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${TEST_SECRET}` },
      });
      expect(r.status).toBe(200);
      return NoteSearchResponse.parse(await r.json())
        .results.map((x) => x.title)
        .sort();
    };
    const ledger = row(ids[NOTES_SHARED.ledger] as string).title; // renamed by the tests above
    // Warm the cache first: Burnt Ledger's body links "[[Duke Varen]]".
    expect(await search("Duke Varen")).toEqual([NOTES_SHARED.duke, ledger].sort());
    expect(await search("Lord Ashby")).toEqual([]);
    const dm = await h.live(DM);
    await ask(dm, N.rename, { noteId: ids[NOTES_SHARED.duke] as string, title: "Lord Ashby" });
    expect(await search("Lord Ashby")).toEqual(["Lord Ashby", ledger].sort());
    expect(await search("Duke Varen")).toEqual([]);
    dm.close();
  });
});
