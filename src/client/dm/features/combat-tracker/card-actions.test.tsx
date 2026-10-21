// GM2 in the DM's attack popup (FR-CBT-130, -131, -132): the card-action slot between the card
// summary and the targets, the "max" Badges in the damage cell, and a typed total kept with
// "rolled N" when the card is maxed. Static renders of the popup over an in-code store.
import { beforeEach, describe, expect, test } from "bun:test";
import { ENCOUNTER_TYPE } from "@shared/combat-tracker/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { lazyAfterSnapshot } from "@shared/protocol/lazy";
import type { RecordStore } from "@shared/protocol/store";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { cardNote, combatStore, flameCard } from "@ui/features/gems/combat-fixture";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { PopupBody } from "./attack-popup";
import { blurField, fieldValue, rolledHint, typeField } from "./late-fill";
import { useCombatDialogs } from "./popup-store";

function render(note: NotificationRecord, o: { on?: boolean; combat?: number } = {}) {
  const s = combatStore({ viewer: "dm", note, ...o });
  const store: RecordStore = {
    ...s,
    records: {
      ...s.records,
      [ENCOUNTER_TYPE]: { e1: { id: "e1", status: "started", round: 1, turnCombatantId: null } },
    },
  };
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store,
        notLiveSince: null,
        everLive: true,
        lazy: lazyAfterSnapshot(1),
        connection: { sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <PopupBody card={note} close={() => {}} />
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

beforeEach(() => {
  useCombatDialogs.setState({ drafts: {}, resolved: [], cardId: null });
});

describe("FR-CBT-130 card actions (DM popup)", () => {
  test("FR-CBT-130 card actions: the slot sits under the card summary, above the targets; none available → no row", () => {
    const note = cardNote(flameCard(), { audience: "dm", audiencePlayerId: null });
    const html = render(note);
    const slot = html.indexOf('data-testid="cbt-card-actions"');
    expect(slot).toBeGreaterThan(html.indexOf('id="cbt-popup-damage"'));
    expect(slot).toBeLessThan(html.indexOf('aria-label="Targets"'));
    expect(html).toContain('data-testid="gem-combat" data-record-id="n1"');
    // Gems off / no gem → the popup has no slot row at all.
    for (const off of [render(note, { on: false }), render(note, { combat: 0 })]) {
      expect(off).not.toContain("cbt-card-actions");
      expect(off).not.toContain("gem-combat");
    }
    expect(render(note, { on: false })).toBe(render(note, { combat: 0 }));
  });
});

describe("FR-CBT-131 / FR-CBT-132 maxed card in the popup", () => {
  test("FR-CBT-131 maxed markers (popup): the damage cell's maxed dice carry a 'max' Badge, an extra part's too; the slot is gone", () => {
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
        extra: [
          {
            ...(base.extra?.[0] as NonNullable<typeof base.extra>[number]),
            dice: [
              [6, true],
              [6, true],
            ],
            total: 12,
            maxed: [0],
          },
        ],
      },
    });
    const html = render(cardNote(p));
    expect(html).toContain('data-testid="cbt-card-die-max" data-part="base" data-index="0"');
    expect(html).toContain('data-testid="cbt-card-die-max" data-part="0" data-index="0"');
    expect(html).not.toContain("gem-combat");
    // Unmaxed: no Badge.
    expect(render(cardNote(flameCard()))).not.toContain("cbt-card-die-max");
  });

  test("FR-CBT-132 typed kept: the DM typed 9, the card is maxed to 12 → the field keeps 9 and shows 'rolled 12'", () => {
    const typed = blurField(typeField("9"));
    expect(fieldValue(typed, 12)).toBe("9");
    expect(rolledHint(typed, 12)).toBe(12);
    // Untouched fields follow the maxed total.
    expect(fieldValue(undefined, 12)).toBe("12");
    expect(rolledHint(undefined, 12)).toBeNull();
    const html = render(cardNote(flameCard({ diceMaxed: true })));
    expect(html).toContain('value="15"');
  });
});
