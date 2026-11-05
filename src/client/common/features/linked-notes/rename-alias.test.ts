// NOTES N6 client (FR-NOTES-11): chips of a renamed note stay solid: its old folded title keeps
// resolving to it for a few seconds (its record can land before its links' rewrite), never over
// a live note that holds that title, and not after the alias expires.
import { describe, expect, test } from "bun:test";
import { titlesByFold } from "./link-state";
import { RENAME_ALIAS_MS, renamedAliases, withAliases } from "./logic";

describe("linked-notes rename aliases (N6)", () => {
  test("FR-NOTES-11 a renamed note's old title resolves to it for a few seconds, never over a live title", () => {
    const aliases = new Map<string, { note: { id: string; title: string }; until: number }>();
    const before = new Map([
      ["n1", "Burnt Ledger"],
      ["n2", "Quest log"],
    ]);
    const after = [
      { id: "n1", title: "Ash Ledger" },
      { id: "n2", title: "Quest Log" }, // case only: same folded title, no alias
    ];
    renamedAliases(before, after, 1000, aliases);
    expect([...aliases.keys()]).toEqual(["burnt ledger"]);
    const byFold = withAliases(titlesByFold(after), aliases, 1000);
    expect(byFold.get("burnt ledger")).toEqual({ id: "n1", title: "Ash Ledger" });
    expect(byFold.get("ash ledger")?.id).toBe("n1");
    // A live note that takes the old title wins over the alias.
    const taken = [...after, { id: "n3", title: "Burnt ledger" }];
    expect(withAliases(titlesByFold(taken), aliases, 1000).get("burnt ledger")?.id).toBe("n3");
    // Expired: gone.
    expect(
      withAliases(titlesByFold(after), aliases, 1000 + RENAME_ALIAS_MS).has("burnt ledger"),
    ).toBe(false);
    renamedAliases(
      new Map(after.map((t) => [t.id, t.title])),
      after,
      1000 + RENAME_ALIAS_MS,
      aliases,
    );
    expect(aliases.size).toBe(0);
  });
});
