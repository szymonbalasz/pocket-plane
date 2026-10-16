// FR-MOD-39, -40 popup chips (R7): defaults from settle facts (first Hit row, untick, ask),
// following Hit toggles until touched; value edit, own multiplier (typed parts: their defense),
// target Select, Force after a conflict; the apply share and preview; static render + test IDs.
import { describe, expect, test } from "bun:test";
import { EFFECT_TYPE } from "@shared/combat-extras/schemas";
import type {
  CardTriggerPart,
  CombatantView,
  DamageCardPayload,
} from "@shared/combat-tracker/schemas";
import { EFFECT_PRESET_TYPE } from "@shared/effect-modifiers/schemas";
import { lazyAfterSnapshot } from "@shared/protocol/lazy";
import { emptyStore } from "@shared/protocol/store";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import type { PopupRowView } from "../combat-tracker/popup-parts";
import { modTriggersPart } from "./popup-triggers";
import {
  type ChipFacts,
  type ChipsValue,
  chipsExtra,
  chipsInput,
  chipViews,
  markUsed,
  touch,
} from "./popup-triggers-model";

const fury: CardTriggerPart = {
  triggerId: "df",
  label: "Divine Fury",
  value: 6,
  expression: "1d6+2",
  rollId: "r3",
  type: "radiant",
};
const ma: CardTriggerPart = {
  triggerId: "ma",
  label: "Martial Advantage",
  value: 7,
  expression: "2d6",
  rollId: "r4",
  type: null,
  ask: "an ally within 5 ft of the target",
  untick: true,
};
const card = (triggers: CardTriggerPart[]): DamageCardPayload => ({
  encounterId: "enc",
  attackerId: "brakka",
  attackerName: "Brakka",
  attackName: "Greataxe",
  damageType: "slashing",
  mode: "normal",
  crit: false,
  toHit: null,
  damage: { rollId: "r2", dice: [[8, true]], constant: 4, total: 14, manual: true, triggers },
});
const row = (id: string, hit = true, multiplier: PopupRowView["multiplier"] = "normal") =>
  ({
    targetId: id,
    combatant: { id, name: id, kind: "monster" } as CombatantView,
    hit,
    multiplier,
    ac: 15,
    hp: { cur: 7, max: 7, temp: 0 },
  }) as PopupRowView;
const facts = (defense: Record<string, string> = {}): ChipFacts => ({
  store: { effects: [], campaignPresets: [] },
  defenseOf: (r, type) => (defense[`${r.targetId}:${type}`] as never) ?? null,
});
/** The line's value after the DM's changes (as the first row's sync writes it). */
const valueOf = (c: DamageCardPayload, rows: PopupRowView[], t: ChipsValue["touched"] = {}) => ({
  touched: t,
  chips: chipViews(c, rows, t, facts()),
});

describe("FR-MOD-39 chip defaults", () => {
  test("FR-MOD-39 the first Hit row gets the part, ticked; a Hit toggle moves an untouched chip; no Hit row → unticked, shown on the first row", () => {
    const c = card([fury]);
    const [v] = chipViews(c, [row("gob", false), row("gob2"), row("wolf")], {}, facts());
    expect(v).toMatchObject({
      text: "+ 6 radiant Divine Fury",
      on: true,
      targetId: "gob2",
      shownOn: "gob2",
      value: 6,
      multiplier: "normal",
      hint: null,
      lands: 6,
    });
    const [moved] = chipViews(c, [row("gob"), row("gob2")], {}, facts());
    expect(moved?.targetId).toBe("gob");
    const [none] = chipViews(c, [row("gob", false)], {}, facts());
    expect(none).toMatchObject({ on: false, targetId: null, shownOn: "gob", lands: 0 });
  });

  test("FR-MOD-39 ask + untick → unticked on its default target, hint 'Check: …'", () => {
    const [v] = chipViews(card([ma]), [row("brakka", true, "half")], {}, facts());
    expect(v).toMatchObject({
      on: false,
      targetId: "brakka",
      hint: { kind: "ask", text: "Check: an ally within 5 ft of the target" },
      // Untyped: the attack's type → the row's multiplier.
      multiplier: "half",
      lands: 0,
    });
  });

  test("FR-MOD-25 / R7 a typed part's multiplier: its own defense, not the row's (Half row, radiant Normal)", () => {
    const rows = [row("brakka", true, "half")];
    expect(chipViews(card([fury]), rows, {}, facts())[0]?.multiplier).toBe("normal");
    const resist = facts({ "brakka:radiant": "half" });
    expect(chipViews(card([fury]), rows, {}, resist)[0]).toMatchObject({
      multiplier: "half",
      lands: 3,
    });
    // A part typed as the attack follows the row.
    const slashing = { ...fury, type: "slashing" as const };
    expect(chipViews(card([slashing]), rows, {}, facts())[0]?.multiplier).toBe("half");
  });
});

