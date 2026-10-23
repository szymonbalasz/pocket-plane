// Compendium events (CMP §9) and entities' `ImportedEntityUpdated` (FR-CMP-08): registered once,
// logged, not undoable; strict payloads.
import { describe, expect, test } from "bun:test";
import {
  CompendiumEntryDeleted,
  CompendiumEntrySaved,
  CompendiumImported,
  ImportCounts,
} from "./compendium";
import { ImportedEntityUpdated } from "./entities";
import { domainEvents } from "./index";

const CMP_EVENTS = [
  "CompendiumImported",
  "CompendiumEntrySaved",
  "CompendiumEntryDeleted",
  "ImportedEntityUpdated",
];

const zero = { created: 0, updated: 0, existing: 0 };
const counts = {
  monster: { created: 5, updated: 0, existing: 0 },
  spell: zero,
  item: zero,
  condition: zero,
  feature: zero,
  rule: zero,
};

describe("CMP domain events (§9)", () => {
  test("CMP §9 events registered once, logged, none undoable", () => {
    const defs = domainEvents.filter((e) => CMP_EVENTS.includes(e.type));
    expect(defs.map((e) => e.type).sort()).toEqual([...CMP_EVENTS].sort());
    expect(defs.every((e) => e.logged && !e.undoable)).toBe(true);
    const types = domainEvents.map((e) => e.type);
    expect(new Set(types).size).toBe(types.length);
  });

  test("FR-CMP-07 FR-CMP-08 payloads strict; counts per kind × outcome", () => {
    const p = { source: "srd-5.1", version: "mini", counts };
    expect(CompendiumImported.payload.parse(p)).toEqual(p);
    expect(CompendiumImported.payload.safeParse({ ...p, extra: 1 }).success).toBe(false);
    expect(ImportCounts.safeParse({ ...counts, race: zero }).success).toBe(false);
    expect(ImportCounts.safeParse({ ...counts, spell: { ...zero, skipped: 1 } }).success).toBe(
      false,
    );
    expect(ImportedEntityUpdated.payload.safeParse({ entityId: "e" }).success).toBe(true);
    expect(
      CompendiumEntrySaved.payload.safeParse({ entryId: "e", kind: "item", shared: true }).success,
    ).toBe(true);
    expect(CompendiumEntryDeleted.payload.safeParse({ entryId: "e", x: 1 }).success).toBe(false);
  });
});
