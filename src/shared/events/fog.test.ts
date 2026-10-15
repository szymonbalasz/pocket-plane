// fog-of-war events (FOG §9): registered once, logged, not ADR-0016-undoable; strict payloads.
import { describe, expect, test } from "bun:test";
import { FogEdited, FogUndone } from "./fog-of-war";
import { domainEvents } from "./index";

const roundTrip = (s: { parse(v: unknown): unknown }, v: unknown) =>
  expect(s.parse(JSON.parse(JSON.stringify(v)))).toEqual(v);

describe("FOG domain events (§9)", () => {
  test("FOG §9 FogEdited / FogUndone registered once, logged, not undoable", () => {
    const defs = domainEvents.filter((e) => e.type === "FogEdited" || e.type === "FogUndone");
    expect(defs.map((e) => e.type).sort()).toEqual(["FogEdited", "FogUndone"]);
    expect(defs.every((e) => e.logged && !e.undoable)).toBe(true);
    const types = domainEvents.map((e) => e.type);
    expect(new Set(types).size).toBe(types.length);
  });

  test("FR-FOG-05/06/07 payloads round-trip; shape optional (all-kinds); strict", () => {
    roundTrip(FogEdited.payload, {
      sceneId: "s",
      editId: "e",
      kind: "reveal-rect",
      shape: { kind: "rect", c0: 0, r0: 3, c1: 7, r1: 11 },
    });
    roundTrip(FogEdited.payload, {
      sceneId: "s",
      editId: "e",
      kind: "reveal-polygon",
      shape: {
        kind: "polygon",
        points: [
          [8, 9],
          [13, 9],
          [8, 14],
        ],
      },
    });
    roundTrip(FogEdited.payload, { sceneId: "s", editId: "e", kind: "fog-all" });
    roundTrip(FogUndone.payload, { sceneId: "s", editId: "e" });
    expect(FogEdited.payload.safeParse({ sceneId: "s", editId: "e", kind: "brush" }).success).toBe(
      false,
    );
    expect(FogUndone.payload.safeParse({ sceneId: "s", editId: "e", n: 1 }).success).toBe(false);
  });

  test("FR-FOG-05 shape caps: 3–64 vertices, |value| ≤ 1,024, ints", () => {
    const edit = (shape: unknown) =>
      FogEdited.payload.safeParse({ sceneId: "s", editId: "e", kind: "hide-polygon", shape })
        .success;
    const pts = (n: number) => Array.from({ length: n }, (_, i) => [i, i * i]);
    expect(edit({ kind: "polygon", points: pts(2) })).toBe(false);
    expect(edit({ kind: "polygon", points: pts(64) })).toBe(false); // i² > 1,024 past 32
    expect(edit({ kind: "polygon", points: pts(3) })).toBe(true);
    expect(
      edit({ kind: "polygon", points: Array.from({ length: 65 }, (_, i) => [i % 30, i % 7]) }),
    ).toBe(false);
    expect(edit({ kind: "rect", c0: 0, r0: 0, c1: 1025, r1: 0 })).toBe(false);
    expect(edit({ kind: "rect", c0: 0.5, r0: 0, c1: 1, r1: 0 })).toBe(false);
    expect(edit({ kind: "rect", c0: -1024, r0: 0, c1: 1024, r1: 0 })).toBe(true);
  });
});
