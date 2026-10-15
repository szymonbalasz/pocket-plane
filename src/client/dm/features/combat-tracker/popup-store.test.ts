// sim-5 glitch 1: a popup's targets are the live map selection (FR-CBT-33), so whatever a popup
// carried must not reach the next card's popup.
import { beforeEach, describe, expect, test } from "bun:test";
import { getMapSelection, setMapSelection } from "../scenes-map/selection";
import { useCombatDialogs } from "./popup-store";

const dialogs = () => useCombatDialogs.getState();

describe("FR-CBT-54 no stale targets", () => {
  beforeEach(() => {
    dialogs().closeCard();
    setMapSelection([]);
  });

  test("FR-CBT-54 opening a popup keeps the current map selection (its selection rows)", () => {
    setMapSelection(["goblin-3", "goblin-4"]);
    dialogs().openCard("wolf-card");
    expect(getMapSelection().tokenIds).toEqual(["goblin-3", "goblin-4"]);
  });

  test("FR-CBT-54 Dismiss / Later / Esc (any close) clears what the popup carried", () => {
    dialogs().openCard("wolf-card");
    setMapSelection(["goblin-3", "goblin-4"]);
    dialogs().closeCard();
    expect(getMapSelection().tokenIds).toEqual([]);
    // Mira's next card opens with no rows unless the DM selects again.
    dialogs().openCard("mira-card");
    expect(getMapSelection().tokenIds).toEqual([]);
  });

  test("FR-CBT-54 opening another card over an open popup drops the first popup's targets", () => {
    dialogs().openCard("wolf-card");
    setMapSelection(["goblin-3"]);
    dialogs().openCard("mira-card", { x: 560, y: 92, w: 320, h: 90 });
    expect(dialogs().cardId).toBe("mira-card");
    expect(getMapSelection().tokenIds).toEqual([]);
  });
});
