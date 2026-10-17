// Trigger badges on Initiative rows and tokens (FR-CBTX-52, -53; MOD §13.1 `FR-CBTX-52/53
// badges render`): chip words per state, uses from the sheet, hidden when not armed, token icon
// muted when none is ready, MOD's overlay line last in the registry, chips after the effect
// chips (last into "+N"). Static server render; the viewer's store holds only what FR-MOD-55
// sends, so "who sees what" is the server's (trigger-state-sync tests).
import { describe, expect, test } from "bun:test";
import type { EffectView } from "@shared/combat-extras/schemas";
import type { TriggerStateRecord } from "@shared/effect-modifiers/trigger-state";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import type { TokenView } from "@shared/scenes-map/schemas";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "../../components/ui/overlays";
import { fitChips } from "../combat-extras/logic";
import { EffectChips } from "../combat-extras/parts";
import { tokenOverlays } from "../scenes-map/token-overlays";
import {
  modTriggersOverlay,
  TOKEN_TRIGGER_ID,
  type TriggerChip,
  tokenTriggerIcon,
  triggerChipsFor,
} from "./trigger-badges";

const byId = (rows: object[]) => Object.fromEntries(rows.map((r) => [(r as { id: string }).id, r]));

const row = (
  o: Partial<TriggerStateRecord> & { id: string; name: string },
): TriggerStateRecord => ({
  campaignId: "c",
  encounterId: "e1",
  combatantId: "k-brakka",
  triggerId: `t-${o.id}`,
  characterId: "ch-brakka",
  ownerPlayerId: "p1",
  on: "hit",
  armed: true,
  charge: "ready",
  featureId: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...o,
});

const brakka = {
  id: "k-brakka",
  encounterId: "e1",
  kind: "pc",
  entityId: "ch-brakka",
  tokenId: "tok-brakka",
  name: "Brakka",
  active: true,
};

function store(rows: TriggerStateRecord[], o: { used?: number; rules?: object[] } = {}) {
  const s: RecordStore = {
    ...emptyStore(),
    you: { campaignId: "c", role: "dm", playerId: null },
    records: {
      encounter: { e1: { id: "e1", status: "started", round: 2 } },
      combatant: byId([brakka]),
      "trigger-state": byId(rows),
      "creature-sheet": byId([
        {
          id: "sh-brakka",
          entityId: "ch-brakka",
          features: [{ id: "f-fury", name: "Divine Fury", usesMax: 2, used: o.used ?? 0 }],
        },
      ]),
      "rule-trigger": byId(o.rules ?? []),
    },
  };
  return s;
}

const fury = row({ id: "fury", name: "Divine Fury" });

