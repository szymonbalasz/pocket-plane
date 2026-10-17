// FR-DICEX-42 die-shape chips (DICEX §13 unit): one `DieShape` per die type, static render.
import { describe, expect, test } from "bun:test";
import { STYLE_LOOK } from "@shared/dice-extras/looks";
import { throwDice } from "@shared/dice-extras/throw";
import { renderToStaticMarkup } from "react-dom/server";
import { DieShape, d100Faces, dieShapeOf } from "./DieShape";
import { FlatDie } from "./FlatDie";

const html = (node: React.ReactNode) => renderToStaticMarkup(node);
const attr = (h: string, name: string) => h.match(new RegExp(`${name}="([^"]*)"`))?.[1];
/** The numbers drawn inside the shape(s). */
const texts = (h: string) => [...h.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

describe("FR-DICEX-42 die-shape chips", () => {
  test("FR-DICEX-42 die-shape chips per die type: d4 / d6 / d8 / d10 / d12 / d20 → data-shape", () => {
    for (const faces of [4, 6, 8, 10, 12, 20]) {
      const h = html(<DieShape faces={faces} value={3} />);
      expect(attr(h, "data-testid")).toBe("dicex-die");
      expect(attr(h, "data-shape")).toBe(`d${faces}`);
      expect(attr(h, "data-faces")).toBe(String(faces));
      expect(attr(h, "data-value")).toBe("3");
      expect(texts(h)).toEqual(["3"]);
      expect(h.match(/<svg/g)).toHaveLength(1);
    }
    // d20: flat icosahedron = hexagon outline + centre triangle (a second path), value centred.
    const d20 = html(<DieShape faces={20} value={13} />);
    expect(d20.match(/<path/g)).toHaveLength(2);
    expect(d20).toContain('x="50"');
    expect(d20).toContain('text-anchor="middle"');
    expect(attr(d20, "aria-label")).toBe("d20: 13");
  });

  test("FR-DICEX-42 die-shape chips: d100 = tens kite + units kite (100 → '00' + '0')", () => {
    expect(d100Faces(100)).toEqual(["00", "0"]);
    expect(d100Faces(40)).toEqual(["40", "0"]);
    expect(d100Faces(7)).toEqual(["00", "7"]);
    expect(d100Faces(47)).toEqual(["40", "7"]);
    const h = html(<DieShape faces={100} value={100} />);
    expect(attr(h, "data-shape")).toBe("d10");
    expect(attr(h, "data-faces")).toBe("100");
    expect(h.match(/<svg/g)).toHaveLength(2);
    expect(texts(h)).toEqual(["00", "0"]);
    // A throw's d100 arrives split (FR-DICEX-14): each part one kite.
    const t = throwDice([
      {
        id: "e1",
        n: 1,
        kind: "roll",
        public: true,
        rollerRole: "player",
        rollerPlayerId: "p1",
        actorName: "Mira",
        payload: [
          {
            expression: "1d100",
            manual: false,
            dice: [{ faces: 100, value: 47, kept: true }],
            constant: 0,
            total: 47,
            label: null,
          },
        ],
      },
    ]);
    const parts = (t?.dice ?? []).map((d) => texts(html(<FlatDie die={d} settled />)));
    expect(parts).toEqual([["40"], ["7"]]);
  });

  test("FR-DICEX-42 die-shape chips: d3, d1000, a manual total → round", () => {
    expect(dieShapeOf(3)).toBe("round");
    expect(dieShapeOf(2)).toBe("round");
    expect(dieShapeOf(1000)).toBe("round");
    expect(dieShapeOf(null)).toBe("round");
    for (const faces of [3, 1000, null]) {
      const h = html(<DieShape faces={faces} value={2} />);
      expect(attr(h, "data-shape")).toBe("round");
      expect(h).not.toContain("<svg");
      expect(h).toContain("rounded-full");
    }
    // A manual total of several dice (no per-die values): the throw's chip is round.
    const t = throwDice([
      {
        id: "e1",
        n: 1,
        kind: "roll",
        public: true,
        rollerRole: "player",
        rollerPlayerId: "p1",
        actorName: "Mira",
        payload: [
          {
            expression: "2d6+2",
            manual: true,
            dice: [
              { faces: 6, value: null, kept: true },
              { faces: 6, value: null, kept: true },
            ],
            constant: 2,
            total: 9,
            label: null,
          },
        ],
      },
    ]);
    const chip = html(<FlatDie die={t?.dice[0] as NonNullable<typeof t>["dice"][number]} />);
    expect(attr(chip.slice(chip.indexOf("dicex-die")), "data-shape")).toBe("round");
    expect(chip).toContain(">7<");
    expect(chip).toContain("physical");
  });

  test("FR-DICEX-42 die-shape chips: physical dice with per-die values keep their shape (d6, d100 kites)", () => {
    const t = throwDice([
      {
        id: "e1",
        n: 1,
        kind: "roll",
        public: true,
        rollerRole: "player",
        rollerPlayerId: "p1",
        actorName: "Mira",
        payload: [
          {
            expression: "2d6-1",
            manual: true,
            dice: [
              { faces: 6, value: 4, kept: true },
              { faces: 6, value: 5, kept: true },
            ],
            constant: -1,
            total: 8,
            label: null,
          },
          {
            expression: "1d100",
            manual: true,
            dice: [{ faces: 100, value: 46, kept: true }],
            constant: 0,
            total: 46,
            label: null,
          },
        ],
      },
    ]);
    const dice = t?.dice ?? [];
    expect(dice).toHaveLength(3);
    const shapes = dice.map((d) => {
      const h = html(<FlatDie die={d} />);
      expect(h).toContain("physical");
      expect(attr(h, "data-flat")).toBe("true");
      return [attr(h.slice(h.indexOf("dicex-die")), "data-shape"), texts(h)];
    });
    expect(shapes).toEqual([
      ["d6", ["4"]],
      ["d6", ["5"]],
      ["d10", ["40", "6"]],
    ]);
  });

  test("FR-DICEX-42 die-shape chips: dropped struck + 40 %, offered dashed never struck, colours from the look", () => {
    const look = STYLE_LOOK.crimson;
    const dropped = html(<DieShape faces={20} value={7} kept={false} look={look} />);
    expect(attr(dropped, "data-kept")).toBe("false");
    expect(dropped).toContain("opacity-40");
    expect(dropped).toContain("<line");
    const offered = html(<DieShape faces={8} value={5} offered look={look} />);
    expect(attr(offered, "data-offered")).toBe("true");
    expect(offered).toContain("stroke-dasharray");
    expect(offered).not.toContain("<line");
    expect(offered).not.toContain("opacity-40");
    // Fill = look body; number and outline = look pips.
    expect(offered).toContain(`fill="${look.body}"`);
    expect(offered).toContain(`stroke="${look.pips}"`);
    expect(offered).toMatch(new RegExp(`<text[^>]*fill="${look.pips}"`));
    const plain = html(<DieShape faces={6} value={4} look={look} />);
    expect(plain).not.toContain("stroke-dasharray");
    expect(plain).not.toContain("<line");
  });

  test("FR-DICEX-42 die-shape chips: sizes sm 18 px (log), md 36 px (popup, tray, zone)", () => {
    expect(attr(html(<DieShape faces={20} value={1} size="sm" />), "width")).toBe("18");
    expect(attr(html(<DieShape faces={20} value={1} />), "width")).toBe("36");
  });

  test("FR-DICEX-42 FlatDie keeps its test ID and data, the shape inside is the only dicex-die", () => {
    const t = throwDice([
      {
        id: "e1",
        n: 1,
        kind: "roll",
        public: true,
        rollerRole: "player",
        rollerPlayerId: "p1",
        actorName: "Mira",
        payload: [
          {
            expression: "2d20kh1+4",
            manual: false,
            dice: [
              { faces: 20, value: 5, kept: false },
              { faces: 20, value: 12, kept: true },
            ],
            constant: 4,
            total: 16,
            label: null,
          },
        ],
      },
    ]);
    const [a, b] = (t?.dice ?? []).map((d) => html(<FlatDie die={d} settled />));
    expect(a).toMatch(
      /^<span data-testid="dicex-throw-die"[^>]*data-value="5"[^>]*data-kept="false"/,
    );
    expect(a?.match(/data-testid=/g)).toHaveLength(2);
    expect(a).toContain('data-shape="d20"');
    expect(a).toContain("opacity-40");
    expect(b).toContain('data-settled="12"');
  });
});
