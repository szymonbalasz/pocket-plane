import { expect, test } from "bun:test";
import { startReason } from "./start-reason";

const c = (name: string, initiative: number | null, removed = false) => ({
  name,
  initiative,
  removed,
});

test("BL-02 names combatants without initiative; removed rows don't count", () => {
  expect(
    startReason([c("Goblin", 12), c("Mira", null), c("Thorn", null), c("Wolf", null, true)]),
  ).toBe("2 without initiative: Mira, Thorn");
});

test("BL-02 max 3 names, then +N", () => {
  expect(startReason([c("A", null), c("B", null), c("C", null), c("D", null), c("E", null)])).toBe(
    "5 without initiative: A, B, C +2",
  );
});

test("BL-02 no reason when everyone has initiative", () => {
  expect(startReason([c("Mira", 14), c("Thorn", 10), c("Wolf", null, true)])).toBeNull();
});

test("FR-CBT-108 owner without initiative: companions acting with their owner never count as missing; own ones do", () => {
  const rows = [
    { ...c("Mira", 15), turnMode: null },
    { ...c("Owlbear", null), turnMode: "after-owner" as const },
    { ...c("Wolf", null), turnMode: "in-owner-turn" as const },
    { ...c("Fire Elemental 3", null), turnMode: "own" as const },
  ];
  expect(startReason(rows)).toBe("1 without initiative: Fire Elemental 3");
  expect(startReason(rows.slice(0, 3))).toBeNull();
});
