import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  bindSheetMemory,
  createSheetMemory,
  type Eligibility,
  openSheetFor,
  requestEdit,
  resetSheetMemory,
  type SheetMemoryBackend,
  selectSheet,
  sheetMemoryKey,
  sheetSelection,
} from "./selection";

/** One browser's localStorage. */
function fakeStorage() {
  const data = new Map<string, string>();
  const backend: SheetMemoryBackend = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
  return { data, backend };
}

/** A fresh page load over `backend`. */
function page(backend: () => SheetMemoryBackend, warnings: string[] = []) {
  resetSheetMemory(createSheetMemory(backend, (m) => warnings.push(m)));
}

const DM = sheetMemoryKey("c1", "dm", null);
const P1 = sheetMemoryKey("c1", "player", "p1");
const all: Eligibility = () => "option";
const sel = () => sheetSelection.getState();

describe("FR-CHARX-47 picker memory", () => {
  let store: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    store = fakeStorage();
  });

  test("FR-CHARX-47 key per campaign and DM / player", () => {
    expect(DM).toBe("pp.sheet.v1.c1.dm");
    expect(P1).toBe("pp.sheet.v1.c1.p1");
  });

  test("FR-CHARX-47 round trip per (campaign, owner): picker change → reload → same character", () => {
    page(() => store.backend);
    bindSheetMemory(P1, all);
    selectSheet("brin");
    expect(JSON.parse(store.data.get(P1) as string)).toEqual({ selectedId: "brin" });
    page(() => store.backend);
    expect(sel().selectedId).toBeNull();
    bindSheetMemory(P1, all);
    expect(sel().selectedId).toBe("brin");
    // Another campaign / owner has its own entry.
    bindSheetMemory(sheetMemoryKey("c2", "player", "p1"), all);
    expect(store.data.has("pp.sheet.v1.c2.p1")).toBe(false);
    page(() => store.backend);
    bindSheetMemory(DM, all);
    expect(sel().selectedId).toBeNull();
  });

  test("FR-CHARX-47 openSheetFor / create before the window mounts: stored at bind, not overridden", () => {
    store.data.set(DM, JSON.stringify({ selectedId: "mira" }));
    page(() => store.backend);
    openSheetFor("brin", "character"); // G8 Review, sheet window not mounted yet
    bindSheetMemory(DM, all);
    expect(sel().selectedId).toBe("brin");
    expect(JSON.parse(store.data.get(DM) as string)).toEqual({ selectedId: "brin" });
    requestEdit("quill");
    expect(JSON.parse(store.data.get(DM) as string)).toEqual({ selectedId: "quill" });
  });

  test("FR-CHARX-47 the DM's last NPC is restored with its picker slot", () => {
    page(() => store.backend);
    bindSheetMemory(DM, all);
    openSheetFor("elite", "monster");
    page(() => store.backend);
    bindSheetMemory(DM, (id) => (id === "elite" ? "npc" : null));
    expect(sel()).toMatchObject({ selectedId: "elite", npcId: "elite" });
  });

  test("FR-CHARX-47 ineligible stored id → default (no selection); next change overwrites", () => {
    store.data.set(P1, JSON.stringify({ selectedId: "kell" }));
    page(() => store.backend);
    bindSheetMemory(P1, () => null);
    expect(sel().selectedId).toBeNull();
    selectSheet("mira");
    expect(JSON.parse(store.data.get(P1) as string)).toEqual({ selectedId: "mira" });
  });

  test("FR-CHARX-47 corrupt entry → default + console warning", () => {
    for (const bad of ["{", '{"selectedId":""}', `{"selectedId":"${"x".repeat(65)}"}`, "[]"]) {
      store.data.set(P1, bad);
      const warnings: string[] = [];
      page(() => store.backend, warnings);
      bindSheetMemory(P1, all);
      expect(sel().selectedId).toBeNull();
      expect(warnings).toHaveLength(1);
    }
  });

  test("FR-CHARX-47 default console warning: corrupt entry → message only, no stray argument", () => {
    store.data.set(P1, "{");
    const spy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      resetSheetMemory(createSheetMemory(() => store.backend));
      bindSheetMemory(P1, all);
      expect(spy.mock.calls).toEqual([
        ['character-sheet: invalid picker memory "pp.sheet.v1.c1.p1"; using the default'],
      ]);
      expect(spy.mock.calls[0]).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  test("FR-CHARX-47 throwing storage → memory only for the page, one warning, never throws", () => {
    const warnings: string[] = [];
    page(() => {
      throw new Error("blocked");
    }, warnings);
    bindSheetMemory(P1, all);
    selectSheet("brin");
    selectSheet("mira");
    expect(sel().selectedId).toBe("mira");
    expect(warnings).toHaveLength(1);
    // Same page, campaign switch and back: the in-memory entry is still there.
    bindSheetMemory(sheetMemoryKey("c2", "player", "p1"), all);
    sheetSelection.setState({ selectedId: null });
    bindSheetMemory(P1, all);
    expect(sel().selectedId).toBe("mira");
  });
});
