// FR-CBTX-46 compact Initiative chips under their Tooltip (BL-08 walkthrough 3b): the trigger's
// props (data-state, handlers, ref) must land on the chip, or the hover hint never opens.
// Static server render.
import { describe, expect, test } from "bun:test";
import type { EffectView } from "@shared/combat-extras/schemas";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "../../components/ui/overlays";
import { EffectChip, EffectChips } from "./parts";

const bless = {
  id: "fx-bless",
  kind: "concentration",
  condition: null,
  level: null,
  label: "Bless",
  targetCombatantId: "k-mira",
  targetCharacterId: null,
  encounterId: "e1",
  endsRound: 12,
} as unknown as EffectView;

/** The opening tag of the element with `data-testid=id` (the first, if several). */
const tagOf = (html: string, id: string) =>
  html.match(new RegExp(`<span[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? "";

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      {node}
    </TooltipProvider>,
  );

describe("FR-CBTX-46 chip Tooltip trigger", () => {
  test("FR-CBTX-46 BL-08 a compact chip is its Tooltip's trigger (data-state on the chip, both tiers)", () => {
    for (const tier of [0, 2]) {
      const tag = tagOf(
        render(
          <EffectChip e={bless} round={2} testId="cbtx-init-row-effect" compact tier={tier} />,
        ),
        "cbtx-init-row-effect",
      );
      expect(tag).toContain('data-state="closed"');
      expect(tag).toContain('data-record-id="fx-bless"');
      expect(tag).toContain(`data-tier="${tier}"`);
    }
  });

  test("FR-CBTX-46 BL-08 in a row: every live chip is a trigger, the measuring copy is not", () => {
    const html = render(
      <EffectChips compact effects={[bless]} round={2} testId="cbtx-init-row-effect" />,
    );
    expect(tagOf(html, "cbtx-init-row-effect")).toContain('data-state="closed"');
    const measure = html.match(/<span[^>]*data-chip-measure[^>]*>.*?<\/span><\/span>/)?.[0] ?? "";
    expect(measure).not.toContain("data-state");
    expect(measure).not.toContain("data-testid");
  });
});
