// NOTES N2 unit (build §1.2): the authority in-process, no sockets. Applying a change at a
// version; a stale push gets the updates since; `clientId` binding per connection; the 8-open
// cap; the 32 KiB limit; every accepted push one `note_change` row; folding every 100 changes;
// pruning to 1,000 rows / 1 MiB; the text rebuilt from the DB equals the live one.
import { beforeEach, describe, expect, test } from "bun:test";
import { ChangeSet, Text } from "@codemirror/state";
import {
  NOTE_BAD_CHANGE,
  NOTE_EDITOR_IN_USE,
  NOTE_EDITOR_MISMATCH,
  NOTE_NOT_OPEN,
  NOTE_OPEN_LIMIT,
  NOTES_FOLD_EVERY,
  NOTES_KEEP_ROWS,
  NOTES_OPEN_MAX,
  type NoteUpdate,
  type OpenNoteResult,
  type PushNoteResult,
} from "@shared/linked-notes/collab";
import { NOTE_BODY_MAX_BYTES, NOTE_BODY_TOO_BIG } from "@shared/linked-notes/schemas";
import { eq } from "drizzle-orm";
import { manualClock } from "../../commands/context";
import type { CommandError } from "../../commands/errors";
import { eventLog, note, noteChange } from "../../db/schema";
import type { Actor } from "../../events/types";
import type { Services } from "../../services";
import { seedSyncProbe } from "../../testing/seed";
import { createTestServices } from "../../testing/services";
import { loadText, updatesSince } from "./collab";
import { NOTES_COLLAB_INTENTS as C } from "./collab-commands";
import { createNote, deleteNote } from "./commands";

let s: Services;
let dm: Actor;
let p1: Actor;
let p2: Actor;
let noteId: string;
let clock: ReturnType<typeof manualClock>;

beforeEach(() => {
  clock = manualClock(Date.parse("2026-03-01T00:00:00Z"));
  s = createTestServices({ clock });
  const t = seedSyncProbe(s);
  dm = { role: "dm", playerId: null, campaignId: t.campaignId };
  p1 = { role: "player", playerId: t.p1.id, campaignId: t.campaignId };
  p2 = { role: "player", playerId: t.p2.id, campaignId: t.campaignId };
  noteId = (
    s.commands.run(createNote, { title: "Burnt Ledger" }, { actor: p1 }) as { noteId: string }
  ).noteId;
});

const run = (name: string, input: unknown, actor: Actor, conn: string | null) =>
  s.commands.run(name, input, { actor, originConnId: conn });
const open = (actor: Actor, conn: string, clientId: string, version?: number, id = noteId) =>
  run(
    C.open,
    { noteId: id, clientId, ...(version === undefined ? {} : { version }) },
    actor,
    conn,
  ) as OpenNoteResult;
const push = (actor: Actor, conn: string, version: number, updates: NoteUpdate[]) =>
  run(C.push, { noteId, version, updates }, actor, conn) as PushNoteResult;
/** One update inserting `text` at `at` into a doc of `len` characters. */
const ins = (clientId: string, len: number, at: number, text: string): NoteUpdate => ({
  clientId,
  changes: ChangeSet.of({ from: at, insert: text }, len).toJSON() as NoteUpdate["changes"],
});

function refusal(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    return { code: (e as CommandError).code, message: (e as CommandError).message };
  }
  throw new Error("expected a refusal");
}
const row = () => s.db.select().from(note).where(eq(note.id, noteId)).get();
const changeRows = () => s.db.select().from(noteChange).where(eq(noteChange.noteId, noteId)).all();

