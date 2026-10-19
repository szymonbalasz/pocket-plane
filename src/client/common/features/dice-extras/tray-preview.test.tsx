// The tray preview (FR-DICEX-48, §6.1 table C; DICEX §13 unit "tray preview per die type"):
// static server render over a fake sync store, as `routing.test.tsx` (no WebGL here, so the
// tray itself shows chips; the 3D mirrors render through `TrayDie`), and the stills' pure seams:
// the highest-face pose and the one-task temporary arena.
import { afterEach, describe, expect, test } from "bun:test";
import { STYLE_LOOK } from "@shared/dice-extras/looks";
import type { DieShape as Shape } from "@shared/dice-extras/throw";
import { emptyStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { geometryOf, labelKindOf, labelText, upFace } from "./dice3d/geometry";
import {
  cancelStill,
  flushStills,
  requestStill,
  type StillStage,
  stillOnce,
  stillPose,
  topValue,
} from "./dice3d/stills";
import { createChunkLoader } from "./lazy3d";
import { effectiveDisplay } from "./settings";
import { diceExtras, type TrayRequest } from "./store";
import { TrayDie, type TrayGroup, TrayPreview } from "./TrayPreview";
import { TrayWindow } from "./TrayWindow";
import { trayExtras } from "./tray-extras";
import {
  chipsOf,
  GROUP_OVER,
  parseStill,
  previewDice,
  removeDie,
  stillParts,
  termsOf,
  trayPreviewMode,
  trayWantsChunk,
} from "./tray-logic";

function render(node: React.ReactNode) {
  const you = { campaignId: "c1", role: "player", playerId: "p1" };
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
  return renderToStaticMarkup(
    <SyncContext.Provider value={sync}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        {node}
      </TooltipProvider>
    </SyncContext.Provider>,
  );
}

const FREE: TrayRequest = { kind: "free", expression: "", mode: "normal", category: "other" };
const group = (expression: string, mode: "normal" | "advantage" = "normal"): TrayGroup => {
  const t = termsOf(expression) ?? [];
  return { chips: chipsOf(t, mode), constant: 0 };
};
const preview = (groups: TrayGroup[], request = FREE) =>
  render(<TrayPreview request={request} groups={groups} mode="normal" onRemove={() => {}} />);
const dieTags = (html: string) =>
  html.match(/<(button|span)[^>]*data-testid="dicex-tray-die"[^>]*>/g) ?? [];

const registered = [...trayExtras];
afterEach(() => {
  diceExtras.clear();
  trayExtras.splice(0, trayExtras.length, ...registered);
});

describe("FR-DICEX-48 tray preview", () => {
  test("FR-DICEX-48 tray preview per die type: one preview die each, highest face up", () => {
    const html = preview([group("1d4+1d6+1d8+1d10+1d12+1d20+1d100")]);
    const dice = dieTags(html);
    expect(dice).toHaveLength(7);
    [4, 6, 8, 10, 12, 20, 100].forEach((f, i) => {
      expect(dice[i]).toContain(`data-faces="${f}"`);
      expect(dice[i]).toContain(`data-value="${f}"`);
    });
    // Chips (no WebGL here): the highest face; d100 = "00" + "0" kites.
    expect(html).toContain('data-testid="dicex-tray-preview" data-mode="chips"');
    expect(html).toMatch(/data-shape="d20" data-faces="20" data-value="20"/);
    expect(html).toMatch(
      /data-shape="d10" data-faces="100" data-value="100"[\s\S]*?>00<[\s\S]*?>0</,
    );
    expect(html).not.toContain(">d12<"); // never the old text badge

    // 3D mirrors: one still cell per mesh die, two for a d100.
    expect(stillParts(100)).toEqual(["d10:tens", "d10:units"]);
    for (const f of [4, 6, 8, 10, 12, 20]) expect(stillParts(f)).toEqual([`d${f}` as Shape]);
    const d100 = render(
      <TrayDie die={{ faces: 100, term: 0, sign: 1 }} render="3d" look={STYLE_LOOK.ivory} />,
    );
    expect(d100.match(/data-still="d10:(tens|units)"/g)).toHaveLength(2);
    expect(d100).not.toContain("dicex-die");
    expect(parseStill("d10:tens")).toEqual({ shape: "d10", part: "tens" });
    expect(parseStill("d3")).toBeNull();
  });

  test("FR-DICEX-48 still poses: each mesh die rests with its highest face up (d100: '00' + '0')", () => {
    const cases: [Shape, "tens" | "units" | undefined, string][] = [
      ["d4", undefined, "4"],
      ["d6", undefined, "6"],
      ["d8", undefined, "8"],
      ["d10", undefined, "10"],
      ["d12", undefined, "12"],
      ["d20", undefined, "20"],
      ["d10", "tens", "00"],
      ["d10", "units", "0"],
    ];
    for (const [shape, part, text] of cases) {
      const kind = labelKindOf(shape, part);
      const { labels, q } = stillPose(shape, kind);
      const up = upFace(geometryOf(shape), labels, q);
      expect(up).toBe(topValue(kind));
      expect(labelText(kind, up)).toBe(text);
    }
  });

  test("FR-DICEX-48 d3 / d1000 → round chip, also in 3D", () => {
    for (const faces of [3, 1000]) {
      expect(stillParts(faces)).toBeNull();
      const html = render(
        <TrayDie die={{ faces, term: 0, sign: 1 }} render="3d" look={STYLE_LOOK.ivory} />,
      );
      expect(html).not.toContain("data-still");
      expect(html).toMatch(
        new RegExp(`data-shape="round" data-faces="${faces}" data-value="${faces}"`),
      );
    }
  });

  test("FR-DICEX-48 13 d6 → one die data-group 13 '×13'; 12 → twelve dice", () => {
    expect(GROUP_OVER).toBe(12);
    const thirteen = dieTags(preview([group("13d6")]));
    expect(thirteen).toHaveLength(1);
    expect(thirteen[0]).toContain('data-group="13"');
    expect(preview([group("13d6")])).toContain("×13");
    const twelve = dieTags(preview([group("12d6")]));
    expect(twelve).toHaveLength(12);
    expect(twelve.join("")).not.toContain("data-group");
    // Per term: 10d6 + 3d8 → two dice ×10, ×3.
    const mixed = dieTags(preview([group("10d6+3d8")]));
    expect(mixed).toHaveLength(2);
    expect(mixed[0]).toContain('data-group="10"');
    expect(mixed[1]).toContain('data-group="3"');
    expect(previewDice(chipsOf(termsOf("2d6+1d8") ?? []), true).map((d) => d.group)).toEqual([
      2,
      undefined,
    ]);
  });

  test("FR-DICEX-48 adv → two d20 tagged", () => {
    const html = preview([group("1d20+5", "advantage")]);
    const dice = dieTags(html);
    expect(dice).toHaveLength(2);
    for (const d of dice) expect(d).toContain('data-tag="adv"');
    // Tagged dice are not removable (the mode makes them).
    expect(html).not.toContain('<button type="button" data-testid="dicex-tray-die"');
  });

  test("FR-DICEX-48 a trayExtras die is drawn as a die and labelled", () => {
    trayExtras.push({
      key: "test-bless",
      order: 10,
      useDice: () => [{ label: "Bless", faces: 4, count: 1, sign: 1, key: "e:bless" }],
    });
    const request: TrayRequest = {
      kind: "control",
      options: { expressions: ["1d20+5"], category: "attack", onRoll() {} },
      mode: "normal",
    };
    const html = render(<TrayPreview request={request} groups={[group("1d20+5")]} mode="normal" />);
    const extra = html.slice(html.indexOf('data-testid="dicex-tray-extra"'));
    expect(extra).toMatch(/data-testid="dicex-tray-extra-die" data-faces="4" data-key="e:bless"/);
    expect(extra).toContain("Bless +1d4");
    expect(extra).toMatch(/data-testid="dicex-tray-die" data-faces="4"/);
    expect(dieTags(html)).toHaveLength(2);
  });

  test("FR-DICEX-48 compose: a die is a button that removes one; adjust: a span", () => {
    const html = preview([group("2d6")]);
    expect(html.match(/<button type="button" data-testid="dicex-tray-die"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Remove one d6"');
    expect(html).toContain("hover:ring-destructive");
    const read = render(<TrayPreview request={FREE} groups={[group("2d6")]} mode="normal" />);
    expect(read).not.toContain("<button");
    // The click: one die of its term.
    expect(removeDie(termsOf("2d6") ?? [], 0)).toEqual(termsOf("1d6") ?? []);
  });

  test("FR-DICEX-48 the tray: compose and adjust show the preview, rolling keeps it dimmed", () => {
    diceExtras.stage({ kind: "free", expression: "2d6+1d8+1", mode: "normal", category: "other" });
    const compose = render(<TrayWindow />);
    expect(compose).toContain('data-testid="dicex-tray-preview"');
    expect(dieTags(compose)).toHaveLength(3);
    expect(compose).toContain(">+1<");
    diceExtras.sent(true);
    const rolling = render(<TrayWindow />);
    expect(rolling).toContain('data-value="rolling"');
    expect(rolling).toContain("opacity-50");
    expect(dieTags(rolling)).toHaveLength(3);
    expect(rolling).not.toContain('<button type="button" data-testid="dicex-tray-die"');
    diceExtras.failed();
  });

  test("FR-DICEX-48 fallback: flat / off / no WebGL / chunk failed → chips; late chunk → 3d", () => {
    expect(trayPreviewMode("flat", "ready", false)).toBe("chips");
    expect(trayPreviewMode("off", "ready", false)).toBe("chips");
    // No WebGL or a failed chunk: the effective display is flat (FR-DICEX-32).
    expect(trayPreviewMode(effectiveDisplay("screen", { threeD: false }), "ready", false)).toBe(
      "chips",
    );
    expect(trayPreviewMode("screen", "failed", false)).toBe("chips");
    expect(trayPreviewMode("screen", "ready", true)).toBe("chips"); // the stills threw
    expect(trayPreviewMode("zone", "loading", false)).toBe("chips");
    expect(trayPreviewMode("zone", "ready", false)).toBe("3d"); // the chunk arrived later
    expect(trayPreviewMode("screen", "ready", false)).toBe("3d");
  });

  test("FR-DICEX-48 no 3D import for the tray in flat / off", () => {
    let imports = 0;
    const loader = createChunkLoader(() => {
      imports++;
      return new Promise<never>(() => {});
    });
    trayWantsChunk("flat", loader);
    trayWantsChunk("off", loader);
    expect(imports).toBe(0);
    expect(loader.state()).toBe("idle");
    trayWantsChunk("screen", loader);
    expect(imports).toBe(1);
  });
});

/** A fake stage: records the temporary arena's steps and counts rAF callbacks requested. */
function fakeStage(looping = false) {
  const stage: StillStage & { arenas: Set<number>; log: string[] } = {
    looping,
    lost: false,
    stills: new Map(),
    arenas: new Set(),
    log: [],
  };
  let next = 0;
  const redraw = (key: object, tag: string) =>
    requestStill(stage, key, () =>
      stillOnce({
        add: () => {
          const a = next++;
          stage.arenas.add(a);
          stage.log.push(`add ${tag}`);
          return a;
        },
        draw: () => stage.log.push(`draw ${tag}`),
        copy: () => stage.log.push(`copy ${tag} arenas=${stage.arenas.size}`),
        remove: (a) => {
          stage.arenas.delete(a);
          stage.log.push(`remove ${tag}`);
        },
        restore: () => stage.log.push(`restore arenas=${stage.arenas.size}`),
      }),
    );
  return { stage, redraw };
}

describe("FR-DICEX-48 stills on the one canvas", () => {
  test("FR-DICEX-48 each redraw adds and removes its temporary arena in one task", () => {
    const { stage, redraw } = fakeStage();
    const key = {};
    redraw(key, "a");
    // Synchronous: by the time the call returns, the arena is gone (no lasting arena).
    expect(stage.log).toEqual([
      "add a",
      "draw a",
      "copy a arenas=1",
      "remove a",
      "restore arenas=0",
    ]);
    expect(stage.arenas.size).toBe(0);
    expect(stage.stills.size).toBe(0);
  });

  test("FR-DICEX-48 a redraw during a running throw is copied on the loop's next frame", () => {
    const { stage, redraw } = fakeStage(true);
    const key = {};
    redraw(key, "a");
    redraw(key, "b"); // a newer redraw of the same tray replaces the waiting one
    expect(stage.log).toEqual([]);
    flushStills(stage); // the loop's frame
    expect(stage.log).toEqual([
      "add b",
      "draw b",
      "copy b arenas=1",
      "remove b",
      "restore arenas=0",
    ]);
    expect(stage.arenas.size).toBe(0);
    // Unmounted before the frame: nothing runs.
    redraw(key, "c");
    cancelStill(stage, key);
    flushStills(stage);
    expect(stage.log.some((l) => l.includes(" c"))).toBe(false);
  });

  test("FR-DICEX-48 idle → 0 rAF callbacks; a lost context throws (the tray shows chips)", () => {
    const g = globalThis as { requestAnimationFrame?: (cb: () => void) => number };
    const before = g.requestAnimationFrame;
    let frames = 0;
    g.requestAnimationFrame = () => ++frames;
    try {
      const { stage, redraw } = fakeStage();
      redraw({}, "a");
      redraw({}, "b");
      expect(frames).toBe(0);
      stage.lost = true;
      expect(() => redraw({}, "c")).toThrow();
    } finally {
      g.requestAnimationFrame = before;
    }
  });
});
