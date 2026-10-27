// Kit parts (kit-parity FR-KIT-01, -05, -07): Medallion, Result box, HP bar. One markup for every
// theme, their test IDs and `data-slot` hooks, and the gilt.css KIT block that styles them.
// Static server render.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { emptyStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { SyncContext, type SyncState } from "../../sync/store";
import { TooltipProvider } from "../ui/overlays";
import { BAND_WORD, HpBar, hpBarMode, hpFill } from "./hp-bar";
import { MEDALLION_PX, Medallion, medallionInk, medallionOf } from "./medallion";
import { RESULT_OUTCOMES, ResultBox } from "./result-box";

// `AssetImg` makes an `Image` while rendering; the server render has none.
const hadImage = "Image" in globalThis;
beforeAll(() => {
  if (!hadImage) (globalThis as { Image?: unknown }).Image = class {};
});
afterAll(() => {
  if (!hadImage) delete (globalThis as { Image?: unknown }).Image;
});

const sync = createStore<SyncState>()(() => ({ state: "live", store: emptyStore() }) as never);
const html = (el: React.ReactElement) =>
  renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        {el}
      </TooltipProvider>
    </SyncContext.Provider>,
  );

/** The first element carrying `data-testid=id`: its attributes. */
function attrs(markup: string, id: string): Map<string, string> {
  const tag = new RegExp(`<\\w+[^>]*data-testid="${id}"[^>]*>`).exec(markup)?.[0] ?? "";
  return new Map([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1] ?? "", m[2] ?? ""]));
}
const text = (markup: string) => markup.replace(/<[^>]+>/g, "");

describe("FR-KIT-05 medallion", () => {
  test("FR-KIT-05 medallion: first letter on the colour, sizes 22 / 28 / 34, test ID and slot", () => {
    expect(medallionOf("mira")).toEqual({ letter: "M", imageAssetId: null, colour: null });
    expect(medallionOf("  émile", "", "")).toEqual({
      letter: "É",
      imageAssetId: null,
      colour: null,
    });
    expect(medallionOf("(3) Goblin").letter).toBe("3");
    expect(medallionOf("—").letter).toBe("?");
    expect(MEDALLION_PX).toEqual({ sm: 22, md: 28, lg: 34 });

    const m = html(<Medallion name="Mira" colour="#38bdf8" size="lg" />);
    const a = attrs(m, "kit-medallion");
    expect(a.get("data-slot")).toBe("kit-medallion");
    expect(a.get("data-size")).toBe("lg");
    expect(a.get("aria-hidden")).toBe("true");
    expect(a.get("class")).toContain("size-[34px]");
    expect(a.get("style")).toContain("background-color:#38bdf8");
    expect(text(m)).toBe("M");
    // Sizes as classes, one per size.
    expect(attrs(html(<Medallion name="a" size="sm" />), "kit-medallion").get("class")).toContain(
      "size-[22px]",
    );
    expect(attrs(html(<Medallion name="a" />), "kit-medallion").get("class")).toContain("size-7");
  });

  test("FR-KIT-05 medallion: no colour → the neutral muted colour; a portrait → the asset thumbnail, no letter", () => {
    const plain = attrs(html(<Medallion name="Goblin" />), "kit-medallion");
    expect(plain.get("class")).toContain("bg-muted");
    expect(plain.has("style")).toBe(false);
    const img = html(<Medallion name="Mira" imageAssetId="a1" colour="#38bdf8" />);
    expect(attrs(img, "kit-medallion").has("data-image")).toBe(true);
    expect(attrs(img, "kit-medallion").has("data-tone")).toBe(false);
    expect(attrs(img, "kit-medallion").has("style")).toBe(false);
    expect(text(img)).toBe("");
    // The thumbnail loads through the asset image loader (skeleton until it lands).
    expect(img).toContain('data-slot="skeleton"');
  });

  test("FR-KIT-05 medallion: ink is black on a light player colour, the white glyph on a dark creature colour", () => {
    expect(medallionInk("#fbbf24")).toBe("var(--swatch-ink)");
    expect(medallionInk("#355f9e")).toBe("var(--creature-glyph, #fff)");
    expect(medallionInk("var(--creature-beast)")).toBe("var(--creature-glyph, #fff)");
    const callerId = html(<Medallion name="x" data-testid="party-summary-medallion" />);
    expect(attrs(callerId, "party-summary-medallion").get("data-slot")).toBe("kit-medallion");
  });
});

