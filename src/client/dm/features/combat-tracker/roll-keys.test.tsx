// FR-DICEX-06 on the DM Initiative's menu-driven roll anchors (attack, check / save, death save):
// the menu item's pointer-down keys reach `control.roll`, so Alt stages instead of rolling. Static
// server render over a fake sync store, as `dice-extras/routing.test.tsx`.
import { afterEach, expect, test } from "bun:test";
import type { CombatantView } from "@shared/combat-tracker/schemas";
import { emptyStore } from "@shared/protocol/store";
import { diceExtras } from "@ui/features/dice-extras/store";
import {
  type RollControl,
  type RollRequest,
  useRollControl,
} from "@ui/features/dice-roll-log/roll-control";
import { SyncContext, type SyncState } from "@ui/sync/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { useDeathSaveRoll } from "../combat-extras/row";
import { rollKeys } from "./roll-keys";

const sent: { name: string; input: unknown }[] = [];

function capture(useControl: () => RollControl): RollControl {
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: { ...emptyStore(), you: { campaignId: "c1", role: "dm", playerId: null } },
        notLiveSince: null,
        everLive: true,
        connection: {
          sendIntent: (name: string, input: unknown) => {
            sent.push({ name, input });
            return Promise.resolve({});
          },
        },
      }) as unknown as SyncState,
  );
  let control: RollControl | null = null;
  function Probe() {
    control = useControl();
    return null;
  }
  renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <Probe />
    </SyncContext.Provider>,
  );
  if (!control) throw new Error("no control");
  return control;
}

/** The pointer-down a menu item sees (modifier fields only). */
const pointer = (keys: { shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean }) => ({
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  ...keys,
});

afterEach(() => {
  diceExtras.failed();
  diceExtras.clear();
  sent.length = 0;
});

test("FR-DICEX-06 Alt+click stages from Initiative and death saves", () => {
  expect(rollKeys(pointer({ altKey: true, shiftKey: true }))).toEqual({
    shiftKey: true,
    ctrlKey: false,
    altKey: true,
  });

  // Initiative check / save / attack anchors: the picked item's keys reach `control.roll`.
  const rolls: RollRequest[] = [];
  const check = capture(() =>
    useRollControl({
      expressions: ["1d20+2"],
      category: "ability-check",
      label: "Goblin — Dexterity check",
      onRoll: (r) => rolls.push(r),
    }),
  );
  check.roll(rollKeys(pointer({ altKey: true, ctrlKey: true })));
  let req = diceExtras.api.getState().request;
  expect(rolls).toEqual([]);
  expect(req?.kind).toBe("control");
  if (req?.kind !== "control") return;
  expect(req.options.label).toBe("Goblin — Dexterity check");
  expect(req.mode).toBe("disadvantage");
  diceExtras.clear();

  // DM death-save menu item: Alt stages the row's death save, nothing is sent.
  const c = { id: "cb1", kind: "pc", name: "Mira", entityId: "mira" } as CombatantView;
  const death = capture(() => useDeathSaveRoll(c));
  death.roll(rollKeys(pointer({ altKey: true })));
  req = diceExtras.api.getState().request;
  expect(sent).toEqual([]);
  expect(req?.kind).toBe("control");
  if (req?.kind !== "control") return;
  expect(req.options.label).toBe("Mira — Death save");
  expect(req.mode).toBe("normal");

  // Without Alt the same item still rolls at once.
  diceExtras.clear();
  death.roll(rollKeys(pointer({ shiftKey: true })));
  expect(diceExtras.api.getState().request).toBeNull();
  expect(sent).toEqual([
    { name: "cbtx.rollDeathSave", input: { characterId: "mira", mode: "advantage" } },
  ]);
});
