// Roll-control routing and the tray (DICEX §13 unit, DOM tests as `sheet-render.test.tsx`): static
// server render over a fake sync store; handlers called directly on the captured control.
import { afterEach, describe, expect, test } from "bun:test";
import { prepareExpression } from "@shared/dice-roll-log/grammar";
import type { RollMode } from "@shared/dice-roll-log/schemas";
import { emptyStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import {
  ManualForm,
  type RollControl,
  type RollControlOptions,
  type RollRequest,
  useRollControl,
} from "../dice-roll-log/roll-control";
import { NO_PREVIEW } from "../effect-modifiers/roll-preview";
import { actorFor, DiceText, notationRequest } from "./DiceText";
import { diceExtras, type TrayRequest } from "./store";
import { TrayWindow, trayControlOptions, trayState } from "./TrayWindow";
import { trayExtras } from "./tray-extras";

const sent: { name: string; input: unknown }[] = [];

function render(node: React.ReactNode, role: "dm" | "player" = "player") {
  const you = { campaignId: "c1", role, playerId: role === "dm" ? null : "p1" };
  const entities = {
    mira: { id: "mira", kind: "character", name: "Mira", ownerPlayerId: "p1" },
  };
  const sync = createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: { ...emptyStore(), you, records: { entity: entities } },
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
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        {node}
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

/** Renders a component using `useRollControl(options)` and returns the control. */
function captureControl(options: RollControlOptions): RollControl {
  let control: RollControl | null = null;
  function Probe() {
    control = useRollControl(options);
    return null;
  }
  render(<Probe />);
  if (!control) throw new Error("no control");
  return control;
}

const stage = (request: TrayRequest) => diceExtras.stage(request);
const registered = [...trayExtras];

afterEach(() => {
  diceExtras.failed(); // stop any pending timer
  diceExtras.clear();
  trayExtras.splice(0, trayExtras.length, ...registered);
  sent.length = 0;
});

describe("FR-DICEX-06 roll buttons: click rolls at once, Alt+click stages", () => {
  test("FR-DICEX-06 click → onRoll at once + pending throw (FR-DICEX-09)", () => {
    const rolls: RollRequest[] = [];
    const control = captureControl({
      expressions: ["1d20+5"],
      category: "skill-check",
      label: "Mira — Athletics check",
      onRoll: (r) => rolls.push(r),
    });
    control.roll({ shiftKey: true });
    expect(rolls).toEqual([{ mode: "advantage" }]);
    expect(diceExtras.api.getState().pending).toBe(true);
    expect(diceExtras.api.getState().request).toBeNull();
  });

  test("FR-DICEX-06 Alt+click → tray `adjust` with the options verbatim, nothing rolled", () => {
    const rolls: RollRequest[] = [];
    const options = {
      expressions: ["1d20+5"],
      category: "skill-check" as const,
      label: "Mira — Athletics check",
      onRoll: (r: RollRequest) => rolls.push(r),
      // MOD R14: the preview's input rides in the options.
      subject: {
        creature: { characterId: "mira" },
        roll: "check" as const,
        ability: "str" as const,
      },
    };
    const control = captureControl(options);
    control.roll({ altKey: true, shiftKey: true });
    const req = diceExtras.api.getState().request;
    expect(rolls).toEqual([]);
    expect(req?.kind).toBe("control");
    if (req?.kind !== "control") return;
    expect(req.options).toBe(options); // verbatim: the same object, `subject` included
    expect(req.mode).toBe("advantage");
    expect(diceExtras.api.getState().pending).toBe(false);
  });
});

describe("FR-DICEX-05 / -08 adjust rolls through the caller's onRoll", () => {
  test("FR-DICEX-08 a, d: Roll → the caller's onRoll gets the same RollRequest (previewMode, manualParts untouched); options keep unknown fields", () => {
    const got: RollRequest[] = [];
    const options = {
      expressions: ["1d20+5"],
      category: "skill-check" as const,
      onRoll: (r: RollRequest) => got.push(r),
      subject: { creature: { characterId: "mira" }, roll: "check" as const },
    };
    const tray = trayControlOptions(
      { kind: "control", options, mode: "normal" },
      "",
      "advantage",
      () => {},
    );
    expect((tray as unknown as typeof options).subject).toBe(options.subject);
    expect(tray.mode).toBe("advantage");
    expect(tray.expressions).toBe(options.expressions);
    const request: RollRequest = {
      mode: "advantage",
      previewMode: "advantage",
      manual: [{ diceTotal: 14 }],
      manualParts: [[{ key: "e:fx-bless", entry: { diceTotal: 3 } }]],
    };
    tray.onRoll(request);
    expect(got).toHaveLength(1);
    expect(got[0]).toBe(request);
    expect(diceExtras.api.getState().rolling).toBe(true); // FR-DICEX-09 `rolling`
  });

  test("FR-DICEX-04 free: the tray's control rolls the composed expression with the request's category", () => {
    const calls: RollRequest[] = [];
    const tray = trayControlOptions(
      {
        kind: "free",
        expression: "1d12+5",
        mode: "normal",
        category: "other",
        label: "Notation test",
      },
      "1d12+1d6+6",
      "normal",
      (r) => calls.push(r),
    );
    expect(tray.expressions).toEqual(["1d12+1d6+6"]);
    expect(tray.category).toBe("other");
    expect(tray.label).toBe("Notation test");
    tray.onRoll({ mode: "normal" });
    expect(calls).toEqual([{ mode: "normal" }]);
  });

  test("no request → a control that rolls nothing", () => {
    expect(trayControlOptions(null, "", "normal", () => {}).expressions).toEqual([]);
  });
});

describe("FR-DICEX-03 tray states", () => {
  test("idle → compose / adjust → manual → rolling → result", () => {
    const free: TrayRequest = {
      kind: "free",
      expression: "1d6",
      mode: "normal",
      category: "other",
    };
    const control: TrayRequest = {
      kind: "control",
      options: { expressions: ["1d20"], category: "other", onRoll() {} },
      mode: "normal",
    };
    const s = (o: Partial<Parameters<typeof trayState>[0]>) =>
      trayState({ request: null, rolling: false, result: null, manual: false, ...o });
    expect(s({})).toBe("idle");
    expect(s({ request: free })).toBe("compose");
    expect(s({ request: control })).toBe("adjust");
    expect(s({ request: free, manual: true })).toBe("manual");
    expect(s({ request: free, rolling: true })).toBe("rolling");
    expect(s({ request: free, result: [] })).toBe("result");
  });

  test("idle tray: the hint, the palette, no Roll target", () => {
    const html = render(<TrayWindow />);
    expect(html).toContain('data-testid="dicex-tray-state" data-value="idle"');
    expect(html).toContain("Click dice in any text, Alt+click a roll button, or pick dice below");
    for (const f of [4, 6, 8, 10, 12, 20, 100]) {
      expect(html).toContain(`data-testid="dicex-tray-palette" data-value="${f}"`);
    }
  });

  test("FR-DICEX-04 compose (notation click): one d12 chip, constant 5, actor Mira, label", () => {
    stage({
      kind: "free",
      expression: "1d12+5",
      mode: "normal",
      category: "other",
      label: "Notation test",
      actor: { entityId: "mira" },
    });
    const html = render(<TrayWindow />);
    expect(html).toContain('data-value="compose"');
    expect(html.match(/data-testid="dicex-tray-die"/g)).toHaveLength(1);
    expect(html).toContain('data-faces="12" data-term="0"');
    expect(html).toMatch(/data-testid="dicex-tray-constant"[^>]*value="5"/);
    expect(html).toMatch(/data-testid="dicex-tray-expression"[^>]*value="1d12\+5"/);
    expect(html).toContain("Mira — Notation test");
  });

  test("FR-DICEX-08 e adjust: mode adv → two d20 chips tagged adv; constant read-only", () => {
    stage({
      kind: "control",
      options: {
        expressions: ["1d20+5"],
        category: "skill-check",
        label: "Mira — Athletics check",
        onRoll() {},
      },
      mode: "advantage",
    });
    const html = render(<TrayWindow />);
    expect(html).toContain('data-value="adjust"');
    expect(html).toContain("Mira — Athletics check");
    expect(html.match(/data-testid="dicex-tray-die"[^>]*data-tag="adv"/g)).toHaveLength(2);
    expect(html).not.toContain('data-testid="dicex-tray-expression"');
    expect(html).not.toContain('<button type="button" data-testid="dicex-tray-die"');
  });

  test("FR-DICEX-08 e a request whose previewMode is dis → two d20 chips tagged dis", () => {
    stage({
      kind: "control",
      options: { expressions: ["1d20+3"], category: "saving-throw", onRoll() {} },
      mode: "normal",
      previewMode: "disadvantage",
    });
    const html = render(<TrayWindow />);
    expect(html.match(/data-testid="dicex-tray-die"[^>]*data-tag="dis"/g)).toHaveLength(2);
  });

  test("FR-DICEX-05 crit: true → the crit expressions' dice", () => {
    stage({
      kind: "control",
      options: {
        expressions: ["1d8+3"],
        critExpressions: ["2d8+3"],
        crit: true,
        category: "damage",
        onRoll() {},
      },
      mode: "normal",
    });
    const html = render(<TrayWindow />);
    expect(html.match(/data-faces="8"/g)).toHaveLength(2);
  });

  test("FR-DICEX-08 b a test trayExtras entry shows its labelled chips beside the base dice", () => {
    const modes: RollMode[] = [];
    trayExtras.push({
      key: "test-bless",
      order: 10,
      useDice: (_req, mode) => {
        modes.push(mode);
        return [{ label: "Bless", faces: 4, count: 1, sign: 1 }];
      },
    });
    stage({
      kind: "control",
      options: { expressions: ["1d20+5"], category: "attack", onRoll() {} },
      mode: "advantage",
    });
    const html = render(<TrayWindow />);
    expect(html).toContain('data-testid="dicex-tray-extra" data-value="test-bless"');
    expect(html).toContain("Bless +1d4");
    expect(modes).toEqual(["advantage"]);
  });

  test("DM: the eye toggle; player: none", () => {
    stage({ kind: "free", expression: "1d20", mode: "normal", category: "other" });
    expect(render(<TrayWindow />, "dm")).toContain('data-testid="dicex-tray-public"');
    expect(render(<TrayWindow />, "player")).not.toContain('data-testid="dicex-tray-public"');
  });
});

describe("FR-DICEX-07 physical dice: the same ManualForm in popover and tray", () => {
  test("ManualForm (exported for the tray host) renders the dice-manual-* inputs", () => {
    const control = {
      manual: { mode: "normal" },
      options: { expressions: ["2d6-1"], category: "other", onRoll() {} },
      preview: NO_PREVIEW,
    } as unknown as RollControl;
    const html = render(<ManualForm control={control} />);
    expect(html).toContain('data-testid="dice-manual-total"');
    expect(html.match(/data-testid="dice-manual-die"/g)).toHaveLength(2);
    expect(html).toContain('data-testid="dice-manual-submit"');
    expect(html).toContain('data-testid="dice-manual-auto"');
  });
});

describe("FR-DICEX-29 DiceText", () => {
  test("links with the canonical expression; the rest stays text, never HTML", () => {
    const html = render(
      <DiceText
        text={"Greataxe 1d12 + 5 <b>slashing</b>. Not dice: 51d6."}
        context={{ label: "Notation test" }}
      />,
    );
    expect(html).toContain('data-testid="dicex-notation" data-value="1d12+5"');
    expect(html).toContain(">1d12 + 5</button>");
    expect(html).toContain("&lt;b&gt;slashing&lt;/b&gt;");
    expect(html.match(/dicex-notation/g)).toHaveLength(1);
  });

  test("a click stages `free`: label, category (default other), Shift / Ctrl only with a 1d20", () => {
    const ctx = { label: "Notation test" };
    expect(notationRequest("1d12+5", ctx, {}, { entityId: "mira" })).toEqual({
      kind: "free",
      expression: "1d12+5",
      mode: "normal",
      category: "other",
      label: "Notation test",
      actor: { entityId: "mira" },
    });
    expect(notationRequest("1d20+3", ctx, { shiftKey: true }, undefined).mode).toBe("advantage");
    expect(notationRequest("1d20+3", ctx, { ctrlKey: true }, undefined).mode).toBe("disadvantage");
    expect(notationRequest("2d6-1", ctx, { shiftKey: true }, undefined).mode).toBe("normal");
    expect(
      notationRequest("1d6", { category: "damage", label: "x".repeat(80) }, {}, undefined),
    ).toMatchObject({
      category: "damage",
      label: "x".repeat(60),
    });
  });

  test("FR-DICEX-31 notation always rolls dice.roll with the tray's category", () => {
    stage(notationRequest("1d12+5", { label: "Notation test" }, {}, undefined));
    const req = diceExtras.api.getState().request;
    expect(req?.kind).toBe("free");
  });

  test("actor = the creature if the viewer may roll as it (FR-DICE-10), else the default", () => {
    const entities = [
      { id: "mira", kind: "character" as const, ownerPlayerId: "p1" },
      { id: "gob", kind: "monster" as const, ownerPlayerId: null },
    ];
    const p1 = { role: "player" as const, playerId: "p1" };
    const p2 = { role: "player" as const, playerId: "p2" };
    const dm = { role: "dm" as const, playerId: null };
    expect(actorFor({ entityId: "mira" }, p1, entities)).toEqual({ entityId: "mira" });
    expect(actorFor({ entityId: "mira" }, p2, entities)).toBeUndefined();
    expect(actorFor({ entityId: "gob" }, p1, entities)).toBeUndefined();
    expect(actorFor({ entityId: "gob" }, dm, entities)).toEqual({ entityId: "gob" });
    expect(actorFor(null, dm, entities)).toBeUndefined();
  });
});

describe("FR-DICEX-05 tray mode", () => {
  test("FR-DICEX-05 mode resets after a roll", () => {
    const req: TrayRequest = {
      kind: "free",
      expression: "1d20",
      mode: "normal",
      category: "other",
    };
    diceExtras.stage(req);
    diceExtras.setMode("advantage");
    const rolls: RollMode[] = [];
    trayControlOptions(req, "1d20", diceExtras.api.getState().mode, (r) => {
      rolls.push(r.mode);
    }).onRoll({ mode: "advantage" });
    expect(rolls).toEqual(["advantage"]);
    // Adv doesn't stick: the next tray roll (a 50d6) is a normal roll the server accepts.
    const { mode } = diceExtras.api.getState();
    expect(mode).toBe("normal");
    expect(prepareExpression("50d6", mode).ok).toBe(true);
    expect(trayControlOptions(req, "50d6", mode, () => {}).mode).toBe("normal");
    diceExtras.failed();
  });

  test("FR-DICEX-05 a new stage resets the mode to the request's (normal unless preselected)", () => {
    diceExtras.stage({ kind: "free", expression: "1d20", mode: "normal", category: "other" });
    diceExtras.setMode("disadvantage");
    diceExtras.stage({ kind: "free", expression: "2d6", mode: "normal", category: "other" });
    expect(diceExtras.api.getState().mode).toBe("normal");
    diceExtras.stage({ kind: "free", expression: "1d20+3", mode: "advantage", category: "other" });
    expect(diceExtras.api.getState().mode).toBe("advantage");
    diceExtras.clear();
  });
});
