// GM2 on the player's damage-card view (toast + History row; FR-CBT-130, -131, FR-GEM-34): the
// card-action slot below the dice, the "max" Badges, and the view unchanged when neither applies.
import { describe, expect, test } from "bun:test";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { cardNote, combatStore, flameCard } from "@ui/features/gems/combat-fixture";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { playerDamageCardView } from "./card-view";

const Render = playerDamageCardView.render as (p: { notification: NotificationRecord }) => never;

function render(note: NotificationRecord, o: { on?: boolean; combat?: number } = {}) {
  const store = combatStore({ viewer: "p1", note, ...o });
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store,
        connection: { sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <Render notification={note} />
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

describe("FR-CBT-130 card actions (player card view)", () => {
  test("FR-CBT-130 card actions / FR-GEM-34 card action available: the owner's pending card shows 'Combat gem' below the dice; none available → the view as before", () => {
    const note = cardNote(flameCard());
    const html = render(note);
    expect(html).toContain('data-testid="cbt-card-actions" data-record-id="n1"');
    expect(html.indexOf("gem-combat")).toBeGreaterThan(html.indexOf("cbt-card-outcome"));
    // Gems off / no gem left: no slot, no marker: the sprint-6 view (text + outcome only).
    const off = render(note, { on: false });
    expect(off).toBe(render(note, { combat: 0 }));
    expect(off).not.toContain("cbt-card-actions");
    expect(off).not.toContain("cbt-card-maxed");
    expect(off).toBe(
      '<span class="flex flex-col"><span>Brakka: 22 to hit, 15 slashing + 8 fire</span>' +
        '<span data-testid="cbt-card-outcome" data-value="pending" class="text-xs text-muted-foreground">Waiting for DM</span></span>',
    );
    // A resolved card never shows the slot.
    expect(render(cardNote(flameCard(), { state: "resolved" }))).not.toContain("cbt-card-actions");
  });

  test("FR-CBT-131 maxed markers (player card): 'max' Badges on the maxed dice; the Combat gem is gone", () => {
    const base = flameCard().damage as NonNullable<ReturnType<typeof flameCard>["damage"]>;
    const p = flameCard({
      diceMaxed: true,
      damage: {
        ...base,
        dice: [
          [6, true],
          [5, true],
        ],
        total: 18,
        maxed: [0],
      },
    });
    const html = render(cardNote(p, { text: "Brakka: 22 to hit, 18 slashing + 8 fire" }));
    expect(html).toContain('data-testid="cbt-card-die-max" data-part="base" data-index="0"');
    expect(html).not.toContain("gem-combat");
  });
});
