// Kit parity K12 (round-2 gap 6): Initiative companion / ally groups as flat child rows under
// their owner, player client (the DM's: `dm/.../kit-groups.test.tsx`): no nested card, the `sm`
// medallion in the owner's slot, the kit bar on the owner's in-turn lines; nothing new for
// another player. Static render over the companions fight (`companions-fixture.tsx`).
import { describe, expect, test } from "bun:test";
import {
  companionStore,
  renderWith,
  rowHtml,
} from "@ui/features/combat-tracker/companions-fixture";
import { playerInitiativeWindow } from "./initiative-window";

const PlayerBody = playerInitiativeWindow.component;
const p1 = () => renderWith(companionStore("p1"), <PlayerBody kind="cbt.initiative" instance="" />);

/** A row's `<li>` opening tag. */
const li = (row: string) => /^<li[^>]*>/.exec(row)?.[0] ?? "";

describe("FR-KIT-29 companion groups (K12)", () => {
  for (const [who, render] of [["player-1", p1]] as const) {
    test(`FR-KIT-29 companion groups (K12): ${who} — the after-owner row sits flush under its owner, no indent, the sm medallion in the owner's slot`, () => {
      const html = render();
      const owl = rowHtml(html, "cbt-init-row", "owlbear");
      const mira = rowHtml(html, "cbt-init-row", "mira");
      expect(li(owl)).toContain('data-indent="true"');
      expect(li(owl)).not.toContain("ml-3");
      expect(li(owl)).toMatch(/ -mt-1 [^"]*\brounded-t-none\b/);
      expect(li(mira)).toContain("rounded-b-none");
      expect(owl).toMatch(
        /data-slot="init-child-medallion" class="[^"]*w-\[34px\][^"]*self-start[^"]*"><span[^>]*data-size="sm"/,
      );
      // Under its owner the owner chip is the colour dot only (the name in its Tooltip and for
      // screen readers): medallion · name · bar.
      expect(owl).toMatch(
        /<span data-testid="cbt-init-row-owner" data-record-id="owlbear" data-value="ch-mira" data-compact="true"[^>]*><span aria-hidden="true"[^>]*style="background-color:#e69f00"><\/span><span class="sr-only">Mira<\/span>/,
      );
      // K12 re-test: one name line (truncated, full name in its Tooltip), marks and side chips
      // whole beside it, so the medallion stays on the name's line.
      expect(owl).toMatch(
        /<div data-name-line="true" data-child="true" class="flex min-w-0 items-center[^"]*"><span data-name-head="true" class="flex min-w-\[3ch\] max-w-full[^"]*"><span data-testid="cbt-init-row-name" data-value="Owlbear" class="min-w-0 truncate[^"]*" data-state="closed"/,
      );
      // A row that isn't a child keeps the lg medallion and its own rounded card.
      const goblin = rowHtml(html, "cbt-init-row", "goblin");
      expect(goblin).not.toContain("init-child-medallion");
      expect(li(goblin)).not.toContain("rounded-b-none");
      expect(li(goblin)).not.toContain("rounded-t-none");
    });

    test(`FR-KIT-29 companion groups (K12): ${who} — in-turn lines are flat (no rule) in the owner's name column, HP as the kit bar`, () => {
      const brakka = rowHtml(render(), "cbt-init-row", "brakka");
      for (const id of ["drake", "fe2"]) {
        const line = new RegExp(
          `<div data-testid="cbt-init-companion" data-record-id="${id}"[^>]*>`,
        ).exec(brakka)?.[0];
        expect(line).toBeDefined();
        expect(line).not.toContain("border-l");
        expect(line).not.toContain("class=");
      }
      const drake = brakka.slice(brakka.indexOf('data-record-id="drake"'));
      expect(drake).toMatch(/data-slot="init-child-medallion"/);
      expect(drake).toMatch(
        /data-testid="cbt-init-row-hp" data-slot="kit-hpbar"[^>]*data-track="fixed"[^>]*data-record-id="drake"/,
      );
    });
  }

  test("FR-KIT-04 player rows show no new fields (K12): player-2 still sees only the band of another player's companion line", () => {
    const html = renderWith(companionStore("p2"), <PlayerBody kind="cbt.initiative" instance="" />);
    const brakka = rowHtml(html, "cbt-init-row", "brakka");
    expect(brakka).toContain('data-record-id="drake"');
    expect(brakka).not.toMatch(/data-record-id="drake"[\s\S]*kit-hpbar-track/);
    expect(brakka).not.toContain("22 / 22");
  });
});

describe("FR-KIT-29 BL-141 child rows two lines at most", () => {
  test("FR-KIT-29 BL-141 child rows: player-1 — Owlbear's name line keeps its chips (no wrap, Ally its icon with a Tooltip); 'After Mira' ends the bar line, no line of its own", () => {
    const owl = rowHtml(p1(), "cbt-init-row", "owlbear");
    expect(owl).toMatch(/<div data-name-line="true" data-child="true" class="(?![^"]*flex-wrap)/);
    const ally =
      /<span[^>]*data-testid="cbt-init-row-ally"[^>]*>[\s\S]*?<\/span>/.exec(owl)?.[0] ?? "";
    expect(ally).toContain('data-compact="true"');
    expect(ally).toContain('aria-label="Ally"');
    expect(ally).toContain("data-tip");
    expect(ally).not.toMatch(/>Ally</);
    // The bar line holds the bar and, at its end, "After Mira"; it doesn't wrap.
    const stats = /<div data-stats-line="true" class="([^"]*)">([\s\S]*?)<\/div>/.exec(owl);
    expect(stats?.[1]).toContain("flex-nowrap");
    expect(stats?.[2]).toContain('data-testid="cbt-init-row-hp"');
    expect(stats?.[2]).toMatch(/data-testid="cbt-init-row-after"[^>]*>After Mira</);
  });
});
