// Kit parity K3 (§6.6, FR-KIT-66 + FR-KIT-04 for the player card view): the maxed-damage and
// outcome lines show their totals as small Result boxes; the text reads as before.
import { describe, expect, test } from "bun:test";
import { resolutionText } from "@shared/combat-tracker/rules";
import type { DamageCardTargetOutcome } from "@shared/combat-tracker/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { cardNote, combatStore, flameCard } from "@ui/features/gems/combat-fixture";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { playerDamageCardView } from "./card-view";

const Render = playerDamageCardView.render as (p: { notification: NotificationRecord }) => never;

function render(note: NotificationRecord) {
  const store = combatStore({ viewer: "p1", note, on: false });
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

const textOf = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");
const outcomeOf = (html: string) =>
  /<span data-testid="cbt-card-outcome"[^>]*>([\s\S]*?)<\/span><\/span>$/.exec(html)?.[1] ?? "";

const TARGETS: DamageCardTargetOutcome[] = [
  { targetName: "Goblin", hit: true, multiplier: "normal", applied: 6 },
  { targetName: "Goblin 2", hit: true, multiplier: "half", applied: 3 },
  { targetName: "Wolf", hit: false, multiplier: "normal", applied: 0 },
];

describe("FR-KIT-66 player card", () => {
  test("FR-KIT-66 player card: the resolved outcome line shows each hit's damage as a small Result box; its text is exactly today's", () => {
    const html = render(
      cardNote(flameCard(), { state: "resolved", resolution: { targets: TARGETS } }),
    );
    const line = outcomeOf(html);
    expect(line.split('data-slot="kit-result"').length - 1).toBe(2);
    expect(line).toMatch(
      /Hit Goblin: <span data-testid="kit-result" data-slot="kit-result" data-outcome="damage" data-size="sm"[^>]*>6<\/span>/,
    );
    expect(line).toMatch(/>3<\/span> \(half\) · Miss Wolf$/);
    expect(textOf(line)).toBe(resolutionText(TARGETS));
    // Pending and dismissed read as before (no box).
    expect(outcomeOf(render(cardNote(flameCard())))).toBe("Waiting for DM");
    expect(outcomeOf(render(cardNote(flameCard(), { state: "dismissed" })))).toBe("Dismissed");
  });

  test("FR-KIT-66 player card: the maxed-damage line shows each maxed part's total as a small Result box after its dice", () => {
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
    const html = render(cardNote(p));
    const maxed = html.slice(
      html.indexOf('data-testid="cbt-card-maxed"'),
      html.indexOf("cbt-card-outcome"),
    );
    expect(maxed).toMatch(
      /data-testid="cbt-card-die-max"[\s\S]*?\]<\/span><span data-testid="kit-result" data-slot="kit-result" data-outcome="damage" data-size="sm"[^>]*>18<\/span>/,
    );
  });

  test("FR-KIT-04 player card shows no new fields: only the values the player's outcome already carried", () => {
    const html = render(
      cardNote(flameCard(), { state: "resolved", resolution: { targets: TARGETS } }),
    );
    for (const v of [...html.matchAll(/data-slot="kit-result"[^>]*>(\d+)</g)].map((m) => m[1])) {
      expect(["6", "3"]).toContain(v ?? "");
    }
    expect(html).not.toContain("hpCurrent");
  });
});
