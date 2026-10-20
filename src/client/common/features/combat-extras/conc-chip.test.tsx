// Sprint 7 FU-combat (FR-CBTX-59–61, OQ-CBTX-30 A; sim-10 a12): Thorn's "Concentrating: Conjure
// Elemental" chip is whole or icon-only, never cut, with its Tooltip; a click gives the DM and
// Thorn's owner (player-2) the menu, nobody else. Static render over the companions fight
// (`companions-fixture.tsx`); the fit on stubbed natural widths; the menu's lines from the
// viewer's store. The browser path (click → End → the DM's card): e2e/combat-followups.e2e.ts.
import { describe, expect, test } from "bun:test";
import { EFFECT_TYPE, type EffectView } from "@shared/combat-extras/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "../../components/ui/overlays";
import { companionStore, renderWith } from "../combat-tracker/companions-fixture";
import { concEndsWith, concMenuFor, concTooltip, fitChipRow } from "./logic";
import { EffectChips } from "./parts";

const conc: EffectView = {
  id: "c1",
  seq: 1,
  kind: "concentration",
  condition: null,
  level: null,
  label: "Conjure Elemental",
  targetCombatantId: null,
  targetCharacterId: "ch-thorn",
  encounterId: "e1",
  endsRound: 11,
  endedAt: null,
} as EffectView;
const bless = {
  ...conc,
  id: "b1",
  seq: 2,
  kind: "custom",
  label: "Bless",
  targetCharacterId: "ch-mira",
  concentrationId: "c1",
  endsRound: null,
} as EffectView;

/** `viewer`'s store with Thorn concentrating (DM: also Bless on Mira linked, FE 3 linked). */
function concentrating(viewer: "dm" | "p1" | "p2"): RecordStore {
  const s = companionStore(viewer);
  const fx = viewer === "dm" ? { c1: conc, b1: bless } : { c1: conc };
  const combatant = { ...s.records.combatant } as Record<string, Record<string, unknown>>;
  if (viewer === "dm") {
    combatant.fe3 = { ...combatant.fe3, concentrationEffectId: "c1" };
  }
  return { ...s, records: { ...s.records, [EFFECT_TYPE]: fx, combatant } } as RecordStore;
}

const chips = (store: RecordStore, compact = true) =>
  renderWith(
    store,
    <EffectChips
      compact={compact}
      effects={[conc]}
      round={1}
      testId={compact ? "cbtx-init-row-effect" : "cbtx-sheet-effect"}
    />,
  );

/** The concentration badge's opening tag. */
const badgeOf = (html: string) =>
  html.match(/<span[^>]*data-testid="cbtx-(init-row|sheet)-effect"[^>]*>/)?.[0] ?? "";

describe("FR-CBTX-59 concentration chip whole or icon-only", () => {
  test("FR-CBTX-59 concentration chip whole or icon-only: full label + '10r', no width cap or ellipsis; Tooltip text with and without rounds", () => {
    const html = chips(concentrating("p1"));
    const badge = badgeOf(html);
    expect(badge).toContain('data-compact="false"');
    for (const bad of ["truncate", "max-width", "max-w-", "text-overflow", "ellipsis"]) {
      expect(badge).not.toContain(bad);
    }
    expect(html).toContain(">Conjure Elemental<");
    expect(html).toContain(">10r<");
    expect(concTooltip(conc, 1)).toBe("Concentrating: Conjure Elemental · 10 rounds left");
    expect(concTooltip({ ...conc, endsRound: null }, 1)).toBe("Concentrating: Conjure Elemental");
    // The measuring copy: full and icon-only, measured like a trigger chip (never folds).
    expect(html.match(/data-chip-measure="trigger"/g)).toHaveLength(1);
  });

  test("FR-CBTX-59 concentration chip whole or icon-only: at 320 / 280 the fit makes it icon-only (brain + '10r'), never '+N'", () => {
    // Natural widths (11 px text): "Conjure Elemental 10r" 118, icon-only 34; DM 400 room 180,
    // DM 320 room 100, player 280 room 60.
    const chip = { full: 118, short: 34 };
    expect(fitChipRow([], [chip], 180)).toEqual({ n: 0, tier: 0, icons: false, wrap: false });
    expect(fitChipRow([], [chip], 100)).toEqual({ n: 0, tier: 0, icons: true, wrap: false });
    expect(fitChipRow([], [chip], 60)).toEqual({ n: 0, tier: 0, icons: true, wrap: false });
    // A tight room with an effect chip too: the effect folds, the concentration chip stays.
    const r = fitChipRow([{ full: 60, short: 52 }], [chip], 60);
    expect([r.n, r.icons]).toEqual([0, true]);
  });

  test("FR-CBTX-59 concentration chip whole or icon-only: the sheet's chip reads 'Concentrating: Conjure Elemental' and wraps instead of cutting", () => {
    const html = chips(concentrating("p2"), false);
    const badge = badgeOf(html);
    expect(html).toContain(">Concentrating: Conjure Elemental<");
    expect(badge).toContain("whitespace-normal");
    expect(badge).not.toContain("truncate");
    expect(badge).not.toContain("max-w-");
  });
});

describe("FR-CBTX-60 chip click", () => {
  test("FR-CBTX-60 chip click: the DM and player-2 (Thorn's owner) get the menu trigger; player-1 a focusable chip with a Tooltip only", () => {
    for (const v of ["dm", "p2"] as const) {
      const html = chips(concentrating(v));
      expect(html).toMatch(
        /data-testid="cbtx-conc-chip" data-record-id="c1"[^>]*aria-haspopup="menu"/,
      );
      expect(concMenuFor(concentrating(v), conc)).toBe(v === "dm" ? "dm" : "owner");
    }
    const p1 = chips(concentrating("p1"));
    expect(p1).not.toContain("cbtx-conc-chip");
    expect(badgeOf(p1)).toContain('tabindex="0"');
    expect(concMenuFor(concentrating("p1"), conc)).toBeNull();
    // A monster's concentration: DM only.
    const monster = { ...conc, targetCharacterId: null, targetCombatantId: "goblin" };
    expect(concMenuFor(concentrating("p2"), monster)).toBeNull();
    expect(concMenuFor(concentrating("dm"), monster)).toBe("dm");
  });

  test("FR-CBTX-60 chip click: 'Ends with it' from the viewer's store — the DM: Bless on Mira, Fire Elemental 3; players hold no links", () => {
    expect(concEndsWith(concentrating("dm"), conc)).toEqual(["Bless on Mira", "Fire Elemental 3"]);
    expect(concEndsWith(concentrating("p2"), conc)).toEqual([]);
  });

  test("FR-CBTX-60 chip click: without a synced store (static parts) the chip is focusable for its Tooltip", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <EffectChips compact effects={[conc]} round={1} testId="cbtx-init-row-effect" />
      </TooltipProvider>,
    );
    expect(badgeOf(html)).toContain('tabindex="0"');
    expect(html).not.toContain("cbtx-conc-chip");
  });
});
