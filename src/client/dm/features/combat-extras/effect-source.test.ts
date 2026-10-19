// FR-CBTX-55 (OQ-CBTX-28 A, sim-8 #10): the Effect… dialog's default source — the turn
// combatant if visible, else the first target's own combatant, else none. The dialog on the
// Wolf's turn and the source sent: e2e/init-chips-effect.e2e.ts (W8).
import { describe, expect, test } from "bun:test";
import type { CombatantView } from "@shared/combat-tracker/schemas";
import { defaultEffectSource } from "./effect-source";

const k = (id: string, o: Partial<CombatantView> = {}) =>
  ({
    id,
    kind: "monster",
    entityId: `ent-${id}`,
    hidden: false,
    active: true,
    removed: false,
    ...o,
  }) as CombatantView;

const wolf = k("k-wolf", { hidden: true });
const mira = k("k-mira", { kind: "pc", entityId: "ch-mira" });
const goblin = k("k-goblin");
const rows = [wolf, mira, goblin];

describe("FR-CBTX-55 effect source default", () => {
  test("FR-CBTX-55 effect source default: hidden Wolf on turn → the target's own combatant (Mira), 'target'", () => {
    expect(defaultEffectSource(rows, "k-wolf", [{ characterId: "ch-mira" }])).toEqual({
      id: "k-mira",
      why: "target",
    });
    // A monster target by combatant; only the first target counts.
    expect(
      defaultEffectSource(rows, "k-wolf", [
        { combatantId: "k-goblin" },
        { characterId: "ch-mira" },
      ]),
    ).toEqual({ id: "k-goblin", why: "target" });
  });

  test("FR-CBTX-55 effect source default: a visible turn combatant → it, 'turn'", () => {
    expect(defaultEffectSource(rows, "k-goblin", [{ characterId: "ch-mira" }])).toEqual({
      id: "k-goblin",
      why: "turn",
    });
    // Removed turn combatant: not the source.
    expect(
      defaultEffectSource([wolf, mira, k("k-goblin", { removed: true })], "k-goblin", [
        { characterId: "ch-mira" },
      ]),
    ).toEqual({ id: "k-mira", why: "target" });
  });

  test("FR-CBTX-55 effect source default: target not in combat and a hidden turn → none", () => {
    expect(defaultEffectSource(rows, "k-wolf", [{ characterId: "ch-thorn" }])).toEqual({
      id: null,
      why: "none",
    });
    // A target whose row is removed or benched has no own active combatant.
    expect(
      defaultEffectSource(
        [wolf, k("k-mira", { kind: "pc", entityId: "ch-mira", active: false })],
        "k-wolf",
        [{ characterId: "ch-mira" }],
      ),
    ).toEqual({ id: null, why: "none" });
    expect(defaultEffectSource(rows, null, [])).toEqual({ id: null, why: "none" });
    // A hidden target is its own source (the DM picked that creature; OQ-CBTX-28 A as worded).
    expect(defaultEffectSource([wolf], "k-wolf", [{ combatantId: "k-wolf" }])).toEqual({
      id: "k-wolf",
      why: "target",
    });
  });
});
