// BL-45 (FR-DICE-32, FR-MOD-18): the physical form's Roll never has no visible effect. An empty
// offered trigger group (Divine Fury on Brakka's Flame Tongue damage) stops Roll with a problem
// naming that group; the group is marked (`data-state="invalid"`, `aria-invalid` on the input)
// until the next edit. Static render, as `slot-labels.test.tsx`.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { type FormOptions, formSlots, type SlotInput } from "./logic";
import { checkManual, PartGroup, partForms } from "./roll-control";

const options: FormOptions = {
  expressions: ["2d6+5", "2d6"],
  critExpressions: ["4d6+5", "4d6"],
  slotLabels: ["Slashing", "Fire"],
};
const fury = (expression: string) => ({
  key: "t:trg",
  label: "Divine Fury",
  expression,
  dice: [],
  sign: 1 as const,
  onHit: true as const,
});
const group = (total: string) => ({ total, dice: [] });
const input = (expression: string, base: string, extra = ""): SlotInput => ({
  for: expression,
  base: group(base),
  extra: group(extra),
});

/** Brakka's damage form: Slashing 7, Fire 7 filled; Divine Fury offered, its total `df`. */
function brakka(crit: boolean, df: Record<string, string>) {
  const shown = [input("2d6+5", "7", crit ? "8" : ""), input("2d6", "7", crit ? "6" : "")];
  const slots = formSlots({ ...options, ...(crit ? { crit: true } : {}) }, "normal", shown);
  if (typeof slots === "string") throw new Error(slots);
  const forms = partForms(slots, (i, c) => (i === 1 ? [fury(c ? "2d6+2" : "1d6+2")] : []));
  const inputs = Object.fromEntries(Object.entries(df).map(([k, v]) => [k, group(v)]));
  return { slots, shown, forms, inputs };
}

describe("BL-45 FR-DICE-32 no silent Roll in the physical form", () => {
  test("BL-45 FR-DICE-32 FR-MOD-18 empty Divine Fury total → a problem naming the group, not a silent stop", () => {
    const f = brakka(false, {});
    const r = checkManual(f.slots, f.shown, f.forms, f.inputs);
    expect(r).toEqual({
      ok: false,
      problem: {
        message: "Enter the total for Divine Fury (1d6+2)",
        slot: 1,
        key: "t:trg",
        group: "base",
        die: null,
      },
    });
    const ok = checkManual(f.slots, f.shown, f.forms, { "1|t:trg|1d6+2": group("6") });
    expect(ok).toMatchObject({
      ok: true,
      parts: [[], [{ key: "t:trg", entry: { diceTotal: 6 } }]],
    });
  });

  test("BL-45 FR-DICE-32 a weapon slot's problem has no part key (the slot's own input is marked)", () => {
    const shown = [input("2d6+5", ""), input("2d6", "7")];
    const slots = formSlots(options, "normal", shown);
    if (typeof slots === "string") throw new Error(slots);
    expect(checkManual(slots, shown, [], {})).toEqual({
      ok: false,
      problem: {
        message: "Enter the total for 2d6+5 slashing",
        slot: 0,
        key: null,
        group: "base",
        die: null,
      },
    });
  });

  test("BL-45 FR-DICE-31 nat 20: Divine Fury's extra critical dice empty → the crit sub-group is the problem", () => {
    const f = brakka(true, { "1|t:trg|1d6+2": "6" });
    const r = checkManual(f.slots, f.shown, f.forms, f.inputs);
    expect(r).toMatchObject({
      ok: false,
      problem: { key: "t:trg", group: "extra", die: null, slot: 1 },
    });
    if (r.ok) throw new Error("expected a problem");
    expect(r.problem.message).toBe("Enter the total for Divine Fury (1d6, critical)");
  });

  test("BL-45 FR-DICE-32 the stopped group is marked: data-state invalid + aria-invalid total; others not", () => {
    const f = brakka(false, {});
    const r = checkManual(f.slots, f.shown, f.forms, f.inputs);
    if (r.ok) throw new Error("expected a problem");
    const form = f.forms[0];
    if (!form) throw new Error("no part form");
    const marked = renderToStaticMarkup(
      <PartGroup form={form} inputs={{}} problem={r.problem} onChange={() => {}} />,
    );
    expect(marked).toContain('data-testid="mod-tray-group" data-value="t:trg" data-slot="1"');
    expect(marked).toContain('data-state="invalid"');
    expect(marked).toMatch(/data-testid="mod-tray-group-total"[^>]*aria-invalid="true"/);
    const plain = renderToStaticMarkup(
      <PartGroup form={form} inputs={{}} problem={null} onChange={() => {}} />,
    );
    expect(plain).not.toMatch(/data-state="invalid"|aria-invalid="true"/);
    // Another group's problem leaves this one unmarked.
    const other = renderToStaticMarkup(
      <PartGroup
        form={form}
        inputs={{}}
        problem={{ ...r.problem, key: null, slot: 0 }}
        onChange={() => {}}
      />,
    );
    expect(other).not.toMatch(/data-state="invalid"|aria-invalid="true"/);
  });
});
