// FR-CMP-26 markdown-lite: parse (paragraphs, bold / italic, lists, pipe tables), render text
// nodes only (never HTML), notation through `DiceText` with the monster / plain contexts.
import { describe, expect, test } from "bun:test";
import { emptyStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { diceCategory } from "./logic";
import { diceParts, MarkdownLite, type TextContext } from "./MarkdownLite";
import { parseInline, parseMarkdownLite, runsText } from "./markdown";

const SCIMITAR =
  "*Melee Weapon Attack:* +4 to hit, reach 5 ft., one target. *Hit:* 5 (1d6 + 2) slashing damage.";
const GOBLIN: TextContext = { kind: "monster", definitionId: "def-goblin", label: "Scimitar" };

function store() {
  const you = { campaignId: "c1", role: "dm", playerId: null };
  return createStore<SyncState>()(
    () => ({ state: "live", store: { ...emptyStore(), you } }) as unknown as SyncState,
  );
}

const render = (text: string, context: TextContext) =>
  renderToStaticMarkup(
    <SyncContext.Provider value={store()}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <MarkdownLite text={text} context={context} />
      </TooltipProvider>
    </SyncContext.Provider>,
  );

describe("FR-CMP-26 markdown-lite", () => {
  test("FR-CMP-26 parse: paragraphs, **bold**, *italic*, - lists, pipe tables", () => {
    const blocks = parseMarkdownLite(
      [
        "**Bold** and *italic* text",
        "second line",
        "",
        "- one",
        "- two *x*",
        "",
        "| d6 | Effect |",
        "|---|---|",
        "| 1 | Fire |",
        "| 2 | Ice |",
      ].join("\n"),
    );
    expect(blocks.map((b) => b.type)).toEqual(["p", "ul", "table"]);
    const [p, ul, table] = blocks;
    if (p?.type !== "p" || ul?.type !== "ul" || table?.type !== "table") throw new Error("shape");
    expect(p.lines[0]).toEqual([
      { text: "Bold", bold: true },
      { text: " and " },
      { text: "italic", italic: true },
      { text: " text" },
    ]);
    expect(runsText(p.lines[1] ?? [])).toBe("second line");
    expect(ul.items.map(runsText)).toEqual(["one", "two x"]);
    expect(table.head?.map(runsText)).toEqual(["d6", "Effect"]);
    expect(table.rows.map((r) => r.map(runsText))).toEqual([
      ["1", "Fire"],
      ["2", "Ice"],
    ]);
    // Unmatched markers stay text.
    expect(parseInline("a * b ** c")).toEqual([{ text: "a * b ** c" }]);
    expect(parseInline("2 * 3 * 4")).toEqual([{ text: "2 * 3 * 4" }]);
  });

  test("FR-CMP-26 renderer: text nodes only, never HTML (<script> stays text)", () => {
    const html = render('<script>alert("x")</script> **<b>bold</b>** <img src=x onerror=1>', {
      kind: "plain",
      label: "Evil",
    });
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=1&gt;");
  });

  test("FR-CMP-26 Scimitar Hit text → one DiceText match '1d6 + 2' with {creature, label: Scimitar, category: damage}; '+4 to hit' plain", () => {
    const parts = diceParts(SCIMITAR, GOBLIN).filter((p) => p.context !== undefined);
    expect(parts).toEqual([
      {
        text: "1d6 + 2",
        context: {
          label: "Scimitar",
          category: "damage",
          creature: { entityId: "def-goblin" },
        },
      },
    ]);
    const html = render(SCIMITAR, GOBLIN);
    expect(html.match(/data-testid="dicex-notation"/g)).toHaveLength(1);
    expect(html).toContain(">1d6 + 2</button>");
    expect(html).toContain("+4 to hit");
    expect(html).toContain("<em>Melee Weapon Attack:</em>");
  });

  test("FR-CMP-26 monster notation with a 1d20 is an attack; other kinds pass {label: entry name}, no actor", () => {
    expect(diceCategory("1d20+4")).toBe("attack");
    expect(diceCategory("2d6+3")).toBe("damage");
    expect(diceCategory("11d20")).toBe("damage");
    const fire = diceParts("8d6 fire damage", { kind: "plain", label: "Fireball" });
    expect(fire).toEqual([{ text: "8d6 fire damage", context: { label: "Fireball" } }]);
    expect(render("8d6 fire damage", { kind: "plain", label: "Fireball" })).toContain(
      'data-value="8d6"',
    );
  });
});
