// FOG §13 sprint-4 client unit rows (V9): Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y bindings (the polygon
// draft's last vertex first; Cmd on macOS; Alt and plain keys ignored; no action in a text field,
// FR-SHELL-13 routing) and the undo / redo queue (two quick Ctrl+Z = two steps, each guarded by
// the record's entry after the previous event; a reject toasts; nothing to undo → nothing sent);
// the Redo Tooltip.
import { describe, expect, test } from "bun:test";
import type { FogRecord, FogRedoInput, FogUndoInput } from "@shared/fog-of-war/schemas";
import { FOG_INTENTS } from "@shared/fog-of-war/schemas";
import { isBaseKeyTarget } from "../play-shell/keys";
import { redoHint } from "./FogBar";
import { historyIdle, historyKey, stepHistory } from "./history";

const key = (
  k: string,
  o: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {},
) => ({
  key: k,
  ctrlKey: o.ctrl ?? false,
  metaKey: o.meta ?? false,
  shiftKey: o.shift ?? false,
  altKey: o.alt ?? false,
});

describe("FR-FOG-17 history keys", () => {
  test("FR-FOG-17 Ctrl+Z = Undo, or the open polygon draft's last vertex; Ctrl+Shift+Z / Ctrl+Y = Redo", () => {
    expect(historyKey(key("z", { ctrl: true }), false)).toBe("undo");
    expect(historyKey(key("z", { ctrl: true }), true)).toBe("vertex");
    expect(historyKey(key("Z", { ctrl: true, shift: true }), false)).toBe("redo");
    expect(historyKey(key("Z", { ctrl: true, shift: true }), true)).toBe("redo");
    expect(historyKey(key("y", { ctrl: true }), false)).toBe("redo");
    expect(historyKey(key("z", { meta: true }), false)).toBe("undo");
    expect(historyKey(key("z"), false)).toBeNull();
    expect(historyKey(key("z", { ctrl: true, alt: true }), false)).toBeNull();
    expect(historyKey(key("y", { ctrl: true, shift: true }), false)).toBeNull();
    expect(historyKey(key("x", { ctrl: true }), false)).toBeNull();
  });

  test("FR-FOG-17 no action while typing in a text field (base-layer key routing)", () => {
    const inField = { closest: (sel: string) => (sel.includes("input") ? {} : null) };
    expect(isBaseKeyTarget(inField)).toBe(false);
    expect(isBaseKeyTarget({ closest: () => null })).toBe(true);
  });
});

describe("FR-FOG-56 undo / redo queue", () => {
  const fogAt = (undo: string | null, redo: string | null) =>
    ({
      id: "s1",
      shapes: [],
      darkness: [],
      undo: undo ? { n: 2, editId: undo, kind: "reveal-shape" } : null,
      ...(redo ? { redo: { n: 1, editId: redo, kind: "reveal-shape" } } : {}),
    }) as unknown as FogRecord;

  test("FR-FOG-56 two quick Ctrl+Z run in order, each with the entry the previous event left", async () => {
    let fog = fogAt("b", null);
    const sent: [string, FogUndoInput | FogRedoInput][] = [];
    const t = {
      sceneId: "s1",
      read: () => fog,
      intent: async (name: string, input: FogUndoInput | FogRedoInput) => {
        sent.push([name, input]);
        await Bun.sleep(5);
        // The event lands before the ack.
        fog = input.expectedEditId === "b" ? fogAt("a", "b") : fogAt(null, "a");
      },
      onReject: () => {},
    };
    expect(stepHistory("undo", t)).toBe(true);
    expect(stepHistory("undo", t)).toBe(true);
    await historyIdle();
    expect(sent).toEqual([
      [FOG_INTENTS.undo, { sceneId: "s1", expectedEditId: "b" }],
      [FOG_INTENTS.undo, { sceneId: "s1", expectedEditId: "a" }],
    ]);
    // Redo with Ctrl+Shift+Z: the most recently undone entry.
    expect(stepHistory("redo", t)).toBe(true);
    await historyIdle();
    expect(sent.at(-1)).toEqual([FOG_INTENTS.redo, { sceneId: "s1", expectedEditId: "a" }]);
  });

  test("FR-FOG-56 nothing to undo / redo → nothing sent; a reject is toasted", async () => {
    const sent: string[] = [];
    const errors: unknown[] = [];
    const t = {
      sceneId: "s1",
      read: () => fogAt(null, null),
      intent: async (name: string) => {
        sent.push(name);
      },
      onReject: (e: unknown) => errors.push(e),
    };
    expect(stepHistory("undo", t)).toBe(false);
    expect(stepHistory("redo", t)).toBe(false);
    await historyIdle();
    expect(sent).toEqual([]);
    const failing = {
      ...t,
      read: () => fogAt("x", null),
      intent: async () => {
        throw new Error("Fog changed — check and undo again");
      },
    };
    stepHistory("undo", failing);
    await historyIdle();
    expect(errors).toHaveLength(1);
  });

  test("FR-FOG-56 Redo Tooltip names the step", () => {
    expect(redoHint(undefined)).toBe("Nothing to redo");
    expect(redoHint({ redo: { n: 1, editId: "e", kind: "fog-shape" } })).toBe("Redo: fog shape");
    expect(redoHint({ redo: { n: 1, editId: "e", kind: "reveal-all" } })).toBe("Redo: reveal all");
    expect(redoHint({ redo: { n: 1, editId: "e", kind: "darkness-move" } })).toBe(
      "Redo: darkness move",
    );
  });
});
