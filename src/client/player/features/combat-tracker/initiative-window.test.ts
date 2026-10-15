import { expect, test } from "bun:test";
import { playerInitiativeWindow } from "./initiative-window";

test("FR-CBT-77 player Initiative grows to content; activity = round:playerTurnCombatantId", () => {
  expect(playerInitiativeWindow.growToContent).toBe(true);
  const store = (enc: object) =>
    ({ you: null, seq: 0, records: { encounter: { e1: enc } } }) as never;
  expect(
    playerInitiativeWindow.activity?.(
      store({ id: "e1", status: "started", round: 3, playerTurnCombatantId: "k2" }),
    ),
  ).toBe("3:k2");
  expect(
    playerInitiativeWindow.activity?.(
      store({ id: "e1", status: "started", round: 3, playerTurnCombatantId: null }),
    ),
  ).toBe("3:");
});
