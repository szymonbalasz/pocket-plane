// Sprint 5 R1 in the DM popup (FR-CBT-87, -89, -90, -92, -93, FR-MOD-63): the Apply hit button,
// the damage step from the ruling, late fills that never override (per field, focus, per-card
// drafts in popup-store), the unused line, the late note and the Pending row; static renders of
// the popup with only the card + ruling in the store (a fresh load).
import { beforeEach, describe, expect, test } from "bun:test";
import {
  COMBATANT_TYPE,
  type CombatantView,
  type DamageCardPayload,
  ENCOUNTER_TYPE,
  HIT_RULING_TYPE,
  type HitRulingRecord,
} from "@shared/combat-tracker/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { lazyAfterSnapshot } from "@shared/protocol/lazy";
import { emptyStore } from "@shared/protocol/store";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { PopupBody } from "./attack-popup";
import {
  blurField,
  FIELD_EMPTY,
  fieldValue,
  focusField,
  isTyped,
  lateNote,
  popupStep,
  primaryAction,
  type ResolvedCard,
  rolledHint,
  ruledRows,
  turnKey,
  typeField,
  unusedText,
} from "./late-fill";
import { damageCardRow } from "./pending";
import { useCombatDialogs } from "./popup-store";

const toHit = {
  rollId: "r1",
  dice: [[11, true]] as [number, boolean][],
  constant: 4,
  total: 15,
  manual: true,
  natural: 11,
};
const damage = {
  rollId: "r2",
  dice: [[4, true]] as [number, boolean][],
  constant: 2,
  total: 6,
  manual: true,
};
const card = (o: Partial<DamageCardPayload> = {}): DamageCardPayload =>
  ({
    encounterId: "e1",
    attackerId: "mira",
    attackerName: "Mira",
    attackName: "Light crossbow",
    damageType: "piercing",
    mode: "normal",
    crit: false,
    toHit,
    damage: null,
    attackId: "xbow",
    ...o,
  }) as DamageCardPayload;
const ruling = (targets: HitRulingRecord["targets"]): HitRulingRecord => ({
  id: "ru1",
  campaignId: "c1",
  encounterId: "e1",
  cardId: "n1",
  toHitTotal: 15,
  toHitSet: false,
  targets,
  createdAt: "2026-10-19T00:00:00.000Z",
});
const t = (targetId: string, hit: boolean, multiplier = "normal" as const) => ({
  targetId,
  hit,
  multiplier,
});

describe("FR-CBT-87 Apply hit button", () => {
  test("FR-CBT-87 Apply hit button: to-hit-only card + a Hit row + no total → Apply hit; all Miss, a typed total, a full card → Apply", () => {
    const p = card();
    const base = { step: "to-hit" as const, card: p, typedTotal: false };
    expect(primaryAction({ ...base, hits: [true, false] })).toBe("apply-hit");
    expect(primaryAction({ ...base, hits: [false, false] })).toBe("apply");
    expect(primaryAction({ ...base, hits: [true], typedTotal: true })).toBe("apply");
    expect(primaryAction({ ...base, hits: [true], card: card({ damage }) })).toBe("apply");
    // Damage-only card, and the damage step: always Apply.
    expect(primaryAction({ ...base, hits: [true], card: card({ toHit: null, damage }) })).toBe(
      "apply",
    );
    expect(primaryAction({ ...base, step: "damage", hits: [true] })).toBe("apply");
  });
});

describe("FR-CBT-89 damage step", () => {
  test("FR-CBT-89 damage step from the ruling: rows = ruled hits in order, misses absent, ✕ drops one", () => {
    const r = ruling([t("gob", true, "half" as never), t("gob2", false), t("wolf", true)]);
    expect(popupStep(r)).toBe("damage");
    expect(popupStep(null)).toBe("to-hit");
    expect(ruledRows(r, [])).toEqual([
      { targetId: "gob", multiplier: "half" },
      { targetId: "wolf", multiplier: "normal" },
    ]);
    expect(ruledRows(r, ["gob"]).map((x) => x.targetId)).toEqual(["wolf"]);
  });

  test("FR-CBT-89 Pending row: 'Mira: hit Goblin — waiting for damage' / '— damage ready'; unruled cards read their text", () => {
    const n = { text: "Mira: 15 to hit (Light crossbow)", payload: card() };
    const names: Record<string, string> = { gob: "Goblin", gob2: "Goblin 2" };
    const r = ruling([t("gob", true), t("gob2", false)]);
    expect(damageCardRow(n, r, (id) => names[id])).toEqual({
      text: "Mira: hit Goblin — waiting for damage",
      step: "damage",
    });
    expect(damageCardRow({ ...n, payload: card({ damage }) }, r, (id) => names[id]).text).toBe(
      "Mira: hit Goblin — damage ready",
    );
    expect(damageCardRow(n, null, (id) => names[id])).toEqual({ text: n.text, step: "to-hit" });
  });
});

