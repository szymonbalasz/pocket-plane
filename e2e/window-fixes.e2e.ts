// e2e-bundle: session-sim-9
// Thin sprint-6 window fixes (SHELL §13 sprint 6 E2E, track WF). Read-only on server state: opens
// windows, sends no intent. WF1's part: windows reopened at a smaller viewport whose stored spot
// is now covered are re-placed (FR-SHELL-56). Rank, footprints and golden layouts in detail:
// bun test (placement, manager, windows tests).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { launcherButton, openWindow, shellWindow } from "./support/shell";

interface Box {
  kind: string;
  placed: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

/** Every shown `ui-window`'s rect and `data-placed` (minimised ones are hidden). */
const shownWindows = (page: Page): Promise<Box[]> =>
  page.locator('[data-testid="ui-window"][data-state="open"]').evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return {
        kind: e.getAttribute("data-record-id") ?? "",
        placed: e.getAttribute("data-placed") ?? "",
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
      };
    }),
  );

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

function pairwiseOverlaps(boxes: Box[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i] as Box;
      const b = boxes[j] as Box;
      if (overlaps(a, b)) out.push(`${a.kind} × ${b.kind}`);
    }
  return out;
}

/** `ui-window` `data-state` by record id (mounted windows: open or minimised). */
const windowStates = async (page: Page): Promise<Record<string, string | null>> =>
  Object.fromEntries(
    await page
      .locator('[data-testid="ui-window"]')
      .evaluateAll((els) =>
        els.map((e) => [e.getAttribute("data-record-id"), e.getAttribute("data-state")]),
      ),
  );

const LAUNCHER_KINDS = ["cmp.compendium", "party.board", "cbt.encounters"];

test("FR-SHELL-56 DM 1440×900: Compendium, Party, Encounters opened, closed, the viewport shrunk to 1280×720, reopened → the shown windows pairwise disjoint, none over Initiative or the Game log, at least one reopened", async ({
  browser,
}) => {
  const { secret } = e2eEnv();
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  await expect(shellWindow(dm, "cbt.initiative")).toBeVisible();
  await expect(shellWindow(dm, "dice.log")).toBeVisible();

  for (const kind of LAUNCHER_KINDS) await openWindow(dm, kind);
  expect(pairwiseOverlaps(await shownWindows(dm))).toEqual([]);
  // Close all three; an auto-minimised one (FR-SHELL-47) is restored from the launcher first.
  for (let round = 0; round < LAUNCHER_KINDS.length + 1; round++) {
    for (const kind of LAUNCHER_KINDS) {
      const win = shellWindow(dm, kind);
      if (await win.isVisible()) await win.getByTestId("ui-window-close").click();
    }
    const states = await windowStates(dm);
    const i = LAUNCHER_KINDS.findIndex((kind) => states[`${kind}:main`] === "minimised");
    if (i < 0) break;
    const kind = LAUNCHER_KINDS[i] as string;
    await launcherButton(dm, kind).click();
    await shellWindow(dm, kind).waitFor({ state: "visible" });
  }
  for (const kind of LAUNCHER_KINDS) await expect(shellWindow(dm, kind)).toHaveCount(0);

  await dm.setViewportSize({ width: 1280, height: 720 });
  for (const kind of LAUNCHER_KINDS) {
    await openWindow(dm, kind);
    const boxes = await shownWindows(dm);
    expect(pairwiseOverlaps(boxes), `after reopening ${kind}`).toEqual([]);
  }
  const boxes = await shownWindows(dm);
  const fixed = boxes.filter((b) => b.kind === "cbt.initiative:main" || b.kind === "dice.log:main");
  expect(fixed).toHaveLength(2);
  for (const b of boxes.filter((x) => !fixed.includes(x))) {
    for (const f of fixed) expect(overlaps(b, f) ? `${b.kind} over ${f.kind}` : "ok").toBe("ok");
  }
  const placed = await dm
    .locator('[data-testid="ui-window"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-placed")));
  expect(placed).toContain("reopened");

  await dm.context().close();
});