describe("linked-notes co-writing authority (N2, in-process)", () => {
  test("FR-NOTES-13 open gives the text and version; a re-open with a kept version gets the updates since", () => {
    expect(open(p1, "c1", "a")).toEqual({
      mode: "doc",
      version: 0,
      doc: "",
      here: [{ role: "player", playerId: p1.playerId, clientId: "a" }],
    });
    expect(push(p1, "c1", 0, [ins("a", 0, 0, "Hello")])).toEqual({ accepted: true });
    expect(push(p1, "c1", 1, [ins("a", 5, 5, " world"), ins("a", 11, 0, ">")])).toEqual({
      accepted: true,
    });
    const r = open(p2, "c2", "b", 1);
    expect(r.mode).toBe("updates");
    expect(r.version).toBe(3);
    if (r.mode === "updates") expect(r.updates.map((u) => u.clientId)).toEqual(["a", "a"]);
    const d = open(dm, "c3", "c");
    expect(d.mode === "doc" && d.doc).toBe(">Hello world");
    // A version ahead of the note's → the whole text.
    expect(open(p2, "c2", "b", 99).mode).toBe("doc");
  });

  test("FR-NOTES-14 a push at the current version is applied; a stale one gets the updates since; nothing doubles", () => {
    open(p1, "c1", "a");
    open(p2, "c2", "b");
    expect(push(p1, "c1", 0, [ins("a", 0, 0, "abc")])).toEqual({ accepted: true });
    const stale = push(p2, "c2", 0, [ins("b", 0, 0, "XY")]);
    expect(stale.accepted).toBe(false);
    expect("updates" in stale && stale.updates).toEqual([ins("a", 0, 0, "abc")]);
    // Rebased by the client, resent at version 1.
    expect(push(p2, "c2", 1, [ins("b", 3, 3, "XY")])).toEqual({ accepted: true });
    expect(row()?.version).toBe(2);
    expect(loadText(s.db, row() as typeof note.$inferSelect).toString()).toBe("abcXY");
    expect(changeRows().map((r) => [r.version, r.clientId])).toEqual([
      [0, "a"],
      [1, "b"],
    ]);
  });

  test("FR-NOTES-14 the editor ID is bound per connection: other IDs, unopened notes and taken IDs are refused", () => {
    expect(refusal(() => push(p1, "c1", 0, [ins("a", 0, 0, "x")]))).toEqual({
      code: "invalid",
      message: NOTE_NOT_OPEN,
    });
    open(p1, "c1", "a");
    expect(refusal(() => push(p1, "c1", 0, [ins("zz", 0, 0, "x")]))).toEqual({
      code: "invalid",
      message: NOTE_EDITOR_MISMATCH,
    });
    // Another connection can't push for c1's editor, nor take its ID if it isn't the same person.
    open(p2, "c2", "b");
    expect(refusal(() => push(p2, "c2", 0, [ins("a", 0, 0, "x")])).message).toBe(
      NOTE_EDITOR_MISMATCH,
    );
    expect(refusal(() => open(p2, "c9", "a"))).toEqual({
      code: "invalid",
      message: NOTE_EDITOR_IN_USE,
    });
    // The same person reconnecting moves the binding; the old connection loses it.
    open(p1, "c4", "a");
    expect(push(p1, "c4", 0, [ins("a", 0, 0, "x")])).toEqual({ accepted: true });
    expect(refusal(() => push(p1, "c1", 1, [ins("a", 1, 0, "y")])).message).toBe(NOTE_NOT_OPEN);
    // "server" is reserved (N6's rewrites); no connection → refused.
    expect(refusal(() => open(p1, "c5", "server")).code).toBe("invalid");
    expect(refusal(() => run(C.open, { noteId, clientId: "q" }, p1, null)).code).toBe("invalid");
  });

  test("FR-NOTES-13 up to 8 open notes per connection; re-opening one doesn't count twice", () => {
    const ids = [noteId];
    for (let i = 1; i <= NOTES_OPEN_MAX; i++)
      ids.push(
        (s.commands.run(createNote, { title: `N${i}` }, { actor: dm }) as { noteId: string })
          .noteId,
      );
    for (const id of ids.slice(0, NOTES_OPEN_MAX)) open(p1, "c1", "a", undefined, id);
    open(p1, "c1", "a", 0, ids[0]);
    expect(refusal(() => open(p1, "c1", "a", undefined, ids[NOTES_OPEN_MAX]))).toEqual({
      code: "conflict",
      message: NOTE_OPEN_LIMIT,
    });
    run(C.close, { noteId: ids[0] }, p1, "c1");
    expect(open(p1, "c1", "a", undefined, ids[NOTES_OPEN_MAX]).mode).toBe("doc");
    // Another connection has its own 8.
    expect(open(p1, "c2", "b", undefined, ids[0]).mode).toBe("doc");
  });

  test("FR-NOTES-21 a push past 32 KiB of UTF-8 is refused and stores nothing; up to the limit is fine", () => {
    open(p1, "c1", "a");
    const almost = "é".repeat(NOTE_BODY_MAX_BYTES / 2 - 1); // 2 bytes each: 2 bytes short
    expect(push(p1, "c1", 0, [ins("a", 0, 0, almost)])).toEqual({ accepted: true });
    expect(push(p1, "c1", 1, [ins("a", almost.length, 0, "ab")])).toEqual({ accepted: true });
    expect(refusal(() => push(p1, "c1", 2, [ins("a", almost.length + 2, 0, "x")]))).toEqual({
      code: "invalid",
      message: NOTE_BODY_TOO_BIG,
    });
    expect(row()?.version).toBe(2);
    expect(changeRows()).toHaveLength(2);
  });

  test("FR-NOTES-14 bad change JSON or a change that doesn't fit the text → invalid", () => {
    open(p1, "c1", "a");
    expect(refusal(() => push(p1, "c1", 0, [ins("a", 5, 0, "x")]))).toEqual({
      code: "invalid",
      message: NOTE_BAD_CHANGE,
    });
    expect(refusal(() => push(p1, "c1", 0, [{ clientId: "a", changes: [[3]] }])).code).toBe(
      "invalid",
    );
    expect(
      refusal(() =>
        run(C.push, { noteId, version: 0, updates: [{ clientId: "a", changes: "x" }] }, p1, "c1"),
      ).code,
    ).toBe("invalid");
  });

  test("FR-NOTES-19 each push is one stored row; every 100 changes the body folds; rows prune to 1,000", () => {
    open(p1, "c1", "a");
    let text = Text.empty;
    for (let v = 0; v < NOTES_FOLD_EVERY - 1; v++) {
      push(p1, "c1", v, [ins("a", text.length, text.length, "x")]);
      text = ChangeSet.of({ from: text.length, insert: "x" }, text.length).apply(text);
    }
    expect(row()).toMatchObject({ body: "", bodyVersion: 0, version: NOTES_FOLD_EVERY - 1 });
    push(p1, "c1", NOTES_FOLD_EVERY - 1, [ins("a", text.length, 0, "y")]);
    expect(row()).toMatchObject({
      body: `y${"x".repeat(NOTES_FOLD_EVERY - 1)}`,
      bodyFold: `y${"x".repeat(NOTES_FOLD_EVERY - 1)}`,
      bodyVersion: NOTES_FOLD_EVERY,
      version: NOTES_FOLD_EVERY,
    });
    // Old rows stay for re-opens until the 1,000-row window passes them.
    expect(updatesSince(s.db, noteId, 3, NOTES_FOLD_EVERY)).toHaveLength(NOTES_FOLD_EVERY - 3);
    s.db.transaction((tx) => {
      // 1,000 more pushes' rows, as if typed (cheaper than the commands).
      let doc = NOTES_FOLD_EVERY;
      for (let v = NOTES_FOLD_EVERY; v < NOTES_FOLD_EVERY + NOTES_KEEP_ROWS; v++) {
        tx.insert(noteChange)
          .values({ noteId, version: v, clientId: "a", changes: [ins("a", doc, 0, "z")], at: "t" })
          .run();
        doc++;
      }
      tx.update(note)
        .set({ version: NOTES_FOLD_EVERY + NOTES_KEEP_ROWS })
        .where(eq(note.id, noteId))
        .run();
    });
    // The cache is behind the DB now: the next push rebuilds it, folds and prunes.
    const v = NOTES_FOLD_EVERY + NOTES_KEEP_ROWS;
    const len = NOTES_FOLD_EVERY + NOTES_KEEP_ROWS;
    expect(push(p1, "c1", v, [ins("a", len, len, "!")])).toEqual({ accepted: true });
    expect(row()?.bodyVersion).toBe(v + 1);
    expect(row()?.body.endsWith("!")).toBe(true);
    expect(changeRows()).toHaveLength(NOTES_KEEP_ROWS);
    expect(updatesSince(s.db, noteId, 3, v + 1)).toBeNull();
    expect(open(p2, "c2", "b", 3).mode).toBe("doc");
    expect(loadText(s.db, row() as typeof note.$inferSelect).toString()).toBe(
      row()?.body as string,
    );
  });

  test("FR-NOTES-19 pruning keeps at most 1 MiB of rows", () => {
    open(p1, "c1", "a");
    const big = "w".repeat(25_000); // 49 rows of it: 1.2 MB
    let len = 0;
    s.db.transaction((tx) => {
      for (let v = 0; v < 99; v++) {
        tx.insert(noteChange)
          .values({
            noteId,
            version: v,
            clientId: "a",
            changes: [ins("a", len, len, v % 2 ? big : "")],
            at: "t",
          })
          .run();
        len += v % 2 ? big.length : 0;
      }
      tx.update(note).set({ version: 99 }).where(eq(note.id, noteId)).run();
    });
    // Too long for a note, so delete back down in the 100th change, then fold.
    const del: NoteUpdate = {
      clientId: "a",
      changes: ChangeSet.of({ from: 0, to: len }, len).toJSON() as NoteUpdate["changes"],
    };
    expect(push(p1, "c1", 99, [del])).toEqual({ accepted: true });
    const kept = changeRows();
    const bytes = kept.reduce((n, r) => n + JSON.stringify(r.changes).length, 0);
    expect(bytes).toBeLessThanOrEqual(1024 * 1024);
    expect(kept.length).toBeLessThan(100);
    expect(kept.at(-1)?.version).toBe(99);
    expect(row()).toMatchObject({ body: "", bodyVersion: 100 });
  });

  test("FR-NOTES-20 FR-NOTES-24 a binned note can't be opened or pushed; pushes add nothing to the event log", () => {
    const logged = s.db.select().from(eventLog).all().length;
    open(p1, "c1", "a");
    push(p1, "c1", 0, [ins("a", 0, 0, "x")]);
    run(C.close, { noteId }, p1, "c1");
    expect(s.db.select().from(eventLog).all().length).toBe(logged);
    open(p1, "c1", "a");
    s.commands.run(deleteNote, { noteId }, { actor: dm });
    expect(refusal(() => open(p2, "c2", "b")).code).toBe("not_found");
    expect(refusal(() => push(p1, "c1", 1, [ins("a", 1, 0, "y")])).code).toBe("not_found");
  });

  test("FR-NOTES-14 updatedAt moves at most once a minute while typing", () => {
    open(p2, "c2", "b");
    const at0 = row()?.updatedAt;
    clock.advance(30_000);
    push(p2, "c2", 0, [ins("b", 0, 0, "x")]);
    expect(row()?.updatedAt).toBe(at0 as string);
    clock.advance(31_000);
    push(p2, "c2", 1, [ins("b", 1, 1, "y")]);
    expect(row()?.updatedAt).not.toBe(at0 as string);
    expect(row()?.updatedByPlayerId).toBe(p2.playerId);
  });
});

describe("linked-notes package boundary (N2)", () => {
  test("ADR-0078 the server and src/shared never import @codemirror/view (only state and collab run on the server)", async () => {
    const root = `${import.meta.dir}/../../../..`;
    const hits: string[] = [];
    for (const dirGlob of ["src/server/**/*.ts", "src/shared/**/*.ts", "src/mcp/**/*.ts"])
      for (const f of new Bun.Glob(dirGlob).scanSync({ cwd: root })) {
        const src = await Bun.file(`${root}/${f}`).text();
        if (/from\s+["']@codemirror\/(view|commands)["']/.test(src)) hits.push(f);
        if (
          f.replaceAll("\\", "/").startsWith("src/shared/") &&
          /from\s+["']@codemirror\//.test(src)
        )
          hits.push(f);
      }
    expect(hits).toEqual([]);
  }, 30_000);
});
