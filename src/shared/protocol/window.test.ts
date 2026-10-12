import { describe, expect, test } from "bun:test";
import { cutWindow, type RecordWindow, windowProjection } from "./window";

type Row = { id: string; n: number; pinned?: boolean };
const rows = (...ns: number[]): Row[] => ns.map((n) => ({ id: `r${n}`, n }));
const ids = (rs: Row[]) => rs.map((r) => r.id);

describe("ADR-0029 window cut", () => {
  test("ADR-0029 newest `size` by orderBy, provider order kept, floor = lowest kept", () => {
    const w: RecordWindow<Row> = { orderBy: "n", size: 3 };
    const cut = cutWindow(rows(5, 1, 4, 2, 3), w);
    expect(ids(cut.rows)).toEqual(["r5", "r4", "r3"]);
    expect(cut.floor).toBe(3);
  });

  test("ADR-0029 fewer rows than size: everything, floor = lowest; empty: floor null", () => {
    const w: RecordWindow<Row> = { orderBy: "n", size: 100 };
    expect(cutWindow(rows(2, 1), w)).toEqual({ rows: rows(2, 1), floor: 1 });
    expect(cutWindow([], w)).toEqual({ rows: [], floor: null });
  });

  test("ADR-0029 pinned rows always included and don't count against size (pending + newest N closed)", () => {
    const w: RecordWindow<Row> = { orderBy: "n", size: 2, pin: (r) => r.pinned === true };
    const list = [...rows(1, 2, 3, 4, 5)];
    (list[0] as Row).pinned = true;
    const cut = cutWindow(list, w);
    expect(ids(cut.rows)).toEqual(["r1", "r4", "r5"]);
    expect(cut.floor).toBe(4);
    const allPinned = rows(1, 2).map((r) => ({ ...r, pinned: true }));
    expect(cutWindow(allPinned, w)).toEqual({ rows: allPinned, floor: null });
  });

  test("ADR-0029 ties at the floor keep the provider's order (ADR-0022 tiebreak)", () => {
    const w: RecordWindow<Row> = { orderBy: "n", size: 2 };
    const list: Row[] = [
      { id: "a", n: 1 },
      { id: "b", n: 1 },
      { id: "c", n: 1 },
    ];
    expect(ids(cutWindow(list, w).rows)).toEqual(["a", "b"]);
  });

  test("ADR-0029 orderBy must be a finite number", () => {
    const w = { orderBy: "n", size: 1 } as RecordWindow<{ id: string; n: unknown }>;
    expect(() => cutWindow([{ id: "x", n: "7" }], w)).toThrow(/finite number/);
  });

  test("CON-39 projection keeps only cut IDs of windowed types; other types untouched", () => {
    const records = {
      log: { a: { id: "a" }, b: { id: "b" }, c: { id: "c" } },
      other: { x: { id: "x" } },
    };
    expect(windowProjection(records, { log: ["b", "c", "zz"] })).toEqual({
      log: { b: { id: "b" }, c: { id: "c" } },
      other: { x: { id: "x" } },
    });
  });
});
