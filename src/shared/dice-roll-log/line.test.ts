import { describe, expect, test } from "bun:test";
import { lineText } from "./kind-types";
import { getLogKind, logKindNames } from "./kinds";
import { formatEntry, UNSUPPORTED_ENTRY } from "./line";
import type { RollPayloadItem } from "./schemas";

const item = (p: Partial<RollPayloadItem>): RollPayloadItem => ({
  rollId: "r1",
  expression: "1d20+4",
  mode: "normal",
  manual: false,
  dice: [{ faces: 20, value: 12, kept: true }],
  constant: 4,
  total: 16,
  natural: 12,
  label: null,
  ...p,
});
const text = (items: RollPayloadItem[], extra: { undone?: boolean; actorName?: string } = {}) =>
  lineText(
    formatEntry({ kind: "roll", actorName: extra.actorName ?? "Goblin", payload: items, ...extra })
      .segments,
  );

describe("FR-DICE-20 roll line", () => {
  test("FR-DICE-20 plain roll: actor — label or expression: dice + constants = total", () => {
    expect(text([item({})])).toBe("Goblin — 1d20+4: 12 + 4 = 16");
    expect(text([item({ label: "Scimitar" })])).toBe("Goblin — Scimitar: 12 + 4 = 16");
    expect(
      text([
        item({
          expression: "2d6-1",
          dice: [
            { faces: 6, value: 3, kept: true },
            { faces: 6, value: 5, kept: true },
          ],
          constant: -1,
          total: 7,
          natural: null,
        }),
      ]),
    ).toBe("Goblin — 2d6-1: 3 + 5 - 1 = 7");
    expect(
      text([
        item({
          expression: "1d20",
          constant: 0,
          total: 12,
        }),
      ]),
    ).toBe("Goblin — 1d20: 12 = 12");
  });

  test("FR-DICE-20 adv / dis: marker and the dropped die struck through", () => {
    const adv = item({
      expression: "2d20kh1+4",
      mode: "advantage",
      dice: [
        { faces: 20, value: 5, kept: false },
        { faces: 20, value: 12, kept: true },
      ],
    });
    expect(text([adv])).toBe("Goblin — 2d20kh1+4 (adv): ~5~ 12 + 4 = 16");
    const segs = formatEntry({ kind: "roll", actorName: "Goblin", payload: [adv] }).segments;
    expect(segs.find((s) => s.style === "dropped")?.text).toBe("5");
    expect(segs.find((s) => s.style === "actor")?.text).toBe("Goblin");
    expect(segs.find((s) => s.style === "total")?.text).toBe("16");
    const dis = item({
      expression: "2d20kl1",
      mode: "disadvantage",
      dice: [
        { faces: 20, value: 9, kept: true },
        { faces: 20, value: 17, kept: false },
      ],
      constant: 0,
      total: 9,
      natural: 9,
    });
    expect(text([dis])).toBe("Goblin — 2d20kl1 (dis): 9 ~17~ = 9");
  });

  test("FR-DICE-20 natural 20 / natural 1", () => {
    const nat = (v: number) =>
      item({ dice: [{ faces: 20, value: v, kept: true }], total: v + 4, natural: v });
    expect(text([nat(20)])).toBe("Goblin — 1d20+4: 20 + 4 = 24 — natural 20!");
    expect(text([nat(1)])).toBe("Goblin — 1d20+4: 1 + 4 = 5 — natural 1");
  });

  test("FR-DICE-20 manual: physical badge; total-only of several dice shows the dice sum", () => {
    expect(
      text([
        item({
          expression: "1d6+2",
          manual: true,
          dice: [{ faces: 6, value: 5, kept: true }],
          constant: 2,
          total: 7,
          natural: null,
        }),
      ]),
    ).toBe("Goblin — 1d6+2: 5 + 2 = 7 (physical)");
    expect(
      text([
        item({
          expression: "2d6+2",
          manual: true,
          dice: [
            { faces: 6, value: null, kept: true },
            { faces: 6, value: null, kept: true },
          ],
          constant: 2,
          total: 9,
          natural: null,
        }),
      ]),
    ).toBe("Goblin — 2d6+2: 7 + 2 = 9 (physical)");
  });

  test("FR-MOD-17 physical adv from an effect the player can't see: the server's d20 says '(rolled for you)', the reason '(DM)'", () => {
    const line = text([
      item({
        expression: "2d20kh1+4",
        mode: "advantage",
        manual: true,
        dice: [
          { faces: 20, value: 11, kept: true },
          { faces: 20, value: 7, kept: false, auto: true },
        ],
        total: 15,
        natural: 11,
        modes: [null],
      }),
    ]);
    expect(line).toBe(
      "Goblin — 2d20kh1+4 (adv: (DM)): 11 ~7~ (rolled for you) + 4 = 15 (physical)",
    );
  });

  test("FR-DICE-26 multi-roll entry: one line, one part per roll", () => {
    expect(
      text(
        [
          item({ label: "Shortsword" }),
          item({
            rollId: "r2",
            expression: "1d6+2",
            label: "Shortsword damage",
            dice: [{ faces: 6, value: 4, kept: true }],
            constant: 2,
            total: 6,
            natural: null,
          }),
        ],
        { actorName: "Mira" },
      ),
    ).toBe("Mira — Shortsword: 12 + 4 = 16; Shortsword damage: 4 + 2 = 6");
  });

  test("FR-DICE-21 undone entries get an undone badge", () => {
    expect(text([item({})], { undone: true })).toBe("Goblin — 1d20+4: 12 + 4 = 16 (undone)");
  });
});

describe("FR-DICE-18 kind registry", () => {
  test("FR-DICE-18 dice ships `roll`; unknown kinds and bad payloads render as Unsupported entry", () => {
    expect(logKindNames()).toContain("roll");
    expect(getLogKind("roll")?.payload.safeParse([item({})]).success).toBe(true);
    expect(getLogKind("nope")).toBeUndefined();
    expect(formatEntry({ kind: "nope", actorName: "X", payload: {} })).toEqual({
      segments: [{ text: UNSUPPORTED_ENTRY, style: "muted" }],
      supported: false,
    });
    expect(formatEntry({ kind: "roll", actorName: "X", payload: [] }).supported).toBe(false);
  });
});
