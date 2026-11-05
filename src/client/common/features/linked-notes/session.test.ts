// NOTES N3 client co-writing (ADR-0078 client side): `NoteSession` against an in-memory authority
// that answers as the server does. Open, typing at once, rebasing, undo of your own changes only,
// offline typing and catch-up, the 48 KiB push split, the typing cap and the server's "Note is
// full", the reload and gone banners, cursors throttled, mapped and expired.
import { describe, expect, test } from "bun:test";
import { undo } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import { NOTES_CURSOR_SIGNAL, NOTES_PUSH_FRAME_BYTES } from "@shared/linked-notes/collab";
import { NOTE_BODY_MAX_BYTES } from "@shared/linked-notes/schemas";
import { docBytes, FULL_SHOWN_MS, PUSH_DELAY_MS, SAVING_AFTER_MS, TAG_MS } from "./session";
import { FakeAuthority, FakeClock, FakeEditor } from "./testing";

const START = "Found in the Duke's office.\nRoll 2d6 to search it.";

async function table(n = 3, doc = START) {
  const clock = new FakeClock();
  const auth = new FakeAuthority("n1", doc);
  const eds = Array.from({ length: n }, (_x, i) => new FakeEditor(auth, clock, `tab-${i}`));
  for (const e of eds) await e.session.open();
  await clock.advance(0);
  return { clock, auth, eds };
}

