// The Alt hint on every stageable roll surface (FR-DICEX-51, §6.1 table G; DICEX §13 unit "Alt
// hint on each roll button"). Static server render over a fake sync store, as `routing.test.tsx`:
// a closed Tooltip renders nothing, so `RollButton`'s tooltip is read from `rollButtonTip` (what
// it passes the Tooltip) and the surfaces' wiring from their source (which `RollButton`s are
// invisible anchors, where the menus draw the line); the walkthrough reads the open tooltips.
import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { emptyStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { ROLL_BAR_HINT, rollBarStage } from "../dice-roll-log/GameLog";
import {
  type RollControl,
  type RollControlOptions,
  rollButtonTip,
  STAGE_HINT,
  StageHint,
  useRollControl,
} from "../dice-roll-log/roll-control";
import { NO_PREVIEW } from "../effect-modifiers/roll-preview";
import { diceExtras, stageTray } from "./store";
import { TrayWindow } from "./TrayWindow";

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

const hints = (html: string) => html.match(/data-testid="dicex-stage-hint"/g)?.length ?? 0;
const tip = (preview: string, hint?: string) =>
  render(rollButtonTip({ preview: { ...NO_PREVIEW, text: preview } }, hint));

const CLIENT = join(import.meta.dir, "../../..");
const source = (path: string) => readFileSync(join(CLIENT, path), "utf8");

/** `<RollButton …>` opening tags of `src`: the attribute text, `{…}` kept. */
function rollButtons(src: string): string[] {
  const out: string[] = [];
  const re = /<RollButton\b/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let depth = 0;
    let i = m.index + m[0].length;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0 && src[i - 1] !== "=") break;
    }
    out.push(src.slice(m.index, i + 1));
  }
  return out;
}
const count = (src: string, s: string) => src.split(s).length - 1;
function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(p);
    return e.name.endsWith(".tsx") ? [p] : [];
  });
}

afterEach(() => {
  diceExtras.failed();
  diceExtras.clear();
});

