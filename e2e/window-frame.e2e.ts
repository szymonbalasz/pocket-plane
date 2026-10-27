// e2e-bundle: wf-frame-e2e
// Sprint 8 WF1 (one placer, play-shell §13 sprint 8; walkthrough F0, F2–F5): thin browser checks
// of what the placer writes: the zones, launcher windows PC-clear or put away at 1280×720 in the
// Escort fight (sim-11 g), the 1440 → 1280×720 → 1440 round trip (BL-60), the settle log, and a
// reload. State-changing (End → Start), so its own bundle. The ladder in detail: bun test
// (`placer.test.ts`, the session-replay harness).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { showToPlayers } from "./support/scenes";
import { launcherButton, openWindow, shellWindow } from "./support/shell";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

async function rect(win: Locator): Promise<Box> {
  const b = await win.boundingBox();
  if (!b) throw new Error("window not shown");
  return {
    x: Math.round(b.x),
    y: Math.round(b.y),
    w: Math.round(b.width),
    h: Math.round(b.height),
  };
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

/** Every open `ui-window`: kind, rect, `data-placed`, `data-pc-clear`. */
const openWindows = (page: Page) =>
  page.locator('[data-testid="ui-window"][data-state="open"]').evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return {
        kind: (e.getAttribute("data-record-id") ?? "").split(":")[0] ?? "",
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        placed: e.getAttribute("data-placed"),
        pcClear: e.getAttribute("data-pc-clear") === "true",
      };
    }),
  );

/** The Game log's zone per viewport (play-shell §7 sprint-5 table). */
const LOG_ZONE: Record<string, Box> = {
  // K5 (play-shell §7 sprint-5 table): 12 px above the bottom edge, 40 px taller.
  "1280x720": { x: 68, y: 508, w: 690, h: 200 },
  "1440x900": { x: 68, y: 608, w: 1150, h: 280 },
};

/**
 * The viewport change settles 200 ms after the last resize (FR-SHELL-95): wait until the Game log
 * stands in this viewport's zone and the settle log says so.
 */
async function resizeTo(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  const log = shellWindow(page, "dice.log");
  await expect.poll(() => rect(log)).toEqual(LOG_ZONE[`${width}x${height}`]);
  await expect(page.getByTestId("ui-play-page")).toHaveAttribute(
    "data-settle-log",
    /viewport:dice\.log>zone/,
  );
}

test("FR-SHELL-99 FR-SHELL-103 FR-SHELL-107 FR-SHELL-110 window frame (DM): zones; End → Start Escort at 1280×720 keeps Initiative in its zone; Compendium, Party, Encounters, Stats PC-clear or put away, never overlapping; 1440 → 1280×720 → 1440 restores the Game log 1150×240 (BL-60); a reload keeps the zones", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { secret, recordId } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  const ambush = recordId("battlemap", "scene");
  const scenes = await showToPlayers(dm, "Goblin Ambush");
  await scenes
    .locator(`[data-testid="map-scene-row"][data-record-id="${ambush}"] button`)
    .first()
    .click();
  await expect(dm.getByTestId("map-canvas")).toHaveAttribute("data-scene-id", ambush);
  await scenes.getByTestId("ui-window-close").click();

  await test.step("F0: the zones at 1440×900 (Initiative 1028, 60; Game log 1150 × 240)", async () => {
    const init = await openWindow(dm, "cbt.initiative");
    expect(await rect(init)).toMatchObject({ x: 1028, y: 60, w: 400 });
    expect(await rect(shellWindow(dm, "dice.log"))).toEqual({ x: 68, y: 608, w: 1150, h: 280 });
    await expect(shellWindow(dm, "dice.log")).toHaveAttribute("data-placed", "zone");
  });

  await test.step("F2: 1280×720, End → Start 'Escort to the Ford': Initiative in its zone (868, 60), the Game log 690 × 160", async () => {
    await resizeTo(dm, 1280, 720);
    expect(await rect(shellWindow(dm, "dice.log"))).toEqual({ x: 68, y: 508, w: 690, h: 200 });
    const init = shellWindow(dm, "cbt.initiative");
    await init.getByTestId("cbt-init-end").click();
    await dm.getByTestId("cbt-init-end-confirm").click();
    await expect(launcherButton(dm, "cbt.initiative")).not.toHaveAttribute("data-state", "open");
    const enc = await openWindow(dm, "cbt.encounters");
    await enc
      .locator(
        `[data-testid="cbt-enc-row"][data-record-id="${recordId("enc-friendly", "encounter")}"]`,
      )
      .click();
    await enc.getByTestId("cbt-enc-start").click();
    await dm.getByTestId("cbt-enc-start-confirm").click();
    await expect(launcherButton(dm, "cbt.initiative")).toHaveAttribute("data-state", "open");
    await expect(init).toHaveAttribute("data-placed", "zone");
    expect(await rect(init)).toMatchObject({ x: 868, y: 60, w: 400 });
    // Encounters sat in Initiative's zone: displaced or put away (cause `window:cbt.initiative`).
    const e = (await openWindows(dm)).find((w) => w.kind === "cbt.encounters");
    if (e) expect(overlaps(e, await rect(init))).toBe(false);
  });

  await test.step("F3: Compendium, Party, Encounters, Stats: each PC-clear (`data-pc-clear`) or put away; open windows never overlap; none under the rail", async () => {
    for (const kind of ["cmp.compendium", "party.board", "cbt.encounters", "stats.board"]) {
      await openWindow(dm, kind);
      const open = await openWindows(dm);
      const me = open.find((w) => w.kind === kind);
      expect(me?.pcClear, `${kind} PC-clear`).toBe(true);
      for (const a of open) {
        expect(a.x, `${a.kind} right of the rail`).toBeGreaterThanOrEqual(56);
        for (const b of open) {
          if (a.kind < b.kind) expect(overlaps(a, b), `${a.kind} over ${b.kind}`).toBe(false);
        }
      }
    }
  });

  await test.step("F4: 1440 → 1280×720 → 1440: the Game log 1150 × 240 again (BL-60), Initiative in its zone", async () => {
    await resizeTo(dm, 1440, 900);
    const before = await openWindows(dm);
    expect(await rect(shellWindow(dm, "dice.log"))).toEqual({ x: 68, y: 608, w: 1150, h: 280 });
    await resizeTo(dm, 1280, 720);
    expect(await rect(shellWindow(dm, "dice.log"))).toEqual({ x: 68, y: 508, w: 690, h: 200 });
    await resizeTo(dm, 1440, 900);
    expect(await rect(shellWindow(dm, "dice.log"))).toEqual({ x: 68, y: 608, w: 1150, h: 280 });
    expect(await rect(shellWindow(dm, "cbt.initiative"))).toMatchObject({ x: 1028, y: 60 });
    const after = await openWindows(dm);
    const at = (list: typeof before) =>
      list
        .map(({ kind, x, y, w, h }) => ({ kind, x, y, w, h }))
        .sort((a, b) => (a.kind < b.kind ? -1 : 1));
    expect(at(after)).toEqual(at(before));
  });

  await test.step("F5: a reload keeps the zones and the written layout", async () => {
    const before = await openWindows(dm);
    await dm.reload();
    await live(dm);
    await expect(shellWindow(dm, "dice.log")).toHaveAttribute("data-placed", "zone");
    expect(await rect(shellWindow(dm, "dice.log"))).toEqual({ x: 68, y: 608, w: 1150, h: 280 });
    const after = await openWindows(dm);
    expect(after.map((w) => w.kind).sort()).toEqual(before.map((w) => w.kind).sort());
  });
});
