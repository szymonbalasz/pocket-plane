// FR-MOD-24 / -25 in the DM's attack popup (static render over a fake store): the AC cell with
// its parts, MOD's defense-hint line and the row's multiplier preset.
import { describe, expect, test } from "bun:test";
import type { CombatantView, DamageCardPayload } from "@shared/combat-tracker/schemas";
import { emptyStore } from "@shared/protocol/store";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import type { PopupPartProps } from "../combat-tracker/popup-parts";
import { AcCell, modDefensePart, presetMultiplier, rowFacts } from "./popup-facts";

const rage = {
  id: "fx-rage",
  kind: "custom",
  label: "Rage",
  targetCharacterId: "brakka",
  targetCombatantId: null,
  endedAt: null,
  modifiers: [
    { kind: "defense", types: ["bludgeoning", "piercing", "slashing"], level: "resistance" },
  ],
};
const sof = {
  id: "fx-sof",
  kind: "custom",
  label: "Shield of Faith",
  targetCharacterId: null,
  targetCombatantId: "c-gob",
  endedAt: null,
  modifiers: [{ kind: "flat", on: { roll: "ac" }, value: 2 }],
};
const brakka = { id: "c-brakka", kind: "pc", entityId: "brakka", name: "Brakka" } as CombatantView;
const goblin = {
  id: "c-gob",
  kind: "monster",
  entityId: "def-gob",
  name: "Goblin",
} as CombatantView;

function render(node: React.ReactNode) {
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: {
          ...emptyStore(),
          you: { campaignId: "c1", role: "dm", playerId: null },
          records: { effect: { [rage.id]: rage, [sof.id]: sof } },
        },
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

const effects = [rage, sof] as unknown as Parameters<typeof rowFacts>[0];

describe("FR-MOD-24 popup AC", () => {
  test("FR-MOD-24 the Goblin's AC cell: vs AC 17 with a +2 marker; the Hit preset compares with 17", () => {
    const f = rowFacts(effects, goblin, 15, "slashing");
    expect(f.ac?.value).toBe(17);
    const html = render(<AcCell combatantId="c-gob" facts={f} damageOnly={false} />);
    expect(html).toContain('data-testid="mod-popup-ac" data-record-id="c-gob" data-value="17"');
    expect(html).toContain("vs AC 17 →");
    expect(html).toContain("+2");
    const plain = render(
      <AcCell combatantId="c-brakka" facts={rowFacts(effects, brakka, 14, null)} damageOnly />,
    );
    expect(plain).toContain("AC 14");
    expect(plain).not.toContain("+");
  });
});

describe("FR-MOD-25 popup defense", () => {
  const card = { damageType: "slashing" } as DamageCardPayload;
  const row = (multiplier: "normal" | "half") => ({
    targetId: "c-brakka",
    combatant: brakka,
    hit: true,
    multiplier,
    ac: 14,
    hp: null,
  });
  const Hint = modDefensePart.Chips as React.ComponentType<PopupPartProps<undefined>>;
  const props = (multiplier: "normal" | "half") =>
    ({
      card,
      cardId: "n1",
      row: row(multiplier),
      rows: [row(multiplier)],
      value: undefined,
      onChange() {},
      disabled: false,
    }) as PopupPartProps<undefined>;

  test("FR-MOD-25 Brakka raging, slashing: preset Half, hint 'Half (Rage)'; the DM's Normal is marked", () => {
    expect(presetMultiplier(rowFacts(effects, brakka, 14, "slashing"))).toBe("half");
    expect(presetMultiplier(rowFacts(effects, brakka, 14, "fire"))).toBe("normal");
    const html = render(<Hint {...props("half")} />);
    expect(html).toContain('data-testid="mod-popup-defense"');
    expect(html).toContain('data-value="resistance"');
    expect(html).toContain("Half (Rage)");
    expect(html).not.toContain("DM set");
    expect(render(<Hint {...props("normal")} />)).toContain("Half (Rage) · DM set");
    expect(modDefensePart.toInput(undefined, row("half"), [row("half")], card)).toEqual({});
  });

  test("FR-MOD-25 no defense against the type → no hint", () => {
    const fire = { ...props("normal"), card: { damageType: "fire" } as DamageCardPayload };
    expect(render(<Hint {...fire} />)).toBe("");
  });
});
