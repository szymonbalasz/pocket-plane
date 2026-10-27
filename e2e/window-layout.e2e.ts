// e2e-bundle: windows-s5
// Thin sprint-5 window layout flows (SHELL §13 sprint 5 E2E, track W slice W1): launcher opens
// never stack and keep off PC tokens (FR-SHELL-45–47; sprint 7: auto-minimise first, FR-SHELL-77); the players' sheet, Initiative and Game log
// stay apart after the DM's Start at 1280×800 (FR-SHELL-50); the wide Game log keeps its roll bar
// compact (FR-DICE-39). Rank, keep-outs and default layouts in detail: bun test (placement,
// manager, windows tests). The AoE panel vs Initiative check waits for the tool-bar push (W3).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes } from "./support/konva";
import { openWindow, shellWindow } from "./support/shell";

interface Box {
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

/** Every shown `ui-window`'s rect (minimised ones are hidden). */
const shownWindows = (page: Page) =>
  page.locator('[data-testid="ui-window"][data-state="open"]').evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return {
        kind: e.getAttribute("data-record-id") ?? "",
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
      };
    }),
  );

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

function pairwiseDisjoint(boxes: Box[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i] as Box;
      const b = boxes[j] as Box;
      if (overlaps(a, b)) out.push(`${a.kind} × ${b.kind}`);
    }
  return out;
}

/** FR-SHELL-57: a PC footprint's margin; placement's edge gap and the bottom clearance (K5: 12). */
const PC_MARGIN = 4;
const EDGE_GAP = 12;
const RAIL_CLEAR = 68;
const TOP_BAR_H = 48;
const LAUNCHER_CLEAR = 12;

/**
 * A spot (8-px grid over the usable area right of the rail) for `win`'s size that is clear of
 * every other shown window (12 px gap) and of every grown PC footprint; null when none exists.
 */
function pcFreeSpot(
  win: Box,
  windows: readonly Box[],
  pcs: readonly Box[],
  vp: { width: number; height: number },
): string | null {
  const grow = (o: Box) => ({
    ...o,
    x: o.x - EDGE_GAP,
    y: o.y - EDGE_GAP,
    w: o.w + 2 * EDGE_GAP,
    h: o.h + 2 * EDGE_GAP,
  });
  const others = windows.filter((o) => o.kind !== win.kind).map(grow);
  const right = vp.width - EDGE_GAP - win.w;
  const bottom = vp.height - LAUNCHER_CLEAR - win.h;
  for (let y = TOP_BAR_H + EDGE_GAP; y <= bottom; y += 8) {
    for (let x = RAIL_CLEAR; x <= right; x += 8) {
      const r = { kind: win.kind, x, y, w: win.w, h: win.h };
      if (others.some((o) => overlaps(r, o)) || pcs.some((p) => overlaps(r, p))) continue;
      return `${x},${y}`;
    }
  }
  return null;
}

async function resetLayout(page: Page) {
  await page.getByTestId("ui-launcher-menu").click();
  await page.getByTestId("ui-launcher-reset").click();
}