describe("FR-CBT-90 late roll fills empty fields only", () => {
  test("FR-CBT-90 late roll fills empty fields only: untouched fills; typed keeps + rolled N; typed then emptied fills", () => {
    // Untouched: nothing before the roll, the roll after.
    expect(fieldValue(FIELD_EMPTY, null)).toBe("");
    expect(fieldValue(FIELD_EMPTY, 6)).toBe("6");
    expect(rolledHint(FIELD_EMPTY, 6)).toBeNull();
    // A total typed before the roll (the base part's) stays, with "rolled N".
    const typed = blurField(typeField("7"));
    expect(isTyped(typed)).toBe(true);
    expect(fieldValue(typed, 6)).toBe("7");
    expect(rolledHint(typed, 6)).toBe(6);
    // Typed, then emptied → follows the roll again.
    const emptied = blurField(typeField(""));
    expect(fieldValue(emptied, 6)).toBe("6");
    expect(isTyped(emptied)).toBe(false);
  });

  test("FR-CBT-90 a focused empty field never fills: 'rolled N', fills on blur; typing 7 never yields 87", () => {
    let f = focusField(FIELD_EMPTY, null);
    expect(isTyped(f)).toBe(false);
    // The roll arrives while focused: still empty, the hint shows.
    expect(fieldValue(f, 8)).toBe("");
    expect(rolledHint(f, 8)).toBe(8);
    // Blur while still empty → filled.
    expect(fieldValue(blurField(f), 8)).toBe("8");
    // Typing while the roll arrives: the DM's "7", never "87".
    f = focusField(FIELD_EMPTY, null);
    f = typeField("7");
    expect(fieldValue(f, 8)).toBe("7");
    expect(fieldValue(blurField(f), 8)).toBe("7");
    // Focus over a rolled value, untouched → blur follows the roll (not typed).
    const g = focusField(FIELD_EMPTY, 6);
    expect(fieldValue(g, 6)).toBe("6");
    expect(isTyped(blurField(g))).toBe(false);
  });

  describe("per-card drafts (popup-store)", () => {
    beforeEach(() => {
      useCombatDialogs.setState({ drafts: {}, resolved: [], cardId: null });
    });

    test("FR-CBT-90 type, Later, roll, reopen → typed kept + rolled N; multipliers and unticks kept", () => {
      const d = useCombatDialogs.getState();
      d.openCard("n1");
      d.editDraft("n1", () => ({ damage: blurField(typeField("7")) }));
      d.editDraft("n1", () => ({ per: { gob: { hit: null, mult: "half" } } }));
      d.editDraft("n1", () => ({ parts: { "mod.triggers": { touched: { df: { on: false } } } } }));
      // Later; another card in between; a reconnect leaves client memory alone.
      d.closeCard();
      d.openCard("n2");
      d.closeCard();
      d.openCard("n1");
      const kept = useCombatDialogs.getState().drafts.n1;
      // The roll arrived meanwhile (6): the typed 7 stays, "rolled 6".
      expect(fieldValue(kept?.damage, 6)).toBe("7");
      expect(rolledHint(kept?.damage, 6)).toBe(6);
      expect(kept?.per.gob?.mult).toBe("half");
      expect(kept?.parts["mod.triggers"]).toEqual({ touched: { df: { on: false } } });
      // Applied / dismissed: the card's draft goes.
      useCombatDialogs.getState().dropDraft("n1");
      expect(useCombatDialogs.getState().drafts.n1).toBeUndefined();
    });

    test("FR-CBT-90 closing with a field focused thaws it: it fills when the roll arrives", () => {
      const d = useCombatDialogs.getState();
      d.editDraft("n1", () => ({ damage: focusField(FIELD_EMPTY, null) }));
      d.thawDraft("n1");
      expect(fieldValue(useCombatDialogs.getState().drafts.n1?.damage, 6)).toBe("6");
    });

    test("FR-CBT-90 Flame Tongue: typed 12 stays as slashing, fire fills", () => {
      const d = useCombatDialogs.getState();
      d.editDraft("n1", () => ({ damage: blurField(typeField("12")) }));
      const draft = useCombatDialogs.getState().drafts.n1;
      expect(fieldValue(draft?.damage, 9)).toBe("12");
      expect(fieldValue(draft?.extra[0], 4)).toBe("4");
      expect(rolledHint(draft?.extra[0], 4)).toBeNull();
    });
  });
});

