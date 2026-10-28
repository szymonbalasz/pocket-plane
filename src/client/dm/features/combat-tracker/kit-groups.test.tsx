// Kit parity K12 (round-2 gap 6): Initiative companion / ally groups as flat child rows under
// their owner, DM client (the player's: `player/.../kit-groups.test.tsx`): no nested card (no indent, no rule), the `sm` medallion in the
// owner's medallion slot, the kit bar on the in-turn lines, the init column aligned. Static
// render over the companions fight (`companions-fixture.tsx`).
import { describe, expect, test } from "bun:test";
import {
  companionStore,
  renderWith,
  rowHtml,
} from "@ui/features/combat-tracker/companions-fixture";
import { childBelow } from "@ui/features/combat-tracker/parts";
import { dmInitiativeWindow } from "./initiative-window";

const DmBody = dmInitiativeWindow.component;
const dm = () => renderWith(companionStore("dm"), <DmBody kind="cbt.initiative" instance="" />);

/** A row's `<li>` opening tag. */
const li = (row: string) => /^<li[^>]*>/.exec(row)?.[0] ?? "";

describe("FR-KIT-29 companion groups (K12)", () => {
  test("FR-KIT-29 companion groups (K12): childBelow marks an owner whose next row is its after-owner child", () => {
    const layout = [
      { c: { id: "mira" }, owner: null, indent: false },
      { c: { id: "owl" }, owner: { id: "mira" }, indent: true },
      { c: { id: "gob" }, owner: null, indent: false },
      { c: { id: "pet" }, owner: { id: "thorn" }, indent: true },
    ];
    expect(layout.map((_, i) => childBelow(layout, i))).toEqual([true, false, false, false]);
  });

  for (const [who, render] of [["DM", dm]] as const) {
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

  test("FR-KIT-29 companion groups (K12): DM — the after-owner row's number (its owner's) is right-aligned in the init column", () => {
    const owl = rowHtml(dm(), "cbt-init-row", "owlbear");
    const init = /<span[^>]*data-testid="cbt-init-row-init" data-record-id="owlbear"[^>]*>/.exec(
      owl,
    )?.[0];
    expect(init).toContain("text-right");
    expect(init).not.toContain("text-center");
    expect(init).toContain("w-9");
  });
});
