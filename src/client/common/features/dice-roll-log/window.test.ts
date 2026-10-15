import { expect, test } from "bun:test";
import { GAME_LOG_ENTRY_TYPE } from "@shared/dice-roll-log/schemas";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { diceLogWindowBase } from "./window";

const withEntries = (...ns: number[]): RecordStore => ({
  ...emptyStore(),
  records: {
    [GAME_LOG_ENTRY_TYPE]: Object.fromEntries(ns.map((n) => [`e${n}`, { id: `e${n}`, n }])),
  },
});

test("FR-DICE-33 dice.log activity = the highest entry n this client holds", () => {
  expect(diceLogWindowBase.activity(emptyStore())).toBe(0);
  expect(diceLogWindowBase.activity(withEntries(3, 7, 5))).toBe(7);
  // A player's store holds public entries only: a hidden DM roll never changes it.
  expect(diceLogWindowBase.activity(withEntries(3, 5))).toBe(5);
});
