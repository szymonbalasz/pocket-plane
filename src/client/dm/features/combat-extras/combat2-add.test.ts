// Sprint 2 (fix/combat2-add), DM combat-extras logic: Add dialog rows → items (FR-CBTX-44) and
// the link menu / popup hint (FR-CBTX-45). Pure.
import { describe, expect, test } from "bun:test";
import { type AddRow, addItems, addPick, instancesOf } from "./add-dialog";
import { linkCandidates, linkedCombatant, linkHint } from "./link";

describe("FR-CBTX-44 add dialog", () => {
  test("FR-CBTX-44 rows → items; a pick adds 1 or +1; characters count 1", () => {
    let rows: AddRow[] = [];
    rows = addPick(rows, { id: "gob", name: "Goblin", kind: "monster" });
    rows = addPick(rows, { id: "gob", name: "Goblin", kind: "monster" });
    rows = addPick(rows, { id: "bram", name: "Bram", kind: "character" });
    rows = addPick(rows, { id: "bram", name: "Bram", kind: "character" });
    rows = rows.map((r) => (r.id === "gob" ? { ...r, hpMode: "rolled" as const } : r));
    expect(instancesOf(rows)).toBe(3);
    expect(addItems(rows)).toEqual([
      { definitionId: "gob", quantity: 2, hpMode: "rolled" },
      { characterId: "bram" },
    ]);
  });
});

describe("FR-CBTX-45 link menu", () => {
  const enc = { id: "e", sceneId: "s" };
  const c = (id: string, o: Record<string, unknown> = {}) => ({
    id,
    encounterId: "e",
    entityId: "gob",
    tokenId: null as string | null,
    name: id,
    active: true,
    removed: false,
    ...o,
  });
  const combatants = [
    c("Goblin", { tokenId: "t1" }),
    c("Goblin 6"),
    c("Goblin 7"),
    c("Wolf 2", { entityId: "wolf" }),
    c("Goblin 8", { removed: true }),
    c("Goblin 9", { active: false }),
    c("Goblin X", { encounterId: "other" }),
  ];
  const tok = (id: string, definitionId = "gob", sceneId = "s") => ({ id, definitionId, sceneId });

  test("FR-CBTX-45 link menu: offered only on an unbound token with token-less active combatants of its definition; several → submenu", () => {
    expect(linkCandidates(tok("t2"), combatants, enc).map((x) => x.name)).toEqual([
      "Goblin 6",
      "Goblin 7",
    ]);
    expect(linkCandidates(tok("t1"), combatants, enc)).toEqual([]);
    expect(linkCandidates(tok("t3", "wolf"), combatants, enc).map((x) => x.name)).toEqual([
      "Wolf 2",
    ]);
    expect(linkCandidates(tok("t4", "elite"), combatants, enc)).toEqual([]);
    expect(linkCandidates(tok("t2", "gob", "other-scene"), combatants, enc)).toEqual([]);
    expect(linkCandidates(tok("t2"), combatants, null)).toEqual([]);
    expect(linkedCombatant(tok("t1"), combatants, enc)?.name).toBe("Goblin");
    expect(linkedCombatant(tok("t2"), combatants, enc)).toBeNull();
  });

  test("FR-CBTX-45 popup hint names the token-less combatants a selected token could take", () => {
    const tokens = [tok("t1"), tok("t2"), tok("t3", "wolf"), tok("t4", "elite")];
    expect(linkHint(["t3"], tokens, combatants, enc)).toBe(
      "Wolf 2 has no token: link it from the token menu",
    );
    expect(linkHint(["t2", "t1"], tokens, combatants, enc)).toBe(
      "Goblin 6, Goblin 7 have no token: link it from the token menu",
    );
    expect(linkHint(["t1", "t4"], tokens, combatants, enc)).toBeNull();
  });
});
