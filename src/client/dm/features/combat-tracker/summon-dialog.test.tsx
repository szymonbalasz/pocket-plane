// Sprint 6 CP3 (CBT §13.3), DM client: the Summon… dialog's fields and intent (FR-CBT-110,
// -118), Companion ▸ Dismiss's hint (FR-CBT-112), the Initiative header button and the summon
// concentration card's view (FR-CBT-120). Static render over the companions fight
// (`companions-fixture.tsx`).
import { describe, expect, test } from "bun:test";
import { EFFECT_TYPE } from "@shared/combat-extras/schemas";
import { CBT_INTENTS } from "@shared/combat-tracker/schemas";
import { SUMMON_CARD_KIND } from "@shared/combat-tracker/summon-card-kind";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { Dialog } from "@ui/components/ui/overlays";
import {
  companionStore,
  DM_ROWS,
  renderWith,
} from "@ui/features/combat-tracker/companions-fixture";
import { dmNotificationViews } from "../../notification-views";
import { dismissReasonOf, PRESS_NEXT_HINT } from "./companion-menu";
import { dmInitiativeWindow } from "./initiative-window";
import { cardSummonsLeft } from "./summon-card-view";
import { concentrationOf, SummonBody, summonInput, summonOwners } from "./summon-dialog";

const Body = dmInitiativeWindow.component;

/** The DM store with Thorn concentrating on Conjure Elemental. */
function concentrating(): RecordStore {
  const s = companionStore("dm");
  return {
    ...s,
    records: {
      ...s.records,
      [EFFECT_TYPE]: {
        c1: {
          id: "c1",
          seq: 1,
          kind: "concentration",
          label: "Conjure Elemental",
          targetCharacterId: "ch-thorn",
          targetCombatantId: null,
          endedAt: null,
        },
      },
    },
  } as RecordStore;
}

const dialog = (store: RecordStore, preset: string | null) =>
  renderWith(
    store,
    <Dialog open>
      <SummonBody preset={preset} freeCell={() => null} />
    </Dialog>,
  );

describe("FR-CBT-118 Summon… dialog", () => {
  test("FR-CBT-118 DM rows: the header Summon… button; the dialog's lookup, count, owner preset, three modes, HP, Hidden; no concentration tick unless the owner concentrates", () => {
    expect(renderWith(companionStore("dm"), <Body kind="cbt.initiative" instance="" />)).toContain(
      'data-testid="cbt-init-summon"',
    );
    const html = dialog(companionStore("dm"), "ch-mira");
    for (const id of ["lookup", "count", "hp", "hidden", "submit"]) {
      expect(html).toContain(`data-testid="cbt-summon-${id}`);
    }
    expect(html).toMatch(/data-testid="cbt-summon-owner"[^>]*data-value="ch-mira"/);
    expect(html).toContain("Summon for Mira");
    for (const m of ["after-owner", "in-owner-turn", "own"]) {
      expect(html).toContain(`data-testid="cbt-summon-mode" data-value="${m}"`);
    }
    expect(html).not.toContain('data-testid="cbt-summon-concentration"');
    // Nothing picked yet: Summon disabled.
    expect(html).toMatch(/data-testid="cbt-summon-submit"[^>]*disabled/);
  });

  test("FR-CBT-118 the concentration tick shows iff the owner concentrates, named", () => {
    const html = dialog(concentrating(), "ch-thorn");
    expect(html).toContain('data-testid="cbt-summon-concentration"');
    expect(html).toContain("Linked to Thorn&#x27;s concentration (Conjure Elemental)");
    expect(dialog(concentrating(), "ch-mira")).not.toContain("cbt-summon-concentration");
    expect(concentrationOf(concentrating(), "ch-thorn")).toBe("Conjure Elemental");
    expect(concentrationOf(concentrating(), "ch-mira")).toBeNull();
  });

  test("FR-CBT-110 summon intent: owners are the fight's PCs with a player; the form → cbt.summon input", () => {
    const owners = summonOwners(DM_ROWS as never[], companionStore("dm").records.entity);
    expect(owners.map((o) => [o.characterId, o.hasPlayer])).toEqual([
      ["ch-brakka", true],
      ["ch-mira", true],
      ["ch-thorn", true],
    ]);
    const form = {
      definitionId: "fe",
      count: 2,
      ownerCharacterId: "ch-thorn",
      turnMode: "own" as const,
      hpMode: "rolled" as const,
      hidden: true,
      linkConcentration: true,
    };
    expect(summonInput("e1", form, true, { col: 3, row: 4 })).toEqual({
      encounterId: "e1",
      definitionId: "fe",
      count: 2,
      ownerCharacterId: "ch-thorn",
      turnMode: "own",
      hpMode: "rolled",
      hidden: true,
      linkConcentration: true,
      at: { col: 3, row: 4 },
    });
    // Not concentrating: no link sent; nothing picked / count out of range: no intent.
    expect(summonInput("e1", form, false, null)).not.toHaveProperty("linkConcentration");
    expect(summonInput("e1", { ...form, definitionId: null }, true, null)).toBeNull();
    expect(summonInput("e1", { ...form, count: 9 }, true, null)).toBeNull();
  });
});

