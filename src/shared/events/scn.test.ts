// scene-tools events (SCN §9): registered once, logged, not ADR-0016-undoable; strict payloads.
import { describe, expect, test } from "bun:test";
import { domainEvents } from "./index";
import * as scn from "./scene-tools";
import { isDomainEventDef } from "./types";

const NAMES = [
  "StructureEdited",
  "PropPlaced",
  "PropUpdated",
  "PropHidden",
  "PropRevealed",
  "PropDuplicated",
  "PropDeleted",
  "TemplatePlaced",
  "TemplateUpdated",
  "TemplateDeleted",
  "TemplatesCleared",
  "DiagonalRuleSet",
];

describe("SCN domain events (§9)", () => {
  test("FR-SCN-33 every SCN event registered once, logged, not undoable", () => {
    const own = Object.values<unknown>(scn).filter(isDomainEventDef);
    expect(own.map((e) => e.type).sort()).toEqual([...NAMES].sort());
    const defs = domainEvents.filter((e) => NAMES.includes(e.type));
    expect(defs).toHaveLength(NAMES.length);
    expect(defs.every((e) => e.logged && !e.undoable)).toBe(true);
    const types = domainEvents.map((e) => e.type);
    expect(new Set(types).size).toBe(types.length);
  });

  test("FR-SCN-33 one structure event for every op; payloads strict", () => {
    for (const op of scn.STRUCTURE_OPS) {
      expect(scn.StructureEdited.payload.safeParse({ sceneId: "s", op, ns: [1, 2] }).success).toBe(
        true,
      );
    }
    expect(
      scn.StructureEdited.payload.safeParse({ sceneId: "s", op: "lock", ns: [] }).success,
    ).toBe(false);
    expect(
      scn.StructureEdited.payload.safeParse({ sceneId: "s", op: "setDoor", ns: [1], state: 2 })
        .success,
    ).toBe(false);
    expect(scn.PropHidden.payload.safeParse({ propId: "p" }).success).toBe(true);
    expect(scn.PropHidden.payload.safeParse({ propId: "p", assetId: "a" }).success).toBe(false);
    expect(
      scn.TemplatesCleared.payload.safeParse({ sceneId: "s", templateIds: ["a", "b"] }).success,
    ).toBe(true);
    expect(scn.DiagonalRuleSet.payload.safeParse({ rule: "5" }).success).toBe(true);
    expect(scn.DiagonalRuleSet.payload.safeParse({ rule: "10" }).success).toBe(false);
  });
});
