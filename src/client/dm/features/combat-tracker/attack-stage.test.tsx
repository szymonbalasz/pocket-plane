// Tray attacks S3 (FR-CBT-169, #385): the DM Initiative row's Attack ▸ (and the kit stat block,
// which shares its options and intents) has two actions; a click stages the Dice tray pre-filled,
// Alt+click rolls at once, the tray's staged parts ride on the intent. Static server render over a
// fake sync store, as `dice-extras/tray-compose.test.tsx`; the menu itself through its source (a
// closed Radix menu renders no items).
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DamageCardPayload } from "@shared/combat-tracker/schemas";
import type { Attack } from "@shared/entities/schemas";
import { emptyStore } from "@shared/protocol/store";
import { TooltipProvider } from "@ui/components/ui/overlays";
import { diceExtras } from "@ui/features/dice-extras/store";
import {
  type RollControl,
  type RollRequest,
  useRollControl,
} from "@ui/features/dice-roll-log/roll-control";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { ATTACK_ACTIONS, attackControlOptions, attackIntent, trayAside } from "./attack-choices";
import { useCombatDialogs } from "./popup-store";

const SCIMITAR: Attack = {
  id: "a-scim",
  name: "Scimitar",
  toHit: 4,
  damage: "1d6+2",
  damageType: "slashing",
};

function captureControl(options: Parameters<typeof useRollControl>[0]): RollControl {
  const you = { campaignId: "c1", role: "dm", playerId: null };
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: { ...emptyStore(), you, records: {} },
        notLiveSince: null,
        everLive: true,
        connection: { sendIntent: () => Promise.resolve({}) },
      }) as unknown as SyncState,
  );
  let control: RollControl | null = null;
  function Probe() {
    control = useRollControl(options);
    return null;
  }
  renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <Probe />
      </TooltipProvider>
    </SyncContext.Provider>,
  );
  if (!control) throw new Error("no control");
  return control;
}

/** A pending to-hit-only card of the Goblin's Scimitar with this natural. */
const pendingCard = (natural: number) =>
  ({ toHit: { natural }, mode: "advantage", damage: null }) as unknown as DamageCardPayload;

afterEach(() => diceExtras.clear());

describe("FR-CBT-169 Attack ▸ two actions", () => {
  test("FR-CBT-169 Attack ▸ click stages: Attack and Damage only; a click stages the tray pre-filled (no intent), Alt+click rolls at once; the staged parts ride on cbt.attack {rolls: toHit} / cbt.rollDamage", () => {
    expect(ATTACK_ACTIONS.map((a) => [a.value, a.label])).toEqual([
      ["toHit", "Attack"],
      ["damage", "Damage"],
    ]);
    const src = readFileSync(
      fileURLToPath(new URL("./initiative-window.tsx", import.meta.url)),
      "utf8",
    );
    expect(src).not.toContain("Attack + damage");
    expect(src).toContain("<StageHint now />");

    const got: RollRequest[] = [];
    const combat = { combatantId: "goblin", card: null };
    const hit = attackControlOptions("Goblin", SCIMITAR, "toHit", combat);
    expect(hit).toMatchObject({
      expressions: ["1d20+4"],
      category: "attack",
      label: "Goblin — Scimitar attack",
      purpose: "attack",
    });
    const control = captureControl({ ...hit, onRoll: (r) => got.push(r) });
    control.roll({ shiftKey: true });
    const req = diceExtras.api.getState().request;
    expect(req?.kind).toBe("control");
    expect(req?.kind === "control" && req.mode).toBe("advantage");
    expect(req?.kind === "control" && req.options.label).toBe("Goblin — Scimitar attack");
    expect(got).toEqual([]);
    diceExtras.clear();
    control.roll({ altKey: true });
    expect(diceExtras.api.getState().request).toBeNull();
    expect(got).toMatchObject([{ mode: "normal" }]);

    // Intents: the tray's parts on both; none on Alt+click.
    const parts = [{ expression: "1d20+5" }];
    expect(attackIntent("goblin", "a-scim", "toHit", { mode: "normal", parts })).toEqual({
      name: "cbt.attack",
      payload: {
        attackerId: "goblin",
        mode: "normal",
        rolls: "toHit",
        attackId: "a-scim",
        parts,
      },
    });
    const dmg = [{ expression: "2d6+2", type: "slashing" as const }];
    expect(attackIntent("goblin", undefined, "damage", { mode: "normal", parts: dmg })).toEqual({
      name: "cbt.rollDamage",
      payload: { attackerId: "goblin", parts: dmg },
    });
    expect(attackIntent("goblin", undefined, "damage", { mode: "normal" }).payload).toEqual({
      attackerId: "goblin",
    });
  });

  test("FR-CBT-169 Damage stages typed, critical after a natural 20 on the pending to-hit card (the tray's badge); a definition has no combat options", () => {
    const flame: Attack = { ...SCIMITAR, extraDamage: [{ damage: "1d6", type: "fire" }] };
    const crit = attackControlOptions("Goblin", flame, "damage", {
      combatantId: "goblin",
      card: pendingCard(20),
    });
    expect(crit).toMatchObject({
      expressions: ["1d6+2", "1d6"],
      purpose: "damage",
      partTypes: ["slashing", "fire"],
      critExpressions: ["2d6+2", "2d6"],
      crit: true,
    });
    expect(crit.subject).toBeDefined();
    const plain = attackControlOptions("Goblin", flame, "damage", {
      combatantId: "goblin",
      card: pendingCard(12),
    });
    expect(plain.crit).toBeUndefined();
    const definition = attackControlOptions("Goblin", flame, "damage");
    expect(definition).not.toHaveProperty("subject");
    expect(definition).not.toHaveProperty("critExpressions");
    expect(definition.purpose).toBe("damage");
  });
});

describe("FR-CBT-169 staging over the damage-card popup (T9)", () => {
  test("FR-CBT-169 a staged attack puts the open damage-card popup aside (as Later: the draft kept); Alt+click leaves it", () => {
    const dialogs = useCombatDialogs.getState();
    dialogs.openCard("n1");
    dialogs.editDraft("n1", () => ({ damage: { text: "7" } }));
    trayAside({ altKey: true });
    expect(useCombatDialogs.getState().cardId).toBe("n1");
    trayAside({ altKey: false });
    expect(useCombatDialogs.getState().cardId).toBeNull();
    expect(useCombatDialogs.getState().drafts.n1).toMatchObject({ damage: { text: "7" } });
    // A Use roll step (also above the windows) closes too.
    dialogs.openStep({ entryId: "e1", as: "damage", attackerId: null });
    trayAside({});
    expect(useCombatDialogs.getState().step).toBeNull();
    useCombatDialogs.getState().dropDraft("n1");
  });
});