describe("FR-CBTX-52/53 badges render", () => {
  test("FR-CBTX-52 chip words per state: ready, used (window words), waiting neutral", () => {
    const [ready] = triggerChipsFor(store([fury]), brakka);
    expect(ready).toMatchObject({ name: "Divine Fury", state: "ready", muted: false, uses: null });
    expect(ready?.tooltip).toBe("Ready");

    const used = row({ id: "fury", name: "Divine Fury", charge: "used" });
    expect(triggerChipsFor(store([used]), brakka)[0]).toMatchObject({
      state: "used",
      muted: true,
      tooltip: "Used this turn",
    });
    // The loaded rule names its window: "… this round".
    const rule = { id: "t-fury", rule: { every: "round" } };
    expect(triggerChipsFor(store([used], { rules: [rule] }), brakka)[0]?.tooltip).toBe(
      "Used this round",
    );

    const waiting = row({ id: "fury", name: "Divine Fury", charge: "waiting" });
    expect(triggerChipsFor(store([waiting]), brakka)[0]).toMatchObject({
      state: "waiting",
      muted: false,
      tooltip: "On Brakka's turn",
    });
  });

  test("FR-CBTX-52 a feature trigger shows uses left from the sheet: 1, 0 muted, −1 down", () => {
    const sf = row({ id: "sf", name: "Divine Fury", featureId: "f-fury" });
    const at = (used: number) => triggerChipsFor(store([sf], { used }), brakka)[0] as TriggerChip;
    expect(at(1)).toMatchObject({ state: "uses", uses: { left: 1, text: "1" }, muted: false });
    expect(at(1).tooltip).toBe("1 / 2 left");
    expect(at(2)).toMatchObject({ state: "uses", uses: { left: 0, text: "0" }, muted: true });
    expect(at(3)).toMatchObject({ uses: { left: -1, text: "−1" }, muted: true, down: true });
    // Waiting wins over the count (never a false Ready).
    const w = row({ id: "sf", name: "Divine Fury", featureId: "f-fury", charge: "waiting" });
    expect(triggerChipsFor(store([w], { used: 1 }), brakka)[0]).toMatchObject({
      state: "waiting",
      uses: null,
    });
  });

  test("FR-CBTX-52 not in effect (Rage off), another combatant's row, a removed combatant: no chip", () => {
    const off = row({ id: "off", name: "Divine Fury", armed: false });
    const other = row({ id: "sa", name: "Sneak Attack", combatantId: "k-thorn" });
    expect(triggerChipsFor(store([off, other]), brakka)).toEqual([]);
    expect(triggerChipsFor(store([fury]), { ...brakka, active: false })).toEqual([]);
  });

  test("FR-CBTX-53 one token icon: ready while any is ready, muted when all used or waiting; hover lists each", () => {
    const sa = row({ id: "sa", name: "Sneak Attack", charge: "used" });
    const both = tokenTriggerIcon(triggerChipsFor(store([fury, sa]), brakka));
    expect(both).toMatchObject({ id: TOKEN_TRIGGER_ID, icon: "zap", value: "ready" });
    expect(both?.label.split("\n")).toEqual([
      "↯ Triggers",
      "Divine Fury — ready",
      "Sneak Attack — used this turn",
    ]);
    const used = row({ id: "fury", name: "Divine Fury", charge: "used" });
    expect(tokenTriggerIcon(triggerChipsFor(store([used, sa]), brakka))?.value).toBe("used");
    const waiting = row({ id: "fury", name: "Divine Fury", charge: "waiting" });
    expect(tokenTriggerIcon(triggerChipsFor(store([waiting]), brakka))?.value).toBe("used");
    expect(tokenTriggerIcon([])).toBeNull();
  });

  test("FR-CBTX-53 MOD's overlay line: last in the registry, icon on the bound token only", () => {
    expect(tokenOverlays.at(-1)).toBe(modTriggersOverlay);
    const view = { client: "dm", selected: false, targeting: false } as const;
    const tok = (id: string) => ({ id }) as TokenView;
    expect(modTriggersOverlay.decorate?.(tok("tok-brakka"), store([fury]), view)?.icons).toEqual([
      expect.objectContaining({ id: TOKEN_TRIGGER_ID, value: "ready" }),
    ]);
    expect(modTriggersOverlay.decorate?.(tok("tok-other"), store([fury]), view)).toBeNull();
    // After End the rows are deleted (and no combatant is bound): nothing.
    expect(modTriggersOverlay.decorate?.(tok("tok-brakka"), store([]), view)).toBeNull();
  });

  test("FR-CBTX-52 chips render after the effect chips: lightning, name, uses, check when used", () => {
    const prone = {
      id: "fx-prone",
      kind: "condition",
      condition: "prone",
      level: null,
      label: null,
      targetCombatantId: null,
      targetCharacterId: "ch-brakka",
      encounterId: "e1",
      endsRound: null,
    } as unknown as EffectView;
    const sf = row({ id: "sf", name: "Searing Strike", featureId: "f-fury" });
    const used = row({ id: "fury", name: "Divine Fury", charge: "used" });
    const chips = triggerChipsFor(store([sf, used], { used: 3 }), brakka);
    const html = renderToStaticMarkup(
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <EffectChips
          compact
          effects={[prone]}
          triggers={chips}
          round={2}
          testId="cbtx-init-row-effect"
        />
      </TooltipProvider>,
    );
    const effectAt = html.indexOf('data-testid="cbtx-init-row-effect"');
    const furyTag =
      html.match(
        /<span[^>]*data-testid="cbtx-trigger-chip"[^>]*data-record-id="fury"[^>]*>/,
      )?.[0] ?? "";
    const sfTag =
      html.match(/<span[^>]*data-testid="cbtx-trigger-chip"[^>]*data-record-id="sf"[^>]*>/)?.[0] ??
      "";
    expect(effectAt).toBeGreaterThan(-1);
    expect(html.indexOf(furyTag)).toBeGreaterThan(effectAt);
    expect(furyTag).toContain('data-state="used"');
    expect(furyTag).toContain('data-muted="true"');
    expect(sfTag).toContain('data-state="uses"');
    expect(sfTag).toContain('data-value="-1"');
    expect(html).toContain('<span class="ml-0.5 shrink-0 text-hp-down">−1</span>');
    expect(html).toContain('aria-label="Used"');
    expect(html).toContain("lucide-zap");
    // Trigger chips are last in the line (Prone, Divine Fury, Searing Strike), so they are the
    // first into "+N": one chip too many → Searing Strike goes, Prone stays.
    expect(html.indexOf('data-record-id="sf"')).toBeGreaterThan(html.indexOf(furyTag));
    expect(fitChips([40, 60, 60], 140)).toBe(2);
  });
});
