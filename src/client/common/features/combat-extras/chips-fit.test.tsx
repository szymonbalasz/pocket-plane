// FR-CBTX-54 (OQ-CBTX-27 B, BL-26): on a tight Initiative row trigger chips go icon-only before
// effect chips fold, and a trigger never folds into "+N". The fit rule on measured widths (the
// DM's and the player's rows share `EffectChips`), the icon chip's markup (static render); the
// rows at 1440×900 / 320 wide: e2e/init-chips-effect.e2e.ts.
import { describe, expect, test } from "bun:test";
import type { EffectView } from "@shared/combat-extras/schemas";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "../../components/ui/overlays";
import type { TriggerChip } from "../effect-modifiers/trigger-badges";
import { fitChipRow, fitChipTiers, MORE_W } from "./logic";
import { EffectChips, TriggerChipView } from "./parts";

// Natural widths as measured in the build (11 px text): "Rage 10r" / "Rage 10", Divine Fury with
// its name / icon-only, "⚡2" with uses.
const rage = { full: 60, short: 52 };
const fury = { full: 76, short: 22 };
const strike = { full: 98, short: 30 };

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      {node}
    </TooltipProvider>,
  );

const chip = (o: Partial<TriggerChip>): TriggerChip => ({
  id: "fury",
  triggerId: "t-fury",
  name: "Divine Fury",
  uses: null,
  state: "ready",
  muted: false,
  down: false,
  tooltip: "Ready",
  ...o,
});