describe("FR-MOD-40 DM overrides and the apply share", () => {
  test("FR-MOD-40 untick, value edit, own multiplier, retarget; Miss rows send nothing; preview sums ticked chips", () => {
    const c = card([fury, { ...ma, untick: undefined, ask: undefined }]);
    const rows = [row("gob"), row("wolf")];
    let v = valueOf(c, rows);
    expect(chipsInput(v, rows[0] as PopupRowView)).toEqual({
      triggers: [
        { triggerId: "df", multiplier: "normal" },
        { triggerId: "ma", multiplier: "normal" },
      ],
    });
    const df = v.chips[0];
    if (!df) throw new Error("no chip");
    v = valueOf(c, rows, touch(v, df, { value: 9, multiplier: "double", targetId: "wolf" }));
    const ma2 = v.chips[1];
    if (!ma2) throw new Error("no chip");
    v = valueOf(c, rows, touch(v, ma2, { on: false }));
    expect(chipsInput(v, rows[0] as PopupRowView)).toEqual({});
    expect(chipsInput(v, rows[1] as PopupRowView)).toEqual({
      triggers: [{ triggerId: "df", value: 9, multiplier: "double" }],
    });
    expect([
      chipsExtra(v, rows[0] as PopupRowView),
      chipsExtra(v, rows[1] as PopupRowView),
    ]).toEqual([0, 18]);
    // The target row turns Miss: the touched chip has no target, nothing is sent.
    const missed = [row("gob"), row("wolf", false)];
    const w = valueOf(c, missed, v.touched);
    expect(w.chips[0]).toMatchObject({ on: false, targetId: null });
    expect(chipsInput(w, missed[1] as PopupRowView)).toEqual({});
  });

  test("FR-MOD-40 a conflict naming the part → 'Used this turn' hint + Force; forcing sends force", () => {
    const c = card([fury]);
    const rows = [row("gob")];
    const v = valueOf(c, rows);
    expect(markUsed(v, [{ path: ["targets", 0] }])).toBeNull();
    const touched = markUsed(v, [
      { path: ["triggers", "df"], message: "Divine Fury was already used this turn" },
    ]);
    if (!touched) throw new Error("not marked");
    let u = valueOf(c, rows, touched);
    expect(u.chips[0]).toMatchObject({
      on: true,
      force: false,
      hint: { kind: "used", text: "Divine Fury was already used this turn" },
    });
    const chip = u.chips[0];
    if (!chip) throw new Error("no chip");
    u = valueOf(c, rows, touch(u, chip, { force: true }));
    expect(chipsInput(u, rows[0] as PopupRowView)).toEqual({
      triggers: [{ triggerId: "df", multiplier: "normal", force: true }],
    });
    // The line's onReject hook returns the marked value.
    const line = modTriggersPart as unknown as {
      onReject(v: ChipsValue, issues: unknown[]): ChipsValue | undefined;
    };
    expect(line.onReject(v, [{ path: ["triggers", "df"], message: "x" }])?.touched.df?.used).toBe(
      "x",
    );
  });
});

describe("FR-MOD-39 chips render", () => {
  test("FR-MOD-39 chips under their rows with test IDs; hint; nothing without offers", () => {
    const sync = createStore<SyncState>()(
      () =>
        ({
          state: "live",
          store: {
            ...emptyStore(),
            you: { campaignId: "c1", role: "dm", playerId: null },
            records: { [EFFECT_TYPE]: {}, [EFFECT_PRESET_TYPE]: {} },
          },
          notLiveSince: null,
          everLive: true,
          lazy: lazyAfterSnapshot(1),
          connection: { sendIntent: () => Promise.resolve({}) },
        }) as unknown as SyncState,
    );
    const Chips = modTriggersPart.Chips;
    const rows = [row("gob"), row("wolf")];
    const render = (r: PopupRowView, c: DamageCardPayload) =>
      renderToStaticMarkup(
        <SyncContext.Provider value={sync}>
          <TooltipProvider delayDuration={0} skipDelayDuration={0}>
            <Chips
              card={c}
              cardId="n1"
              row={r}
              rows={rows}
              value={undefined}
              onChange={() => {}}
              disabled={false}
            />
          </TooltipProvider>
        </SyncContext.Provider>,
      );
    const c = card([fury, ma]);
    const gob = render(rows[0] as PopupRowView, c);
    expect(gob).toContain('data-testid="mod-popup-part" data-record-id="df" data-state="on"');
    expect(gob).toContain('data-testid="mod-popup-part" data-record-id="ma" data-state="off"');
    for (const id of [
      "mod-popup-part-tick",
      "mod-popup-part-value",
      "mod-popup-part-mult",
      "mod-popup-part-target",
    ]) {
      expect(gob).toContain(`data-testid="${id}"`);
    }
    expect(gob).toContain("+ 6 radiant Divine Fury");
    expect(gob).toContain('data-testid="mod-popup-part-hint" data-record-id="ma" data-value="ask"');
    expect(gob).toContain("Check: an ally within 5 ft of the target");
    expect(render(rows[1] as PopupRowView, c)).toBe("");
    expect(render(rows[0] as PopupRowView, { ...c, damage: null })).toBe("");
  });
});