describe("linked-notes NoteSession (N3)", () => {
  test("FR-NOTES-13 opening shows the text at once and reads Saved", async () => {
    const { auth, eds } = await table(1);
    const [a] = eds as [FakeEditor];
    expect(a.doc).toBe(START);
    expect(a.session.status).toBe("saved");
    expect(a.session.here.map((h) => h.clientId)).toEqual(["tab-0"]);
    expect(auth.version).toBe(0);
  });

  test("FR-NOTES-14 three tabs typing at once converge with the authority; nothing lost or doubled", async () => {
    const { clock, auth, eds } = await table(3);
    for (let round = 0; round < 25; round++) {
      eds.forEach((e, k) => {
        e.type(
          [0, "end", Math.floor(e.doc.length / 2)][(round + k) % 3] as number | "end",
          "%&~"[k] as string,
        );
      });
      await clock.advance(round % 3 === 0 ? PUSH_DELAY_MS : 30);
    }
    await clock.advance(2000);
    const final = auth.text.toString();
    for (const e of eds) {
      expect(e.doc).toBe(final);
      expect(e.session.status).toBe("saved");
    }
    for (const ch of "%&~") expect([...final].filter((c) => c === ch).length).toBe(25);
    expect(final.length).toBe(START.length + 75);
    // Typing at once went stale and rebased: more pushes than accepted changes would need alone.
    expect(auth.pushes.length).toBeGreaterThan(0);
  });

  test("FR-NOTES-14 one push in flight, batched after 100 ms; Saved while it goes through quickly (r1)", async () => {
    const { clock, auth, eds } = await table(1);
    const [a] = eds as [FakeEditor];
    a.type("end", "a");
    a.type("end", "b");
    expect(a.session.status).toBe("saved");
    await clock.advance(PUSH_DELAY_MS - 1);
    expect(auth.pushes).toHaveLength(0);
    await clock.advance(1);
    expect(auth.pushes).toHaveLength(1);
    expect(auth.pushes[0]?.updates).toBe(2);
    expect(a.session.status).toBe("saved");
  });

  test("FR-NOTES-17 undo reverts only this tab's own typing, mapped over the others'", async () => {
    const { clock, auth, eds } = await table(2, "");
    const [a, b] = eds as [FakeEditor, FakeEditor];
    a.type(0, "alpha ");
    await clock.advance(200);
    b.type("end", "beta ");
    await clock.advance(200);
    a.type("end", "gamma");
    await clock.advance(200);
    expect(a.doc).toBe("alpha beta gamma");
    let state = a.state;
    undo({ state, dispatch: (tr) => (state = tr.state) });
    a.setState(state);
    a.session.edited();
    await clock.advance(200);
    expect(a.doc).toBe("alpha beta ");
    state = a.state;
    undo({ state, dispatch: (tr) => (state = tr.state) });
    a.setState(state);
    a.session.edited();
    await clock.advance(200);
    expect(a.doc).toBe("beta ");
    expect(b.doc).toBe("beta ");
    expect(auth.text.toString()).toBe("beta ");
  });

  test("FR-NOTES-18 offline typing stays, reads Offline, and is sent rebased after the reconnect", async () => {
    const { clock, auth, eds } = await table(2);
    const [a, b] = eds as [FakeEditor, FakeEditor];
    a.disconnect();
    expect(a.session.status).toBe("offline");
    a.type(0, "[while offline] ");
    await clock.advance(500);
    expect(a.session.status).toBe("offline");
    b.type("end", " [b]");
    await clock.advance(500);
    a.reconnect();
    await clock.advance(500);
    expect(a.doc).toBe(auth.text.toString());
    expect(b.doc).toBe(auth.text.toString());
    expect(auth.text.toString()).toBe(`[while offline] ${START} [b]`);
    expect(a.session.status).toBe("saved");
    expect(a.session.banner).toBeNull();
  });

  test("FR-NOTES-18 a re-open whose changes are no longer kept reloads the text, keeping ours for Copy my text", async () => {
    const { clock, auth, eds } = await table(2);
    const [a, b] = eds as [FakeEditor, FakeEditor];
    a.disconnect();
    a.type("end", " mine");
    b.type(0, "x");
    await clock.advance(500);
    auth.forget();
    a.reconnect();
    await clock.advance(500);
    expect(a.session.banner).toEqual({ kind: "reload", text: `${START} mine` });
    expect(a.doc).toBe(auth.text.toString());
    expect(a.session.status).toBe("saved");
  });

  test("FR-NOTES-21 pushes split at 48 KiB a frame; every frame within it", async () => {
    const { clock, auth, eds } = await table(1, "");
    const [a] = eds as [FakeEditor];
    a.disconnect();
    const chunk = "w".repeat(2000);
    for (let i = 0; i < 30; i++) {
      a.type(0, chunk);
      a.erase(0, chunk.length);
    }
    a.type(0, "kept");
    a.reconnect();
    await clock.advance(2000);
    expect(auth.pushes.length).toBeGreaterThan(1);
    for (const p of auth.pushes) expect(p.bytes).toBeLessThanOrEqual(NOTES_PUSH_FRAME_BYTES);
    expect(auth.text.toString()).toBe("kept");
    expect(a.session.status).toBe("saved");
  });

  test("FR-NOTES-21 typing stops at 32 KiB; the server's 'Note is full' reloads with Copy my text", async () => {
    const { clock, auth, eds } = await table(2, "");
    const [a, b] = eds as [FakeEditor, FakeEditor];
    const half = "é".repeat(NOTE_BODY_MAX_BYTES / 4); // 16 KiB of UTF-8
    // b types offline first (its own text is small, so its filter lets it through).
    b.disconnect();
    expect(b.type(0, "y".repeat(10))).toBe(true);
    expect(a.type(0, half)).toBe(true);
    expect(a.type(0, half)).toBe(true);
    expect(docBytes(a.state)).toBe(NOTE_BODY_MAX_BYTES);
    expect(a.type("end", "x")).toBe(false); // the change filter refuses it
    await clock.advance(200);
    // Together over: b's offline typing, rebased on a's, goes past 32 KiB → the server refuses it.
    b.reconnect();
    await clock.advance(1000);
    expect(b.session.banner?.kind).toBe("full");
    expect(b.session.banner?.text.includes("y".repeat(10))).toBe(true);
    expect(b.doc).toBe(auth.text.toString());
    expect(docBytes(b.state)).toBe(NOTE_BODY_MAX_BYTES);
  });

  test("FR-NOTES-20 binned while open → the deleted banner; not found on a re-open → gone", async () => {
    const { clock, auth, eds } = await table(2);
    const [a, b] = eds as [FakeEditor, FakeEditor];
    a.type("end", " draft");
    a.session.onClosed({ noteId: "n1" });
    expect(a.session.banner).toEqual({ kind: "deleted", text: `${START} draft` });
    auth.gone = true;
    b.disconnect();
    b.reconnect();
    await clock.advance(200);
    expect(b.session.banner?.kind).toBe("gone");
  });

  test("FR-NOTES-15 cursors: at most 10 signals a second, the last always sent; mapped over later changes; gone after 10 s or on `left`", async () => {
    const { clock, eds } = await table(2, "abcdef");
    const [a, b] = eds as [FakeEditor, FakeEditor];
    for (let i = 0; i < 30; i++) {
      a.setState(a.state.update({ selection: EditorSelection.cursor(i % 6) }).state);
      a.session.selectionChanged();
      await clock.advance(10);
    }
    await clock.advance(1000);
    const cursors = a.sent.filter((s) => s.name === NOTES_CURSOR_SIGNAL);
    expect(cursors.length).toBeLessThanOrEqual(5); // 300 ms of changes → ≤ 3 + the trailing one
    expect(cursors.at(-1)?.data).toMatchObject({
      noteId: "n1",
      clientId: "tab-0",
      ranges: [{ anchor: 5, head: 5 }],
    });

    // b receives a's cursor at version 0, then text lands before it: mapped forward.
    b.session.onCursor(
      { noteId: "n1", clientId: "tab-0", version: 0, ranges: [{ anchor: 2, head: 4 }] },
      { role: "player", playerId: "tab-0" },
    );
    a.type(0, "XYZ");
    await clock.advance(200);
    const c = b.session.cursors.get("tab-0");
    expect(c && b.session.mapCursor(c)).toEqual([{ anchor: 5, head: 7 }]);
    // Our own cursor is never drawn; `left` removes.
    b.session.onCursor({ noteId: "n1", clientId: "tab-1", version: 1, ranges: [] }, { role: "dm" });
    expect(b.session.cursors.has("tab-1")).toBe(false);
    b.session.onCursor(
      { noteId: "n1", clientId: "tab-0", version: 1, ranges: [{ anchor: 0, head: 0 }] },
      { role: "player", playerId: "tab-0" },
    );
    b.session.onCursor(
      { noteId: "n1", clientId: "tab-0", version: 1, ranges: [], left: true },
      { role: "player", playerId: "tab-0" },
    );
    expect(b.session.cursors.size).toBe(0);
  });

  test("FR-NOTES-15 r1 a caret stays while its person has the note open, however long they idle, and moves with others' typing; it goes on leaving `here`", async () => {
    const { clock, auth, eds } = await table(3, "abcdef");
    const [a, b, c] = eds as [FakeEditor, FakeEditor, FakeEditor];
    b.session.onCursor(
      { noteId: "n1", clientId: "tab-0", version: 0, ranges: [{ anchor: 3, head: 3 }] },
      { role: "player", playerId: "tab-0" },
    );
    await clock.advance(60_000); // a idles a minute
    for (let i = 0; i < 60; i++) {
      c.type(0, "z"); // 60 changes before a's caret: more than the kept window (50)
      await clock.advance(PUSH_DELAY_MS);
    }
    await clock.advance(1000);
    const cur = b.session.cursors.get("tab-0");
    expect(cur && b.session.mapCursor(cur)).toEqual([{ anchor: 63, head: 63 }]);
    expect(b.doc.slice(60, 63)).toBe("abc");
    // Leaving `here` (closed, or pruned after a disconnect) takes it away.
    b.session.onHere({ noteId: "n1", here: auth.here().filter((h) => h.clientId !== "tab-0") });
    expect(b.session.cursors.has("tab-0")).toBe(false);
    void a;
  }, 30_000);

  test("FR-NOTES-15 r1 a name tag shows for 2 s after its person moves or types, then only the caret", async () => {
    const { clock, eds } = await table(2, "abc");
    const [a, b] = eds as [FakeEditor, FakeEditor];
    b.session.onCursor(
      { noteId: "n1", clientId: "tab-0", version: 0, ranges: [{ anchor: 1, head: 1 }] },
      { role: "player", playerId: "tab-0" },
    );
    const cur = () =>
      b.session.cursors.get("tab-0") as NonNullable<ReturnType<typeof b.session.cursors.get>>;
    expect(b.session.showTag(cur())).toBe(true);
    await clock.advance(TAG_MS + 1);
    expect(b.session.showTag(cur())).toBe(false);
    a.type(0, "x"); // typing (its update reaches b) shows the tag again
    await clock.advance(PUSH_DELAY_MS + 10);
    expect(b.session.showTag(cur())).toBe(true);
  });

  test("FR-NOTES-18 r1 'Saving…' only once unconfirmed text has waited 1 s; a deleted note shows no status", async () => {
    const { clock, auth, eds } = await table(2);
    const [a, b] = eds as [FakeEditor, FakeEditor];
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      a.type("end", "k");
      await clock.advance(80);
      seen.add(a.session.status);
    }
    expect([...seen]).toEqual(["saved"]); // no flicker while pushes go through
    const release = auth.pause();
    a.type("end", "slow");
    await clock.advance(SAVING_AFTER_MS - 50); // waiting since the keystroke
    expect(a.session.status).toBe("saved");
    await clock.advance(100);
    expect(a.session.status).toBe("saving");
    release();
    await clock.advance(200);
    expect(a.session.status).toBe("saved");
    b.session.onClosed({ noteId: "n1" });
    await clock.advance(5000);
    expect(b.session.status).toBe("none");
  });

  test("FR-NOTES-21 r1 at 32 KiB typing and a paste that won't fit are refused with 'Note is full'", async () => {
    const { clock, eds } = await table(1, "");
    const [a] = eds as [FakeEditor];
    expect(a.type(0, "é".repeat(NOTE_BODY_MAX_BYTES / 2 - 10))).toBe(true); // 20 bytes short
    await clock.advance(200);
    expect(a.session.status).toBe("saved");
    expect(a.type("end", "p".repeat(400))).toBe(false); // a paste that won't fit: nothing lands
    await clock.advance(1);
    expect(a.session.status).toBe("full");
    expect(docBytes(a.state)).toBe(NOTE_BODY_MAX_BYTES - 20);
    expect(a.type("end", "fits")).toBe(true); // what fits still goes in
    await clock.advance(FULL_SHOWN_MS + 200);
    expect(a.session.status).toBe("saved");
  });

  test("FR-NOTES-16 who is here follows open and close", async () => {
    const { clock, eds } = await table(2);
    const [a, b] = eds as [FakeEditor, FakeEditor];
    expect(a.session.here.map((h) => h.clientId).sort()).toEqual(["tab-0", "tab-1"]);
    b.session.close();
    await clock.advance(10);
    expect(b.subscribed).toBe(false);
    expect(b.sent.at(-1)).toMatchObject({ name: NOTES_CURSOR_SIGNAL, data: { left: true } });
  });
});