describe("FR-KIT-05 result box", () => {
  test("FR-KIT-05 result box: boxed value, data-outcome per outcome, meaning colours", () => {
    const want: Record<string, string> = {
      plain: "",
      crit: "text-hp-full",
      fumble: "text-muted-foreground",
      damage: "text-destructive",
      heal: "text-hp-full",
    };
    for (const outcome of RESULT_OUTCOMES) {
      const m = html(<ResultBox value={17} outcome={outcome} />);
      const a = attrs(m, "kit-result");
      expect(a.get("data-slot")).toBe("kit-result");
      expect(a.get("data-outcome")).toBe(outcome);
      if (want[outcome]) expect(a.get("class")).toContain(want[outcome]);
      expect(text(m)).toBe("17");
    }
    expect(attrs(html(<ResultBox value={1} />), "kit-result").get("data-outcome")).toBe("plain");
    expect(attrs(html(<ResultBox value={1} size="sm" />), "kit-result").get("data-size")).toBe(
      "sm",
    );
  });

  test("FR-KIT-05 result box: held shows … with no outcome and no Tooltip (FR-DICE-40: nothing leaks)", () => {
    const m = html(<ResultBox value={20} outcome="crit" held tip="d20 (20) + 9" />);
    const a = attrs(m, "kit-result");
    expect(text(m)).toBe("…");
    expect(a.has("data-outcome")).toBe(false);
    expect(a.has("data-held")).toBe(true);
    expect(a.has("tabindex")).toBe(false);
    expect(m).not.toContain("20");
  });

  test("FR-KIT-05 result box: focusable when it has a Tooltip, not otherwise; a caller's test ID wins", () => {
    const tip = attrs(html(<ResultBox value={22} tip="d20 (18) + 4" />), "kit-result");
    expect(tip.get("tabindex")).toBe("0");
    expect(tip.has("data-tooltip-trigger") || tip.has("data-state")).toBe(true);
    expect(attrs(html(<ResultBox value={22} />), "kit-result").has("tabindex")).toBe(false);
    const own = html(
      <ResultBox value={5} data-testid="dice-log-entry-total" data-record-id="r1" />,
    );
    expect(attrs(own, "dice-log-entry-total").get("data-record-id")).toBe("r1");
    expect(attrs(own, "dice-log-entry-total").get("data-slot")).toBe("kit-result");
  });
});

describe("FR-KIT-05 hp bar", () => {
  test("FR-KIT-05 hp bar: bar + cur / max, band derived from the numbers, fill in hp.* colours", () => {
    const m = html(<HpBar cur={38} max={44} />);
    const a = attrs(m, "kit-hpbar");
    expect(a.get("data-slot")).toBe("kit-hpbar");
    expect(a.get("data-band")).toBe("healthy");
    expect(text(m)).toBe("38 / 44");
    expect(m).toContain('data-slot="kit-hpbar-track"');
    expect(m).toMatch(
      /data-slot="kit-hpbar-fill" class="block h-full bg-hp-full" style="width:86%"/,
    );
    expect(attrs(html(<HpBar cur={11} max={26} />), "kit-hpbar").get("data-band")).toBe("bloodied");
    expect(html(<HpBar cur={0} max={26} />)).toContain("bg-hp-down");
    // The DM's band (FR-KIT-25) is the bar's data-band.
    expect(
      attrs(html(<HpBar cur={9} max={10} band="bloodied" />), "kit-hpbar").get("data-band"),
    ).toBe("bloodied");
    expect(text(html(<HpBar cur={9} max={10} numbers={false} />))).toBe("");
    expect([hpFill(50, 40), hpFill(-3, 40), hpFill(1, 0), hpFill(1, 3)]).toEqual([100, 0, 0, 33]);
  });

  test("FR-KIT-05 hp bar: band only → the band word, never a bar length; nothing known → nothing", () => {
    for (const band of ["healthy", "bloodied", "down"] as const) {
      const m = html(<HpBar band={band} data-testid="cbt-init-row-band" />);
      expect(attrs(m, "cbt-init-row-band").get("data-band")).toBe(band);
      expect(text(m)).toBe(BAND_WORD[band]);
      expect(m).not.toContain("kit-hpbar-track");
      expect(m).not.toContain("width:");
    }
    expect(hpBarMode(null, null, null)).toBeNull();
    expect(hpBarMode(5, 0, "down")).toBe("band");
    expect(html(<HpBar />)).toBe("");
  });
});

const THEMES = ["default", "gilt"] as const;
const PARTS: [string, React.ReactElement][] = [
  ["medallion", <Medallion key="m" name="Mira" colour="#38bdf8" />],
  ["result box", <ResultBox key="r" value={29} outcome="crit" tip="d20 (20) + 9" />],
  ["hp bar", <HpBar key="h" cur={38} max={44} />],
  ["band word", <HpBar key="b" band="bloodied" />],
];