test("FR-SHELL-45 FR-SHELL-47 DM at 1440×900: Compendium, Party, Encounters from the launcher → the shown windows (Game log, Initiative included) are pairwise disjoint; one over a PC only when no spot clear of windows and PCs exists (#292)", async ({
  browser,
}) => {
  const { secret, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  await expect(shellWindow(dm, "cbt.initiative")).toBeVisible();
  await expect(shellWindow(dm, "dice.log")).toBeVisible();
  // View Goblin Ambush (the PCs' tokens), then close Scenes again.
  const ambush = recordId("battlemap", "scene");
  const scenes = await openWindow(dm, "map.scenes");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-loading", "false");
  await scenes.getByTestId("ui-window-close").click();
  // Placement scores the tokens drawn now: wait until the scene's fit has settled.
  const at = async () => JSON.stringify((await konvaNodes(dm, "map-token")).map((t) => [t.x, t.y]));
  let last = "";
  await expect
    .poll(
      async () => {
        const now = await at();
        const stable = now === last && now !== "[]";
        last = now;
        return stable;
      },
      { intervals: [300] },
    )
    .toBe(true);
  await expect(scenes).toHaveCount(0);
  // FR-DICE-38: the wide log at 1440×900.
  const log = await shellWindow(dm, "dice.log").boundingBox();
  expect(log && { x: log.x, y: log.y, w: log.width, h: log.height }).toEqual({
    x: 68,
    y: 608,
    w: 1150,
    h: 280,
  });

  for (const kind of ["cmp.compendium", "party.board", "cbt.encounters"]) {
    await openWindow(dm, kind);
    const boxes = await shownWindows(dm);
    expect(pairwiseDisjoint(boxes)).toEqual([]);
  }
  // The third, Encounters, needs its useful 440 × 412 (FR-SHELL-79): Compendium, the least
  // recently used, is auto-minimised for it first (FR-SHELL-77, -78); Party too when that's not
  // enough. Each carries the newcomer it made room for (FR-SHELL-88).
  await expect(shellWindow(dm, "cmp.compendium")).toHaveAttribute("data-state", "minimised");
  await expect(shellWindow(dm, "cmp.compendium")).toHaveAttribute("data-auto-minimised", "true");
  await expect(shellWindow(dm, "cmp.compendium")).toHaveAttribute(
    "data-auto-minimised-for",
    /^(party\.board|cbt\.encounters)$/,
  );
  await expect(
    dm.locator('[data-testid="ui-launcher-button"][data-record-id="cmp.compendium"]'),
  ).toHaveAttribute("data-state", "minimised");

  const boxes = await shownWindows(dm);
  const shown = boxes.map((b) => b.kind);
  for (const k of ["cbt.encounters:main", "cbt.initiative:main", "dice.log:main"]) {
    expect(shown).toContain(k);
  }
  if (!shown.includes("party.board:main")) {
    await expect(shellWindow(dm, "party.board")).toHaveAttribute(
      "data-auto-minimised-for",
      "cbt.encounters",
    );
  }
  // #256 (OQ-SHELL-32 C): the DM has no corner keep-out; its toast box (top-centre) is soft, and
  // the wide Game log runs under the bottom-right as §7 lays it out.
  const pcs = [
    recordId("battlemap", "token", 0),
    recordId("thorn-battlemap", "token"),
    recordId("char-brakka", "token"),
  ];
  await expect.poll(async () => (await konvaNodes(dm, "map-token")).length).toBeGreaterThan(0);
  const all = await konvaNodes(dm, "map-token");
  const tokens = all.filter((t) => pcs.includes(t.id));
  expect(
    tokens.length,
    JSON.stringify({ pcs, drawn: all.map((t) => [t.id, t.text]) }),
  ).toBeGreaterThan(0);
  // #292 / FR-SHELL-47 (sprint 6 ruling): PCs only rank; a window parks only when no spot is
  // clear of windows. So a window may cover a PC (footprint + 4 px, FR-SHELL-57) only when no spot
  // clear of every other window (12 px gap) and of every PC exists for it at its size; under
  // OQ-MAP-57 D's larger map (FR-MAP-80) that is Party's case at 1440×900.
  const cell = Number(await dm.getByTestId("map-canvas").getAttribute("data-cell-px"));
  const pcBoxes = tokens.map((t) => {
    const side = Math.max(1, Math.round(t.width / cell)) * cell + 2 * PC_MARGIN;
    return { kind: t.id, x: t.x - side / 2, y: t.y - side / 2, w: side, h: side };
  });
  const vp = dm.viewportSize() ?? { width: 0, height: 0 };
  const covering: string[] = [];
  for (const b of boxes) {
    if (!pcBoxes.some((p) => overlaps(b, p))) continue;
    covering.push(b.kind);
    const spot = pcFreeSpot(b, boxes, pcBoxes, vp);
    expect(spot ? `${b.kind} over a PC while ${spot} was clear of windows and PCs` : "ok").toBe(
      "ok",
    );
    // Placement knew: no `data-pc-clear` on it (FR-SHELL-57).
    await expect(shellWindow(dm, b.kind.split(":")[0] as string)).not.toHaveAttribute(
      "data-pc-clear",
      "true",
    );
  }
  console.info(
    `FR-SHELL-45 windows over a PC (no PC-free clear spot): ${covering.join(", ") || "none"}`,
  );
  await expect(dm.getByTestId("ui-play-page")).toHaveAttribute(
    "data-keep-outs",
    "toasts:542,100,356,238",
  );
  await expect(dm.getByTestId("ui-toast-corner")).toHaveAttribute("data-rect", "542,100,356,238");

  // FR-DICE-39: the wide log keeps its roll bar compact on the left.
  const input = await shellWindow(dm, "dice.log").getByTestId("dice-roll-expression").boundingBox();
  expect(input?.width ?? 999).toBeLessThanOrEqual(320);
  expect(input?.x ?? 999).toBeLessThan(68 + 40);

  await dm.context().close();
});

test("FR-SHELL-50 player-1 at 1280×800: Reset layout, then the DM ends the Ambush and starts Crypt → sheet, Initiative and Game log pairwise disjoint; Initiative at the left edge above the log", async ({
  browser,
}) => {
  const { secret, link } = e2eEnv();
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1280, height: 800 });
  await p1.goto(link("Player 1"));
  await live(p1);
  await resetLayout(p1);
  await p1.reload();
  await live(p1);
  const sheet = await shellWindow(p1, "char.sheet").boundingBox();
  expect(sheet && { x: sheet.x, y: sheet.y, w: sheet.width, h: sheet.height }).toEqual({
    x: 948,
    y: 60,
    w: 320,
    h: 440,
  });
  const logBox = await shellWindow(p1, "dice.log").boundingBox();
  expect(logBox && { x: logBox.x, y: logBox.y, w: logBox.width, h: logBox.height }).toEqual({
    x: 68,
    y: 588,
    w: 510,
    h: 200,
  });
  await expect(p1.getByTestId("ui-toast-corner")).toHaveAttribute("data-rect", "908,542,356,238");

  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const init = shellWindow(dm, "cbt.initiative");
  await expect(init).toBeVisible();
  await init.getByTestId("cbt-init-end").click();
  await dm.getByTestId("cbt-init-end-confirm").click();
  await expect(init.getByTestId("cbt-init-row")).toHaveCount(0);
  const enc = await openWindow(dm, "cbt.encounters");
  await enc.getByTestId("cbt-enc-row").filter({ hasText: "Crypt" }).click();
  await enc.getByTestId("cbt-enc-start").click();
  await dm.getByTestId("cbt-enc-start-confirm").click();
  await expect(shellWindow(dm, "cbt.initiative").getByTestId("cbt-init-row").first()).toBeVisible();

  const pInit = shellWindow(p1, "cbt.initiative");
  await expect(pInit).toBeVisible();
  await expect.poll(async () => pairwiseDisjoint(await shownWindows(p1))).toEqual([]);
  const boxes = await shownWindows(p1);
  for (const k of ["char.sheet:main", "cbt.initiative:main", "dice.log:main"]) {
    expect(boxes.map((b) => b.kind)).toContain(k);
  }
  const i = boxes.find((b) => b.kind === "cbt.initiative:main") as Box;
  expect(i.x).toBe(68);
  expect(i.y + i.h).toBeLessThanOrEqual(588 - 12 + 0.5);

  // Leave the shared server as found: end Crypt.
  const dmInit = shellWindow(dm, "cbt.initiative");
  await dmInit.getByTestId("cbt-init-end").click();
  await dm.getByTestId("cbt-init-end-confirm").click();
  await expect(dmInit.getByTestId("cbt-init-row")).toHaveCount(0);
  for (const page of [p1, dm]) await page.context().close();
});