/** The opening tag of the element with `data-testid=id` (the first, if several). */
const tagOf = (html: string, id: string) =>
  html.match(new RegExp(`<span[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? "";

describe("FR-CBTX-54 trigger chips never fold", () => {
  test("FR-CBTX-54 trigger chips never fold: Brakka's 'Rage 10r' + Divine Fury at 400 / 320 / 280 px", () => {
    // 400 px (DM default): both in full.
    expect(fitChipRow([rage], [fury], 180)).toEqual({ n: 1, tier: 0, icons: false, wrap: false });
    // 320 px (min width): Divine Fury icon-only, "Rage 10r" whole (not "Rage 10r +1").
    expect(fitChipRow([rage], [fury], 100)).toEqual({ n: 1, tier: 0, icons: true, wrap: false });
    // 280 px: Rage folds into "+1"; Divine Fury still shown (icon), no second line.
    expect(fitChipRow([rage], [fury], 60)).toEqual({ n: 0, tier: 0, icons: true, wrap: false });
  });

  test("FR-CBTX-54 trigger chips never fold: the order — effect chips tighten, triggers go icon-only, effects fold last first", () => {
    // (1) Tier 2 ("Rage 10") lets the full trigger chip stay: 52 + 2 + 76 = 130.
    expect(fitChipRow([rage], [fury], 130)).toEqual({ n: 1, tier: 2, icons: false, wrap: false });
    // (2) One px less: the trigger goes icon-only and the effect is back at tier 0.
    expect(fitChipRow([rage], [fury], 129)).toEqual({ n: 1, tier: 0, icons: true, wrap: false });
    // (3) 3 effects + 2 triggers at 320: the triggers icon-only, effects into "+N" (last first);
    // `n` counts effect chips only, so no trigger is ever in the "+N" list.
    const three = [rage, { full: 44, short: 44 }, { full: 50, short: 50 }];
    const r = fitChipRow(three, [fury, strike], 150);
    expect(r).toEqual({ n: 1, tier: 0, icons: true, wrap: false });
    expect(60 + 2 + MORE_W + 2 + 22 + 2 + 30).toBeLessThanOrEqual(150);
  });

  test("FR-CBTX-54 trigger chips never fold: 4 triggers on a long name at min width → a second line", () => {
    const four = [fury, strike, fury, strike];
    expect(fitChipRow([rage], four, 40)).toEqual({ n: 0, tier: 0, icons: true, wrap: true });
    expect(fitChipRow([], four, 40)).toEqual({ n: 0, tier: 0, icons: true, wrap: true });
    // On its own line (the row's full width) they fit again.
    expect(fitChipRow([rage], four, 260).wrap).toBe(false);
    // No triggers: BL-08's rule unchanged, never a second line.
    for (const room of [20, 60, 118, 300]) {
      expect(fitChipRow([rage, rage], [], room)).toEqual({
        ...fitChipTiers([rage, rage], room),
        icons: false,
        wrap: false,
      });
    }
  });

  test("FR-CBTX-54 trigger chips never fold: a hidden row at 320 px (eye-off icon) never cuts the name (#182, W4 walkthrough W6c)", () => {
    // The Wolf's chip line holds its 28 px minimum while "Wolf" is squeezed to 3ch beside the
    // eye-off icon: Divine Fury's icon (22) "fits" 28, yet the name is cut → the second line.
    const minLine = 28;
    expect(fitChipRow([], [fury], minLine).wrap).toBe(false);
    expect(fitChipRow([], [fury], minLine, 2, true)).toEqual({
      n: 0,
      tier: 0,
      icons: true,
      wrap: true,
    });
    // Goblin: one effect only ("+1" for Fire Ward) beside a cut name → the second line too.
    expect(fitChipRow([rage], [], minLine, 2, true)).toEqual({
      n: 0,
      tier: 0,
      icons: false,
      wrap: true,
    });
    // Name whole: the rule as before; no chips: nothing to move.
    expect(fitChipRow([rage], [fury], 100, 2, false).wrap).toBe(false);
    expect(fitChipRow([], [], 0, 2, true).wrap).toBe(false);
  });

  test("FR-CBTX-54 trigger chips never fold: the icon chip — ⚡ + uses, data-compact, the used look kept, Tooltip names it", () => {
    const icon = tagOf(
      render(<TriggerChipView t={chip({ uses: { left: 2, text: "2" }, state: "uses" })} icon />),
      "cbtx-trigger-chip",
    );
    expect(icon).toContain('data-compact="true"');
    expect(icon).toContain('data-value="2"');
    // The Tooltip's trigger (data-state from Radix lands on the chip, the chip's own wins).
    expect(icon).toContain('data-state="uses"');
    const html = render(<TriggerChipView t={chip({ uses: { left: 2, text: "2" } })} icon />);
    expect(html).toContain('<span class="sr-only">Divine Fury</span>');
    expect(html).toContain(">2</span>");
    expect(html).not.toContain('<span class="min-w-0 truncate">Divine Fury</span>');
    // Used: muted + check, compact too.
    const used = render(
      <TriggerChipView t={chip({ state: "used", muted: true, tooltip: "Used this turn" })} icon />,
    );
    expect(tagOf(used, "cbtx-trigger-chip")).toContain('data-muted="true"');
    expect(used).toContain('aria-label="Used"');
    expect(used).toContain("opacity-70");
    // Full chip: the name shown, not compact.
    const full = render(<TriggerChipView t={chip({})} />);
    expect(tagOf(full, "cbtx-trigger-chip")).toContain('data-compact="false"');
    expect(full).toContain('<span class="min-w-0 truncate">Divine Fury</span>');
  });

  test("FR-CBTX-54 trigger chips never fold: the row measures each trigger with its name and icon-only, and renders triggers after the effects, outside '+N'", () => {
    const bless = {
      id: "fx-rage",
      kind: "custom",
      condition: null,
      level: null,
      label: "Rage",
      targetCombatantId: null,
      targetCharacterId: "ch-brakka",
      encounterId: "e1",
      endsRound: 11,
    } as unknown as EffectView;
    const html = render(
      <EffectChips
        compact
        effects={[bless]}
        triggers={[chip({})]}
        round={1}
        testId="cbtx-init-row-effect"
      />,
    );
    const measure = html.slice(html.indexOf('data-chip-measure="trigger"'), html.indexOf("</div>"));
    expect(measure).toContain('<span class="sr-only">Divine Fury</span>');
    expect(measure).toContain('<span class="min-w-0 truncate">Divine Fury</span>');
    expect(measure).not.toContain("data-testid");
    expect(html.indexOf('data-testid="cbtx-trigger-chip"')).toBeGreaterThan(
      html.indexOf('data-testid="cbtx-init-row-effect"'),
    );
    expect(html).toContain('data-wrap="false"');
    expect(html).not.toContain("cbtx-trigger-chip-more-item");
  });
});
