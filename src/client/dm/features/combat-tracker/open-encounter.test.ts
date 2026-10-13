import { expect, test } from "bun:test";
import {
  type OpenEncounterBackend,
  openEncounterKey,
  readOpenEncounter,
  writeOpenEncounter,
} from "./open-encounter";

function memory(): OpenEncounterBackend & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

test("Encounters window remembers the open encounter per campaign (glitch 5)", () => {
  const m = memory();
  const b = () => m;
  expect(readOpenEncounter("camp-1", b)).toBeNull();
  writeOpenEncounter("camp-1", "enc-abc_1", b);
  expect(m.data.get(openEncounterKey("camp-1"))).toBe("enc-abc_1");
  expect(readOpenEncounter("camp-1", b)).toBe("enc-abc_1");
  expect(readOpenEncounter("camp-2", b)).toBeNull(); // other campaign: list
  writeOpenEncounter("camp-1", null, b); // Back → list
  expect(readOpenEncounter("camp-1", b)).toBeNull();
  expect(m.data.size).toBe(0);
});

test("Encounters window: bad or blocked storage → the list, never a throw", () => {
  const m = memory();
  m.data.set(openEncounterKey("camp-1"), "not an id!");
  expect(readOpenEncounter("camp-1", () => m)).toBeNull();
  const blocked = () => {
    throw new Error("SecurityError");
  };
  expect(readOpenEncounter("camp-1", blocked)).toBeNull();
  expect(() => writeOpenEncounter("camp-1", "enc-1", blocked)).not.toThrow();
  expect(readOpenEncounter(null, () => m)).toBeNull();
});
