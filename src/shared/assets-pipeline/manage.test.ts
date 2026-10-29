// ASSET §13.1 (#386): the in-use reject text (FR-ASSET-64).
import { describe, expect, test } from "bun:test";
import { type AssetUse, inUseMessage, USES_SHOWN } from "./manage";

describe("in-use message (FR-ASSET-64)", () => {
  test("FR-ASSET-64 in use message: names the first five uses, counts the rest; the pause card has no name", () => {
    expect(inUseMessage([{ kind: "scene map", name: "Town" }])).toBe(
      "In use: Town (scene map). Change those first.",
    );
    expect(inUseMessage([{ kind: "pause card", name: null }])).toBe(
      "In use: pause card. Change those first.",
    );
    const tokens: AssetUse[] = Array.from({ length: USES_SHOWN + 3 }, (_, i) => ({
      kind: "token",
      name: `Goblin ${i + 1}`,
    }));
    expect(inUseMessage(tokens)).toBe(
      "In use: Goblin 1 (token), Goblin 2 (token), Goblin 3 (token), Goblin 4 (token), Goblin 5 (token) and 3 more. Change those first.",
    );
  });
});