describe("FR-CBT-92 / -93 notes", () => {
  test("FR-CBT-92 'Also rolled: 9 — not used'", () => {
    expect(unusedText({ unusedRolls: [{ rollId: "x", total: 9 }] })).toBe(
      "Also rolled: 9 — not used",
    );
    expect(unusedText({})).toBeNull();
  });

  test("FR-CBT-93 no join when closed or applied: late note only for a card resolved this turn, same attacker and row", () => {
    const resolved: ResolvedCard = {
      cardId: "n1",
      seq: 3,
      encounterId: "e1",
      attackerId: "mira",
      attackerName: "Mira",
      attackName: "Light crossbow",
      attackId: "xbow",
      turn: turnKey({ round: 1, turnCombatantId: "mira" }),
    };
    const late = { seq: 5, p: card({ toHit: null, damage }) };
    expect(lateNote(late, [resolved], "1:mira")).toBe(
      "Mira's Light crossbow attack was already applied. Undo it to use this roll there.",
    );
    // An earlier turn, a reload (no memory), another row, a card with a to-hit: no note.
    expect(lateNote(late, [resolved], "1:gob")).toBeNull();
    expect(lateNote(late, [], "1:mira")).toBeNull();
    expect(
      lateNote(
        { ...late, p: card({ toHit: null, damage, attackId: "dagger" }) },
        [resolved],
        "1:mira",
      ),
    ).toBeNull();
    expect(lateNote({ seq: 5, p: card({ damage }) }, [resolved], "1:mira")).toBeNull();
  });
});

describe("FR-CBT-89 popup render (fresh load: card + ruling only)", () => {
  const combatant = (id: string, name: string): CombatantView =>
    ({
      id,
      encounterId: "e1",
      tokenId: null,
      name,
      kind: "monster",
      active: true,
      removed: false,
      hidden: false,
      hpCurrent: 7,
      hpMax: 7,
    }) as CombatantView;
  const render = (payload: DamageCardPayload, rulings: HitRulingRecord[]) => {
    const note = {
      id: "n1",
      seq: 4,
      kind: "damage-card",
      state: "pending",
      text: "Mira: 15 to hit (Light crossbow)",
      payload,
    } as NotificationRecord;
    const records = {
      notification: { n1: note },
      [HIT_RULING_TYPE]: Object.fromEntries(rulings.map((r) => [r.id, r])),
      [COMBATANT_TYPE]: {
        gob: combatant("gob", "Goblin"),
        gob2: combatant("gob2", "Goblin 2"),
        mira: { ...combatant("mira", "Mira"), kind: "pc" },
      },
      [ENCOUNTER_TYPE]: { e1: { id: "e1", status: "started", round: 1, turnCombatantId: "mira" } },
    };
    const sync = createStore<SyncState>()(
      () =>
        ({
          state: "live",
          store: {
            ...emptyStore(),
            you: { campaignId: "c1", role: "dm", playerId: null },
            records,
          },
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
  };

  beforeEach(() => {
    useCombatDialogs.setState({ drafts: {}, resolved: [], cardId: null });
  });

  test("FR-CBT-89 damage step from the ruling: step damage, rows = ruled hits, no Hit toggle or Add target, ✕ per row, waiting", () => {
    const html = render(card(), [ruling([t("gob2", true), t("gob", false)])]);
    expect(html).toContain('data-testid="cbt-popup-step" data-value="damage"');
    expect(html).toContain("Hit applied");
    expect(html).toContain("15 · hit applied");
    expect(html).toContain('data-testid="cbt-popup-target-row" data-record-id="gob2"');
    expect(html).not.toContain('data-record-id="gob" data-source');
    expect(html).toContain('data-testid="cbt-popup-row-drop" data-record-id="gob2"');
    expect(html).not.toContain("cbt-popup-target-hit");
    expect(html).not.toContain("cbt-popup-target-add");
    expect(html).toContain('data-testid="cbt-popup-waiting"');
    // No total yet: Apply (not Apply hit), disabled.
    expect(html).toContain('data-testid="cbt-popup-apply"');
    expect(html).not.toContain("cbt-popup-apply-hit");
  });

  test("FR-CBT-89 the late roll shows its total in the damage step, with the unused line", () => {
    // (SSR reads popup-store's initial state: drops are covered by `ruledRows` above.)
    const html = render(card({ damage, unusedRolls: [{ rollId: "r9", total: 9 }] }), [
      ruling([t("gob2", true), t("gob", true)]),
    ]);
    expect(html).toContain('data-testid="cbt-popup-target-row" data-record-id="gob2"');
    expect(html).toContain('data-testid="cbt-popup-target-row" data-record-id="gob"');
    expect(html).toContain('value="6"');
    expect(html).toContain("Also rolled: 9 — not used");
    expect(html).not.toContain("cbt-popup-waiting");
  });

  test("FR-CBT-87 the to-hit step without a ruling: step to-hit, Hit toggles and Add target", () => {
    const html = render(card(), []);
    expect(html).toContain('data-testid="cbt-popup-step" data-value="to-hit"');
    expect(html).toContain("cbt-popup-target-add");
    expect(html).toContain('data-testid="cbt-popup-waiting-damage"');
  });

  test("FR-CBT-72 a damage-only card's header says what it shows, never 'To-hit step' (R1 note, sprint 5 R2)", () => {
    const html = render(card({ toHit: null, damage }), []);
    expect(html).toContain("Damage only, no to-hit");
    expect(html).not.toContain("To-hit step");
    expect(render(card(), [])).toContain("To-hit step");
  });
});
