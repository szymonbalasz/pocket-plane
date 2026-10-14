import { describe, expect, test } from "bun:test";
import { attackChoices } from "./attack-choices";

const a = (name: string, id?: string) => ({
  name,
  toHit: 4,
  damage: "1d6+2",
  ...(id ? { id } : {}),
});

describe("FR-CHARX-24 OQ-CHARX-12 DM attack picker choices", () => {
  test("FR-CHARX-24 every attack row with an id; a legacy first row as 'the first attack'", () => {
    expect(attackChoices([a("Scimitar", "s"), a("Shortbow", "b")])).toEqual([
      { attack: a("Scimitar", "s"), attackId: "s" },
      { attack: a("Shortbow", "b"), attackId: "b" },
    ]);
    expect(attackChoices([a("Scimitar")])).toEqual([{ attack: a("Scimitar") }]);
    // A later row without id can't be named: left out.
    expect(attackChoices([a("Scimitar"), a("Shortbow")])).toEqual([{ attack: a("Scimitar") }]);
    expect(attackChoices([])).toEqual([]);
  });
});
