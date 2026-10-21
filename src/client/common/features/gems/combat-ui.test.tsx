// GM2 card actions (FR-CBT-130, -131; FR-GEM-34): the registry filter, the slot's static render,
// the Combat gem's model (who sees it, the dice it offers, levels, physical totals, payload) and
// its button. The picker's clicks and the spend: e2e/gems-combat.e2e.ts.
import { describe, expect, test } from "bun:test";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { RecordStore } from "@shared/protocol/store";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { type CardAction, cardActions, cardActionsFor } from "../combat-tracker/card-actions";
import { CardActions, MaxedDamage } from "../combat-tracker/card-actions-row";
import { gemCombatAction } from "./combat-action";
import { cardNote, combatStore, flameCard } from "./combat-fixture";
import {
  canMax,
  combatAvailable,
  combatPayload,
  pickLimit,
  pickParts,
  typedDice,
} from "./combat-model";

function render(s: RecordStore, node: ReactNode, state = "live"): string {
  const sync = createStore<SyncState>()(
    () =>
      ({
        state,
        store: s,
        connection: { sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        {node}
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

const testAction = (available: boolean): CardAction => ({
  id: "test.card",
  order: 5,
  available: () => available,
  Component: ({ card, client }) => (
    <span data-testid="test-card-action" data-record-id={card.id} data-value={client} />
  ),
});

describe("FR-CBT-130 card actions", () => {
  test("FR-CBT-130 card actions: empty registry / none available → nothing rendered; a test action renders per `available` in both clients", () => {
    const note = cardNote(flameCard());
    const s = combatStore({ viewer: "p1", note });
    expect(render(s, <CardActions card={note} client="player" actions={[]} />)).toBe("");
    expect(
      render(s, <CardActions card={note} client="player" actions={[testAction(false)]} />),
    ).toBe("");
    for (const client of ["dm", "player"] as const) {
      const html = render(
        s,
        <CardActions card={note} client={client} actions={[testAction(true)]} />,
      );
      expect(html).toContain('data-testid="cbt-card-actions" data-record-id="n1"');
      expect(html).toContain(
        `data-testid="test-card-action" data-record-id="n1" data-value="${client}"`,
      );
    }
    // `clients` and `feature` filter like entry actions.
    const dmOnly = { ...testAction(true), clients: ["dm"] as const };
    expect(cardActionsFor([dmOnly], s, note, "player")).toEqual([]);
    expect(cardActionsFor([dmOnly], s, note, "dm")).toEqual([dmOnly]);
    expect(cardActions).toContain(gemCombatAction);
  });

  test("FR-GEM-34 card action available: owner and DM on a pending card with damage while gems on, ≥ 1 Combat gem, not maxed", () => {
    const p = flameCard();
    const note = cardNote(p);
    const ok = (o: Parameters<typeof combatStore>[0], n: NotificationRecord = note) => {
      const s = combatStore(o);
      return cardActionsFor(cardActions, s, n, o.viewer === "dm" ? "dm" : "player").map(
        (a) => a.id,
      );
    };
    expect(ok({ viewer: "p1", note })).toEqual(["gem.combat"]);
    expect(ok({ viewer: "dm", note })).toEqual(["gem.combat"]);
    // Gems off (OQ-GEM-21 B), no gem left, maxed, no damage yet, applied → none.
    expect(ok({ viewer: "p1", note, on: false })).toEqual([]);
    expect(ok({ viewer: "p1", note, combat: 0 })).toEqual([]);
    const maxed = cardNote(flameCard({ diceMaxed: true }));
    expect(ok({ viewer: "p1", note: maxed }, maxed)).toEqual([]);
    const toHitOnly = cardNote(flameCard({ damage: null }));
    expect(ok({ viewer: "p1", note: toHitOnly }, toHitOnly)).toEqual([]);
    const applied = cardNote(p, { state: "resolved" });
    expect(ok({ viewer: "p1", note: applied }, applied)).toEqual([]);
    // Another player's character: never offered (they never get the card either).
    const s = combatStore({ viewer: "p1", note });
    const other = { ...s.you, playerId: "p2" } as NonNullable<RecordStore["you"]>;
    expect(combatAvailable(s, note, other)).toBe(false);
  });

  test("FR-GEM-34 card action: 'Combat gem' button, disabled while not live", () => {
    const note = cardNote(flameCard());
    const s = combatStore({ viewer: "p1", note });
    const html = render(s, <CardActions card={note} client="player" />);
    expect(html).toContain('data-testid="gem-combat" data-record-id="n1"');
    expect(html).toContain("Combat gem");
    const off = render(s, <CardActions card={note} client="player" />, "reconnecting");
    expect(off).toMatch(/data-testid="gem-combat"[^>]*disabled=""/);
  });
});

describe("FR-GEM-26 / FR-GEM-27 / FR-GEM-28 picker model", () => {
  test("FR-GEM-27 dice: base then extra parts with faces from the roll line; never mods or triggers; a die at its max can't be picked", () => {
    const p = flameCard();
    const s = combatStore({ viewer: "p1", note: cardNote(p) });
    const parts = pickParts(s, p);
    expect(parts.map((x) => [x.part, x.type, x.diceTotal])).toEqual([
      ["base", "slashing", 8],
      [0, "fire", 8],
    ]);
    expect(parts[1]?.dice.map((d) => [d.faces, d.value, canMax(d)])).toEqual([
      [6, 2, true],
      [6, 6, false],
    ]);
  });

  test("FR-GEM-26 levels: the picker's limit and the next step's hint", () => {
    expect(pickLimit(5)).toEqual({ limit: 1, next: "Level 6 for 2 dice" });
    expect(pickLimit(6)).toEqual({ limit: 2, next: "Level 12 for 3 dice" });
    expect(pickLimit(12)).toEqual({ limit: 3, next: null });
  });

  test("FR-GEM-28 physical: a total-only part asks for each die (count, faces, sum) and sends `known` only for picked parts", () => {
    const p = flameCard({
      damage: {
        ...flameCard().damage,
        dice: [
          [null, true],
          [null, true],
        ],
      } as never,
    });
    const s = combatStore({ viewer: "p1", note: cardNote(p) });
    const [base] = pickParts(s, p);
    if (!base) throw new Error("no base part");
    expect(typedDice(base, ["3"])).toBeNull();
    expect(typedDice(base, ["3", "4"])).toEqual({ error: "The dice add up to 7, not 8" });
    expect(typedDice(base, ["7", "1"])).toEqual({ error: "Each die between 1 and its faces" });
    expect(typedDice(base, ["3", "5"])).toEqual({ values: [3, 5] });
    const known = [{ part: "base" as const, dice: [3, 5] }];
    expect(combatPayload("brakka", "n1", [{ part: "base", index: 0 }], known).payload).toEqual({
      characterId: "brakka",
      gem: "combat",
      cardId: "n1",
      dice: [{ part: "base", index: 0 }],
      known,
    });
    expect(
      combatPayload("brakka", "n1", [{ part: 0, index: 0 }], known).payload,
    ).not.toHaveProperty("known");
  });
});

describe("FR-CBT-131 maxed markers", () => {
  test("FR-CBT-131 maxed markers (card view): a 'max' Badge per maxed die; none → nothing", () => {
    const base = flameCard().damage as NonNullable<ReturnType<typeof flameCard>["damage"]>;
    const p = flameCard({
      diceMaxed: true,
      damage: {
        ...base,
        dice: [
          [6, true],
          [5, true],
        ],
        maxed: [0],
        extra: [
          {
            ...(base.extra?.[0] as NonNullable<typeof base.extra>[number]),
            dice: [
              [6, true],
              [6, true],
            ],
            maxed: [0],
          },
        ],
      },
    });
    const s = combatStore({ viewer: "p1", note: cardNote(p) });
    const html = render(s, <MaxedDamage p={p} />);
    expect(html).toContain('data-testid="cbt-card-die-max" data-part="base" data-index="0"');
    expect(html).toContain('data-testid="cbt-card-die-max" data-part="0" data-index="0"');
    expect(html.split('data-testid="cbt-card-die-max"').length - 1).toBe(2);
    expect(render(s, <MaxedDamage p={flameCard()} />)).toBe("");
  });
});