describe("FR-CBT-112 Companion ▸ Dismiss", () => {
  test("FR-CBT-112 dismiss: offered on companions; the turn combatant → 'Press Next first'", () => {
    expect(dismissReasonOf({ id: "fe3", ownerCharacterId: "ch-thorn" }, "wolf")).toBeNull();
    expect(dismissReasonOf({ id: "fe3", ownerCharacterId: "ch-thorn" }, "fe3")).toBe(
      PRESS_NEXT_HINT,
    );
    expect(dismissReasonOf({ id: "goblin", ownerCharacterId: null }, "wolf")).not.toBeNull();
    expect(CBT_INTENTS.dismiss).toBe("cbt.dismiss");
  });

  test("FR-CBT-112 a dismissed companion (inactive in the DM's store) leaves the DM's Initiative", () => {
    const s = companionStore("dm");
    const rows = s.records.combatant as Record<string, Record<string, unknown>>;
    const store = {
      ...s,
      records: { ...s.records, combatant: { ...rows, fe3: { ...rows.fe3, active: false } } },
    } as RecordStore;
    const html = renderWith(store, <Body kind="cbt.initiative" instance="" />);
    expect(html).not.toContain('data-testid="cbt-init-row" data-record-id="fe3"');
    expect(html).toContain('data-testid="cbt-init-row" data-record-id="thorn"');
  });
});

describe("FR-CBT-120 the summon concentration card (DM view)", () => {
  const card = (state: NotificationRecord["state"], resolution: unknown = null) =>
    ({
      id: "n1",
      kind: SUMMON_CARD_KIND,
      text: "Thorn lost concentration (Conjure Elemental): Fire Elemental 3",
      payload: {
        encounterId: "e1",
        ownerCharacterId: "ch-thorn",
        effectId: "c1",
        combatantIds: ["fe3"],
      },
      state,
      resolution,
      actionLabel: "Dismiss summon",
    }) as unknown as NotificationRecord;

  test("FR-CBT-120 concentration lost card: pending shows Turn hostile; resolved shows the outcome; End rule set", () => {
    const view = dmNotificationViews.get(SUMMON_CARD_KIND);
    expect(view?.endRule?.encounterIdOf(card("pending").payload)).toBe("e1");
    const Render = view?.render as NonNullable<typeof view>["render"] & object;
    const pending = renderWith(companionStore("dm"), <Render notification={card("pending")} />);
    expect(pending).toContain('data-testid="cbt-summon-hostile" data-record-id="n1"');
    expect(pending).toContain("Fire Elemental 3");
    const done = renderWith(
      companionStore("dm"),
      <Render notification={card("resolved", { outcome: "hostile" })} />,
    );
    expect(done).not.toContain("cbt-summon-hostile");
    expect(done).toContain("Turned hostile");
    expect(cardSummonsLeft(card("pending"), companionStore("dm")).map((c) => c.id)).toEqual([
      "fe3",
    ]);
  });
});
