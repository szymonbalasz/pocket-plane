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

// Sprint 10 H4 (BL-102): the exact SRD 5.1 card texts (fixture `cmp-rules-mini`, `ruleCards`).
const GRAPPLING =
  "When you want to grab a creature or wrestle with it, you can use the Attack action to make a special melee attack, a grapple. If you're able to make multiple attacks with the Attack action, this attack replaces one of them.\n\nThe target of your grapple must be no more than one size larger than you and must be within your reach. Using at least one free hand, you try to seize the target by making a grapple check instead of an attack roll: a Strength (Athletics) check contested by the target's Strength (Athletics) or Dexterity (Acrobatics) check (the target chooses the ability to use). If you succeed, you subject the target to the srd:grappled condition. The condition specifies the things that end it, and you can release the target whenever you like (no action required).\n\n**Escaping a Grapple.** A grappled creature can use its action to escape. To do so, it must succeed on a Strength (Athletics) or Dexterity (Acrobatics) check contested by your Strength (Athletics) check.\n\n**Moving a Grappled Creature.** When you move, you can drag or carry the grappled creature with you, but your speed is halved, unless the creature is two or more sizes smaller than you.\n\n> **Contests in Combat**\n\n> Battle often involves pitting your prowess against that of your foe. Such a challenge is represented by a contest. This section includes the most common contests that require an action in combat: grappling and shoving a creature. The GM can use these contests as models for improvising others.";
const SHOVING =
  "Using the Attack action, you can make a special melee attack to shove a creature, either to knock it srd:prone or push it away from you. If you're able to make multiple attacks with the Attack action, this attack replaces one of them.\n\nThe target must be no more than one size larger than you and must be within your reach. Instead of making an attack roll, you make a Strength (Athletics) check contested by the target's Strength (Athletics) or Dexterity (Acrobatics) check (the target chooses the ability to use). If you win the contest, you either knock the target srd:prone or push it 5 feet away from you.";
const ROLLING =
  "Sometimes fate blesses or curses a combatant, causing the novice to hit and the veteran to miss.\n\n> **Sage Advice**\n\n> Spell attacks can score critical hits, just like any other attack.\n\n>\n\n> Source: [Sage Advice > Compendium](http://media.wizards.com/2015/downloads/dnd/SA_Compendium_1.01.pdf)\n\nIf the d20 roll for an attack is a 20, the attack hits regardless of any modifiers or the target's AC. This is called a critical hit.\n\nIf the d20 roll for an attack is a 1, the attack misses regardless of any modifiers or the target's AC.";

/** The rendered text without tags. */
const words = (html: string) => html.replace(/<[^>]*>/g, "");

describe("BL-102 rule card markup (FR-CMP-26, FR-CMP-61)", () => {
  test("FR-CMP-61 BL-102 Grappling: 'srd:grappled' reads 'grappled' (a link run to that card), indented '>' lines are one quote, wording kept", () => {
    const blocks = parseMarkdownLite(GRAPPLING);
    const quote = blocks.at(-1);
    expect(quote?.type).toBe("quote");
    if (quote?.type !== "quote") return;
    const paras = quote.blocks.map((b) => (b.type === "p" ? b.lines.map(runsText).join(" ") : ""));
    expect(paras).toHaveLength(2);
    expect(paras[0]).toBe("Contests in Combat");
    expect(paras[1]).toStartWith("Battle often involves pitting your prowess");
    const second = blocks[1];
    if (second?.type !== "p") throw new Error("paragraph expected");
    const runs = second.lines[0] ?? [];
    expect(runs.find((r) => r.ref !== undefined)).toEqual({ text: "grappled", ref: "grappled" });
    expect(runsText(runs)).toContain("you subject the target to the grappled condition.");
    const html = render(GRAPPLING, { kind: "plain", label: "Grappling" });
    expect(html).not.toContain("srd:");
    expect(html).not.toMatch(/>&gt;|>\s*&gt;/);
    expect(html).toContain("<blockquote");
  });

  test("FR-CMP-61 BL-102 Shoving: both 'srd:prone' read 'prone'; Rolling 1 or 20: the Sage Advice quote has no '>' and its link reads as its label", () => {
    const html = render(SHOVING, { kind: "plain", label: "Shoving a Creature" });
    expect(html).not.toContain("srd:");
    expect(words(html)).toContain("knock it prone or push it away");
    expect(words(html)).toContain("knock the target prone or push it 5 feet");
    const rolling = render(ROLLING, { kind: "plain", label: "Rolling 1 or 20" });
    expect(rolling).toContain("<blockquote");
    expect(words(rolling)).toContain("Source: Sage Advice &gt; Compendium");
    expect(rolling).not.toContain("](http");
    expect(rolling).not.toMatch(/<p>&gt;/);
  });

  test("FR-CMP-61 BL-102 an srd: link renders as a button only when the window gives a handler; a non-http link is never a link", () => {
    const linked = renderToStaticMarkup(
      <SyncContext.Provider value={store()}>
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          <MarkdownLite text={SHOVING} context={{ kind: "plain", label: "x" }} onRef={() => {}} />
        </TooltipProvider>
      </SyncContext.Provider>,
    );
    expect(linked).toContain('data-testid="cmp-rules-link"');
    expect(linked).toContain('data-value="prone"');
    expect(render(SHOVING, { kind: "plain", label: "x" })).not.toContain("cmp-rules-link");
    const js = render("[click](javascript:alert(1))", { kind: "plain", label: "x" });
    expect(js).toBe(render("click", { kind: "plain", label: "x" }));
  });
});
