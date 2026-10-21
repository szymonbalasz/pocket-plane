// FR-CBT-136 (sprint 7): the Damage / heal dialog's From; the undo Tooltip names the source.
import { describe, expect, test } from "bun:test";
import type { HpChangeRecord } from "@shared/combat-tracker/schemas";
import { autoLabel, FROM_AUTO, FROM_DM, fromOptions, sourceIdFor } from "./hp-from";
import { undoLabel } from "./targets";

const fighters = [
  { id: "sela", name: "Sela" },
  { id: "mira", name: "Mira" },
  { id: "gone", name: "Goblin", removed: true },
  { id: "left", name: "Owlbear", active: false },
];

describe("FR-CBT-136 From", () => {
  test("FR-CBT-136 From options: DM + the fight's active, non-removed combatants", () => {
    expect(fromOptions(fighters).map((o) => o.name)).toEqual(["Sela", "Mira"]);
  });

  test("FR-CBT-136 From preset: heal = the turn combatant, damage = DM (OQ-CBT-89 A); a pick wins", () => {
    const opts = fromOptions(fighters);
    expect(sourceIdFor("heal", FROM_AUTO, "sela", opts)).toBe("sela");
    expect(sourceIdFor("damage", FROM_AUTO, "sela", opts)).toBeUndefined();
    expect(sourceIdFor("heal", FROM_AUTO, null, opts)).toBeUndefined();
    expect(sourceIdFor("heal", FROM_AUTO, "gone", opts)).toBeUndefined();
    expect(sourceIdFor("heal", FROM_DM, "sela", opts)).toBeUndefined();
    expect(sourceIdFor("damage", "mira", "sela", opts)).toBe("mira");
    expect(autoLabel("sela", opts)).toBe("Heal: Sela · Damage: DM");
    expect(autoLabel(null, opts)).toBe("Heal: DM · Damage: DM");
  });

  test("FR-CBT-136 undo copy: the Tooltip names the source", () => {
    const row = {
      id: "h1",
      seq: 1,
      kind: "heal",
      raw: 8,
      hit: null,
      cardId: null,
      attackerName: "Sela",
      targetName: "Mira",
      undone: false,
    } as unknown as HpChangeRecord;
    expect(undoLabel([row])?.text).toBe("Undo: Sela → Mira, heal 8");
  });
});
