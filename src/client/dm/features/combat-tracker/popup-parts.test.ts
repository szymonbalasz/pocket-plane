// Popup parts registry (FR-MOD-39, ADR-0043; R0): created empty; the popup merges each line's
// `toInput` into a row's apply entry (arrays concatenated) and sums `previewExtra`.
import { describe, expect, test } from "bun:test";
import {
  ApplyCardTarget,
  type CombatantView,
  DamageCardPayload,
} from "@shared/combat-tracker/schemas";
import {
  definePopupPart,
  type PopupPart,
  type PopupRowView,
  partInputs,
  partPreviewExtra,
  popupParts,
} from "./popup-parts";

const card = DamageCardPayload.parse({
  encounterId: "enc",
  attackerId: "k-brakka",
  attackerName: "Brakka",
  attackName: "Greataxe",
  damageType: "slashing",
  mode: "normal",
  crit: false,
  toHit: { rollId: "r1", dice: [[15, true]], constant: 7, total: 22, manual: false, natural: 15 },
  damage: { rollId: "r2", dice: [[8, true]], constant: 4, total: 14, manual: false },
});
const row = (id: string, hit = true): PopupRowView => ({
  targetId: id,
  combatant: { id } as CombatantView,
  hit,
  multiplier: "normal",
  ac: 15,
  hp: { cur: 7, max: 7, temp: 0 },
});
const line = (id: string, triggerId: string, extra: number): PopupPart =>
  definePopupPart<boolean>({
    id,
    Chips: () => null,
    toInput: (on, r) => (on && r.targetId === "g1" ? { triggers: [{ triggerId }] } : {}),
    previewExtra: (on, r) => (on && r.targetId === "g1" ? extra : 0),
  });

describe("FR-MOD-39 popup parts (R0)", () => {
  test("FR-MOD-39 the registry's lines (R2: MOD's defense hint) add nothing to the sprint-2 intent", () => {
    expect(popupParts.map((p) => p.id)).toEqual(["effect-modifiers.defense"]);
    expect(partInputs(popupParts, {}, row("g1"), [row("g1")], card)).toEqual({});
    expect(partPreviewExtra(popupParts, {}, row("g1"), [row("g1")], card)).toBe(0);
  });

  test("FR-MOD-39 lines merge per row in order (arrays concatenated); the entry parses as the intent's target", () => {
    const lines = [line("a.fury", "trg-fury", 6), line("b.mark", "trg-mark", 4)];
    const values = { "a.fury": true, "b.mark": true };
    const rows = [row("g1"), row("g2")];
    const mine = partInputs(lines, values, row("g1"), rows, card);
    expect(mine).toEqual({ triggers: [{ triggerId: "trg-fury" }, { triggerId: "trg-mark" }] });
    expect(partInputs(lines, values, row("g2"), rows, card)).toEqual({});
    expect(partInputs(lines, { "a.fury": true }, row("g1"), rows, card)).toEqual({
      triggers: [{ triggerId: "trg-fury" }],
    });
    expect(
      ApplyCardTarget.safeParse({ ...mine, targetId: "g1", hit: true, multiplier: "normal" })
        .success,
    ).toBe(true);
    expect(partPreviewExtra(lines, values, row("g1"), rows, card)).toBe(10);
  });
});