describe("FR-DICEX-51 Alt hint on every stageable roll surface", () => {
  test("FR-DICEX-51 Alt hint on each roll button: RollButton's tooltip carries it exactly once", () => {
    expect(STAGE_HINT).toBe("Alt: adjust in tray");
    // No caller text (death saves, concentration): the hint alone.
    const bare = tip("");
    expect(hints(bare)).toBe(1);
    expect(bare).toBe('<span data-testid="dicex-stage-hint">Alt: adjust in tray</span>');
    // Caller text (sheet, roll bar, Initiative row): its text, then the hint.
    const sheet = tip("", "Shift: advantage · Ctrl: disadvantage");
    expect(hints(sheet)).toBe(1);
    expect(sheet).toStartWith("Shift: advantage · Ctrl: disadvantage · <span");
    // The parts the roll picks up lead (FR-MOD-27), the hint still once.
    const parts = tip("Bless +1d4", "Shift: advantage");
    expect(hints(parts)).toBe(1);
    expect(parts).toStartWith("Bless +1d4 · Shift: advantage · <span");
    expect(hints(tip("Bless +1d4"))).toBe(1);
    // The menus' muted line.
    expect(hints(render(<StageHint line />))).toBe(1);
  });

  test("FR-DICEX-51 Alt hint on each roll button: table G surfaces, once each, none on anchors", () => {
    // Every RollButton in the client: an invisible anchor (`aria-hidden`) draws no tooltip
    // (`hint={false}`; its menu shows the line); every visible one draws its own, and no
    // caller wraps it in a second Tooltip that would repeat the text.
    const files = [
      "common/features/character-sheet/CharacterSheet.tsx",
      "common/features/combat-extras/sheet-sections.tsx",
      "common/features/combat-extras/concentration.tsx",
      "common/features/dice-roll-log/GameLog.tsx",
      "dm/features/combat-tracker/initiative-window.tsx",
      "dm/features/combat-extras/row.tsx",
    ];
    for (const f of files) {
      for (const tag of rollButtons(source(f))) {
        const anchor = /\saria-hidden\b/.test(tag);
        expect({ f, anchor, off: tag.includes("hint={false}") }).toEqual({
          f,
          anchor,
          off: anchor,
        });
      }
    }
    // Sheet rolls: the sheet's text through `hint`, no Tooltip of its own (it dropped its copy).
    const sheet = source("common/features/character-sheet/CharacterSheet.tsx");
    expect(rollButtons(sheet).map((t) => /hint=\{/.test(t))).toEqual([true, true]);
    expect(sheet).not.toContain("<Tooltip");
    // Death save (sheet section) and the concentration roll host: RollButton's own tooltip.
    for (const f of [
      "common/features/combat-extras/sheet-sections.tsx",
      "common/features/combat-extras/concentration.tsx",
    ]) {
      expect(rollButtons(source(f))).toHaveLength(1);
    }
    // Roll bar Roll: "Shift: advantage · Ctrl: disadvantage · Alt: adjust in tray".
    const log = source("common/features/dice-roll-log/GameLog.tsx");
    expect(rollButtons(log)).toEqual([expect.stringContaining("hint={ROLL_BAR_HINT}")]);
    expect(ROLL_BAR_HINT).toBe("Shift: advantage · Ctrl: disadvantage");
    // Initiative: row initiative through `hint`; Attack ▸ trigger's tooltip; one line in the
    // Check ▸ / Save ▸ submenu (one component renders both); three invisible anchors.
    const init = source("dm/features/combat-tracker/initiative-window.tsx");
    const initButtons = rollButtons(init);
    expect(initButtons.filter((t) => t.includes('data-testid="cbt-init-row-roll"'))).toEqual([
      expect.stringContaining("hint={`Roll initiative: d20"),
    ]);
    expect(initButtons.filter((t) => t.includes("hint={false}"))).toHaveLength(3);
    expect(init).toContain("Attack ▸ · Shift: advantage · Ctrl: disadvantage · <StageHint />");
    expect(count(init, "<StageHint")).toBe(2);
    expect(count(init, "<StageHint line />")).toBe(1);
    expect(init).toMatch(/function AbilityMenu[\s\S]*<StageHint line \/>[\s\S]*function /);
    // DM combat row death save item: its line in the item, the anchor without a tooltip.
    const row = source("dm/features/combat-extras/row.tsx");
    expect(count(row, "<StageHint")).toBe(1);
    expect(row).toMatch(/cbtx-init-row-death-roll"[\s\S]{0,700}<StageHint \/>/);
    // Not stageable: Roll monsters (a plain Button), the notification's "Roll save" (an
    // action, not a RollButton) — no hint.
    expect(init).toMatch(/<Button\s[^>]*data-testid="cbt-init-roll-monsters"/);
    expect(init).not.toMatch(/cbt-init-roll-monsters[\s\S]{0,600}StageHint/);
    // Nothing else draws the line (the notification views included).
    const drawn = tsxFiles(CLIENT)
      .filter((f) => !f.endsWith(".test.tsx") && readFileSync(f, "utf8").includes("<StageHint"))
      .map((f) => relative(CLIENT, f).replaceAll("\\", "/"))
      .sort();
    expect(drawn).toEqual([
      "common/features/dice-roll-log/roll-control.tsx",
      "dm/features/combat-extras/row.tsx",
      "dm/features/combat-tracker/initiative-window.tsx",
    ]);
  });

  test("FR-DICEX-51 Alt+click on a roll button stages `adjust` (no roll)", () => {
    const rolled: unknown[] = [];
    const control = captureControl({
      expressions: ["1d20"],
      category: "saving-throw",
      label: "Mira — Death save",
      onRoll: (r) => rolled.push(r),
    });
    control.roll({ altKey: true });
    expect(rolled).toEqual([]);
    expect(diceExtras.api.getState().request).toMatchObject({ kind: "control" });
    const html = render(<TrayWindow />);
    expect(html).toContain('data-testid="dicex-tray-state" data-value="adjust"');
    expect(html).toContain("Mira — Death save");
  });

  test("FR-DICEX-51 roll bar: Alt+click Roll stages its expression `free` (OQ-DICEX-45 A)", () => {
    const bar = {
      expression: " 2d6 ",
      mode: "normal" as const,
      label: "",
      category: "other" as const,
    };
    expect(rollBarStage(bar, { altKey: true })).toEqual({
      kind: "free",
      expression: "2d6",
      mode: "normal",
      category: "other",
    });
    // Shift / Ctrl pick the mode as a roll would; the tray Button (no keys) keeps the toggle.
    expect(rollBarStage(bar, { altKey: true, shiftKey: true }).mode).toBe("advantage");
    expect(rollBarStage({ ...bar, mode: "disadvantage", label: " Ford " })).toMatchObject({
      mode: "disadvantage",
      label: "Ford",
    });
    stageTray(rollBarStage(bar, { altKey: true }));
    const html = render(<TrayWindow />);
    expect(html).toContain('data-testid="dicex-tray-state" data-value="compose"');
    expect(html.match(/data-testid="dicex-tray-die"[^>]*data-faces="6"/g)).toHaveLength(2);
  });
});
