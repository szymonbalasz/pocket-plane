// FR-NOTES-19 crash (build §1.2, #163 seam): `PP_TEST_CRASH=notes.push:before-commit` → the push
// is never accepted, and after the restart the editor resends it; `after-commit` → the change is
// stored though no ack or `notes.updates` went out, and after the restart the editor's re-open
// confirms it (its own update comes back), so it is never sent twice. Other editors resume too.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { NOTES_SHARED } from "@fixtures/units/linked-notes/notes-shared";
import type { Credential } from "@shared/protocol/frames";
import { eq } from "drizzle-orm";
import { armCrashHook } from "../../commands/crash";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { note, noteChange, player } from "../../db/schema";
import { startTestServer, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { loadText } from "./collab";
import { NOTES_COLLAB_INTENTS as C } from "./collab-commands";
import { Peer } from "./testing";

class Killed extends Error {}
const kill = () => {
  throw new Killed();
};

describe("linked-notes crash (N2)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let links: Record<string, string>;
  let ledger: string;
  const as = (name: string): Credential => ({ role: "player", token: links[name] as string });
  const row = () =>
    db.select().from(note).where(eq(note.id, ledger)).get() as typeof note.$inferSelect;
  const serverText = () => loadText(db, row()).toString();
  const count = (s: string, sub: string) => s.split(sub).length - 1;

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
    ledger = db
      .select()
      .from(note)
      .all()
      .find((n) => n.title === NOTES_SHARED.ledger)?.id as string;
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

  /** Restart on the same DB (sessions, bindings and caches gone); both editors reconnect, re-open. */
  async function restart(peers: Peer[], creds: Credential[]) {
    await h.restart();
    for (const [i, p] of peers.entries()) {
      p.c = await h.live(creds[i] as Credential);
      expect((await p.open()).mode).toBe("updates");
    }
  }

  test("FR-NOTES-19 before-commit: never accepted, nothing stored; after the restart the editor resends it", async () => {
    const creds = [as("Player 1"), as("Player 2")];
    const a = new Peer(await h.live(creds[0] as Credential), ledger, "k-a");
    const b = new Peer(await h.live(creds[1] as Credential), ledger, "k-b");
    await a.open();
    await b.open();
    const before = { version: row().version, rows: db.select().from(noteChange).all().length };
    a.type("end", " LOST?");
    armCrashHook({ point: "before-commit", target: C.push }, kill);
    const r = await a.answer(a.c.intent(C.push, a.pending()));
    armCrashHook(null);
    expect(r).toMatchObject({ type: "reject", code: "internal" });
    expect({ version: row().version, rows: db.select().from(noteChange).all().length }).toEqual(
      before,
    );
    await restart([a, b], creds);
    expect(a.pending()).not.toBeNull();
    await a.flush();
    await b.settle();
    expect(count(serverText(), " LOST?")).toBe(1);
    expect(a.doc).toBe(serverText());
    expect(b.doc).toBe(serverText());
    a.c.close();
    b.c.close();
  }, 30_000);

  test("FR-NOTES-19 after-commit: stored though unacknowledged; after the restart it is confirmed, never doubled", async () => {
    const creds = [as("Player 1"), as("Player 2")];
    const a = new Peer(await h.live(creds[0] as Credential), ledger, "k2-a");
    const b = new Peer(await h.live(creds[1] as Credential), ledger, "k2-b");
    await a.open();
    await b.open();
    const v = row().version;
    a.type(0, "KEPT ");
    armCrashHook({ point: "after-commit", target: C.push }, kill);
    const r = await a.answer(a.c.intent(C.push, a.pending()));
    armCrashHook(null);
    expect(r).toMatchObject({ type: "reject", code: "internal" });
    expect(row().version).toBe(v + 1);
    expect(serverText().startsWith("KEPT ")).toBe(true);
    // b typed meanwhile, unaware.
    b.type("end", " (b)");
    await restart([a, b], creds);
    expect(a.pending()).toBeNull(); // its own stored update came back as a confirmation
    await b.flush();
    await a.settle();
    expect(count(serverText(), "KEPT ")).toBe(1);
    expect(count(serverText(), " (b)")).toBe(1);
    expect(a.doc).toBe(serverText());
    expect(b.doc).toBe(serverText());
    a.c.close();
    b.c.close();
  }, 30_000);
});