describe("FR-KIT-05 medallion (K9)", () => {
  const GILT = readFileSync(join(import.meta.dir, "../../themes/gilt.css"), "utf8");
  const K9 = GILT.slice(GILT.indexOf("/* KIT: polish (kit-parity K9"));

  test("FR-KIT-05 medallion (K9, K6 gap 6): a letter with no colour is marked neutral; the theme fills it slate-blue with a cream initial inside the gold ring, by local tokens", () => {
    expect(attrs(html(<Medallion name="Goblin" />), "kit-medallion").get("data-tone")).toBe(
      "neutral",
    );
    expect(
      attrs(html(<Medallion name="Mira" colour="#38bdf8" />), "kit-medallion").has("data-tone"),
    ).toBe(false);
    expect(GILT.match(/\/\* KIT: polish \(kit-parity K9/g)?.length).toBe(1);
    expect(K9).toMatch(
      /\[data-slot="kit-medallion"\]\[data-tone="neutral"\] \{\s*--muted: #3a4d6b;\s*--muted-foreground: var\(--foreground\);/,
    );
    expect(K9).toMatch(
      /\[data-slot="kit-medallion"\] \{\s*box-shadow:[^}]*var\(--frame-rule-strong\)/,
    );
  });
});

describe("FR-KIT-05 hp bar (K9)", () => {
  test("FR-KIT-05 hp bar (K9, K6 gap 3): track fixed → the kit's 120-px track and a cur / max column; the default fills the line", () => {
    const fixed = html(<HpBar cur={7} max={7} track="fixed" />);
    expect(attrs(fixed, "kit-hpbar").get("data-track")).toBe("fixed");
    // It takes the line's free room up to its content, so the line's other parts never wrap for it.
    expect(attrs(fixed, "kit-hpbar").get("class")).toContain("max-w-fit flex-[1_1_0%]");
    expect(fixed).toMatch(/data-slot="kit-hpbar-track" class="[^"]*w-\[120px\] shrink grow-0/);
    expect(fixed).toContain("min-w-[7ch]");
    const fill = html(<HpBar cur={7} max={7} />);
    expect(attrs(fill, "kit-hpbar").get("data-track")).toBe("fill");
    expect(fill).toMatch(/data-slot="kit-hpbar-track" class="[^"]*flex-1/);
    expect(fill).not.toContain("min-w-[7ch]");
  });
});

describe("FR-KIT-01 same DOM per theme", () => {
  test("FR-KIT-01 same DOM per theme: each kit part renders the same markup under Simple Dark and Gilt & Stone", () => {
    for (const [, el] of PARTS) {
      const [a, b] = THEMES.map((t) => html(<div data-theme={t}>{el}</div>).replace(t, "·"));
      expect(a).toBe(b ?? "");
    }
    // No component reads the theme.
    for (const f of ["medallion.tsx", "result-box.tsx", "hp-bar.tsx"]) {
      expect(readFileSync(join(import.meta.dir, f), "utf8")).not.toMatch(/data-theme|useTheme/);
    }
  });
});

describe("FR-KIT-07 slots present", () => {
  const GILT = readFileSync(join(import.meta.dir, "../../themes/gilt.css"), "utf8");
  const KIT = GILT.slice(GILT.indexOf("/* KIT: parts"));

  test("FR-KIT-07 slots present: kit-medallion, kit-result, kit-hpbar on the parts, each styled by gilt.css's KIT block", () => {
    const rendered = PARTS.map(([, el]) => html(el)).join("");
    for (const slot of ["kit-medallion", "kit-result", "kit-hpbar", "kit-hpbar-track"]) {
      expect(rendered).toContain(`data-slot="${slot}"`);
      expect(KIT).toContain(`[data-slot="${slot}"]`);
    }
  });

  test("FR-KIT-07 slots present: gilt.css has one KIT block for the parts (OQ-KIT-10), the ring, outcome box and inset track", () => {
    expect(GILT.match(/\/\* KIT: parts/g)?.length).toBe(1);
    expect(KIT).toMatch(/\[data-slot="kit-medallion"\] \{\s*box-shadow:\s*0 0 0 1px #000/);
    expect(KIT).toMatch(
      /\[data-slot="kit-result"\] \{\s*border-color: var\(--frame-rule-strong\);\s*color: var\(--gold\)/,
    );
    expect(KIT).toMatch(/\[data-slot="kit-result"\]\[data-outcome="damage"\]/);
    expect(KIT).toMatch(/\[data-slot="kit-hpbar-track"\] \{\s*--muted: #2a2620;/);
    // Fill colours are meaning tokens: the KIT block never paints the fill.
    expect(KIT).not.toContain("kit-hpbar-fill");
  });
});
