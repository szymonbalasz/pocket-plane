// NOTES N2 unit (build §1.2): the 48 KiB push frame split (ADR-0078, FR-NOTES-21) and the wire
// schemas of open / push / cursor (FR-NOTES-14, -15).
import { describe, expect, test } from "bun:test";
import {
  NOTES_PUSH_FRAME_BYTES,
  NOTES_PUSH_UPDATES_MAX,
  NoteCursorSignal,
  type NoteUpdate,
  OpenNoteIntent,
  PushNoteIntent,
  pushPrefix,
} from "./collab";

const update = (text: string, clientId = "tab-1"): NoteUpdate => ({
  clientId,
  changes: [[0, text]],
});
const frameBytes = (noteId: string, version: number, updates: NoteUpdate[]) =>
  new TextEncoder().encode(
    JSON.stringify({
      type: "intent",
      intentId: "0".repeat(36),
      name: "notes.push",
      payload: { noteId, version, updates },
    }),
  ).length;

describe("linked-notes co-writing wire (N2)", () => {
  test("FR-NOTES-21 a push frame takes the longest prefix within 48 KiB, at least one update", () => {
    const ten = Array.from({ length: 10 }, (_x, i) => update(`${i}`.repeat(10_000)));
    const first = pushPrefix("n1", 7, ten);
    expect(first.length).toBe(4);
    expect(frameBytes("n1", 7, first)).toBeLessThanOrEqual(NOTES_PUSH_FRAME_BYTES);
    expect(frameBytes("n1", 7, ten.slice(0, 5))).toBeGreaterThan(NOTES_PUSH_FRAME_BYTES);
    // Small updates all go, up to the per-push count.
    const small = Array.from({ length: NOTES_PUSH_UPDATES_MAX + 5 }, () => update("a"));
    expect(pushPrefix("n1", 0, small)).toHaveLength(NOTES_PUSH_UPDATES_MAX);
    // One update bigger than a frame still goes alone; none → none.
    expect(pushPrefix("n1", 0, [update("x".repeat(60_000)), update("y")])).toHaveLength(1);
    expect(pushPrefix("n1", 0, [])).toEqual([]);
    // Multi-byte text counts in UTF-8 bytes.
    const wide = Array.from({ length: 4 }, () => update("é".repeat(10_000)));
    const w = pushPrefix("n1", 0, wide);
    expect(w).toHaveLength(2);
    expect(frameBytes("n1", 0, w)).toBeLessThanOrEqual(NOTES_PUSH_FRAME_BYTES);
  });

  test("FR-NOTES-14 push and open payloads: ChangeSet JSON, 1–200 updates, the reserved editor ID", () => {
    expect(
      PushNoteIntent.safeParse({
        noteId: "n",
        version: 3,
        updates: [{ clientId: "a", changes: [5, [2, "x", ""], 1] }],
      }).success,
    ).toBe(true);
    for (const bad of [
      { noteId: "n", version: 0, updates: [] },
      { noteId: "n", version: -1, updates: [update("x")] },
      { noteId: "n", version: 0, updates: [{ clientId: "a", changes: ["x"] }] },
      { noteId: "n", version: 0, updates: [{ clientId: "a", changes: [[-1]] }] },
      { noteId: "n", version: 0, updates: [update("x", "server")] },
      { noteId: "n", version: 0, updates: Array(NOTES_PUSH_UPDATES_MAX + 1).fill(update("x")) },
    ])
      expect(PushNoteIntent.safeParse(bad).success).toBe(false);
    expect(OpenNoteIntent.safeParse({ noteId: "n", clientId: "a" }).success).toBe(true);
    expect(OpenNoteIntent.safeParse({ noteId: "n", clientId: "a", version: 2.5 }).success).toBe(
      false,
    );
  });

  test("FR-NOTES-15 a cursor carries at most 10 ranges, or `left`", () => {
    const base = { noteId: "n", clientId: "a", version: 1 };
    expect(NoteCursorSignal.safeParse({ ...base, ranges: [{ anchor: 0, head: 4 }] }).success).toBe(
      true,
    );
    expect(NoteCursorSignal.safeParse({ ...base, ranges: [], left: true }).success).toBe(true);
    expect(
      NoteCursorSignal.safeParse({ ...base, ranges: Array(11).fill({ anchor: 0, head: 0 }) })
        .success,
    ).toBe(false);
  });
});
