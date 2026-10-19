// e2e-bundle: dice-polish
// Thin dice-landing flows (D8; DICEX §13 sprint 5 E2E, walkthrough 30, 35, 37). A recorder (a
// MutationObserver installed before the page's scripts, as the walkthrough's) logs every change
// of `dice-log-entry`, `dicex-tray-total`, `dicex-popup-row` and `dicex-screen`; the order is
// asserted from it, not from screenshots. B (player-1) rolls 2d6 + 1d8 from the tray: on C
// (player-2) the line arrives held ("…", `data-landed="false"`) before the dice rest and shows
// its total after; on B the tray total waits the same way. A reload mid-throw shows the line at
// once (a snapshot entry is never held). A fresh tray roll after a result keeps no label (BL-18).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

// Headless Chromium has WebGL only through SwiftShader, which Chrome gates behind a flag.
test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] } });

interface Rec {
  t: number;
  testid: string;
  id: string | null;
  landed: string | null;
  state: string | null;
  text: string;
}

/** The §13 recorder, from the first script on every load of `page`. */
async function record(page: Page) {
  await page.addInitScript(() => {
    const ids = ["dice-log-entry", "dicex-tray-total", "dicex-popup-row", "dicex-screen"];
    const sel = ids.map((id) => `[data-testid="${id}"]`).join(",");
    const w = window as unknown as { __rec: unknown[] };
    w.__rec = [];
    const last = new WeakMap<Element, string>();
    const scan = () => {
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        const r = {
          testid: el.dataset.testid ?? "",
          id: el.dataset.recordId ?? null,
          landed: el.dataset.landed ?? null,
          state: el.dataset.state ?? null,
          text: el.textContent ?? "",
        };
        const key = JSON.stringify(r);
        if (last.get(el) === key) continue;
        last.set(el, key);
        w.__rec.push({ t: performance.now(), ...r });
      }
    };
    new MutationObserver(scan).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  });
}

const records = (page: Page) => page.evaluate(() => (window as unknown as { __rec: Rec[] }).__rec);

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

const hasWebgl = (page: Page) =>
  page.evaluate(() => {
    const c = document.createElement("canvas");
    return (c.getContext("webgl2") ?? c.getContext("webgl")) !== null;
  });

async function open(browser: Parameters<typeof rolePage>[0], player: string) {
  const page = await rolePage(browser);
  await record(page);
  await page.goto(e2eEnv().link(player));
  await live(page);
  return page;
}

test("FR-DICEX-49 FR-DICE-40 a tray roll: the line and the tray total wait for the dice, then show the number", async ({
  browser,
}) => {
  const p1 = await open(browser, "Player 1");
  const p2 = await open(browser, "Player 2");
  const webgl = await hasWebgl(p2);
  if (webgl) {
    await expect(p2.getByTestId("dicex-screen")).toHaveAttribute("data-chunk", "ready", {
      timeout: 10_000,
    });
  }
  const log2 = await openWindow(p2, "dice.log");
  const before = await log2.getByTestId("dice-log-entry").count();

  // B: palette d6, d6, d8 → Roll.
  const tray = await openWindow(p1, "dicex.tray");
  for (const f of [6, 6, 8]) {
    await tray.locator(`[data-testid="dicex-tray-palette"][data-value="${f}"]`).click();
  }
  await expect(tray.getByTestId("dicex-tray-die")).toHaveCount(3);
  await tray.getByTestId("dicex-tray-roll").click();

  const line = log2.getByTestId("dice-log-entry").nth(before);
  await expect(line).toHaveAttribute("data-landed", "true", { timeout: 10_000 });
  await expect(line).not.toHaveAttribute("aria-busy", "true");
  const id = (await line.getAttribute("data-record-id")) as string;
  const total = /= (\d+)/.exec((await line.textContent()) ?? "")?.[1];
  expect(total).toMatch(/^\d+$/);
  await expect(line.locator('[data-testid="dice-log-die"][data-value]')).toHaveCount(3);

  // C's recorder: held with "…" first, then landed with the total. One observer batch shares a
  // time, so the order is read from the times: with 3D, the line lands at the layer's rest.
  const rec = (await records(p2)).filter((r) => r.id === id || r.testid === "dicex-screen");
  const held = rec.findIndex((r) => r.id === id && r.testid === "dice-log-entry");
  const shown = rec.findIndex((r) => r.id === id && r.landed === "true");
  expect(rec[held]).toMatchObject({ landed: "false" });
  expect(rec[held]?.text).toContain("= …");
  expect(rec[held]?.text).not.toContain(`= ${total}`);
  expect(shown).toBeGreaterThan(held);
  expect(rec[shown]?.text).toContain(`= ${total}`);
  const heldAt = rec[held]?.t ?? 0;
  const shownAt = rec[shown]?.t ?? 0;
  if (webgl) {
    const rest = rec.find(
      (r) => r.testid === "dicex-screen" && r.state === "rest" && r.t >= heldAt,
    );
    // An auto-flat device (slow software GL) lands at the end of its chip fade instead.
    if (rest) {
      // The layer and the line commit separately in the rest's task: one frame either way.
      expect(shownAt).toBeGreaterThanOrEqual(rest.t - 16);
      expect(shownAt - rest.t).toBeLessThan(100);
      expect(rest.t).toBeGreaterThan(heldAt);
    }
  }
  // Every held record of the line hides the total (no number before the landing).
  for (const r of rec.slice(0, shown)) if (r.id === id) expect(r.text).not.toContain(`= ${total}`);

  // B, the roller: the tray total shows "…" first, then the total.
  await expect(tray.getByTestId("dicex-tray-total")).toHaveAttribute("data-landed", "true", {
    timeout: 10_000,
  });
  const trayRec = (await records(p1)).filter((r) => r.testid === "dicex-tray-total");
  expect(trayRec[0]).toMatchObject({ landed: "false", text: "…" });
  expect(trayRec.at(-1)).toMatchObject({ landed: "true", text: total });

  for (const page of [p1, p2]) await page.context().close();
});

test("FR-DICEX-49 reload mid-throw: the line once with its total at once (a snapshot entry is never held), no popup", async ({
  browser,
}) => {
  const p1 = await open(browser, "Player 1");
  const log = await openWindow(p1, "dice.log");
  const before = await log.getByTestId("dice-log-entry").count();
  await log.getByTestId("dice-roll-expression").fill("10d6");
  await log.getByTestId("dice-roll-expression").press("Enter");
  await expect(log.getByTestId("dice-log-entry")).toHaveCount(before + 1);
  const id = (await log
    .getByTestId("dice-log-entry")
    .nth(before)
    .getAttribute("data-record-id")) as string;
  await p1.reload();
  await live(p1);
  const after = await openWindow(p1, "dice.log");
  const line = after.locator(`[data-testid="dice-log-entry"][data-record-id="${id}"]`);
  await expect(line).toHaveCount(1);
  await expect(line).toHaveAttribute("data-landed", "true");
  const rec = (await records(p1)).filter((r) => r.id === id);
  expect(rec.length).toBeGreaterThan(0);
  expect(rec.every((r) => r.landed === "true" && /= \d+/.test(r.text))).toBe(true);
  await expect(p1.getByTestId("dicex-popup")).toHaveCount(0);
  await p1.context().close();
});

test("FR-DICEX-50 label reset: 'Roll again' keeps the label; a palette die after a result starts fresh ('Other', no label)", async ({
  browser,
}) => {
  const p1 = await open(browser, "Player 1");
  const log = await openWindow(p1, "dice.log");
  // A labelled `free` request from the roll bar: 1d12 + 5 "Notation test".
  await log.getByTestId("dice-roll-expression").fill("1d12+5");
  await log.getByTestId("dice-roll-options").click();
  await log.getByTestId("dice-roll-label").fill("Notation test");
  await log.getByTestId("dicex-tray-open").click();
  const tray = await openWindow(p1, "dicex.tray");
  const state = tray.getByTestId("dicex-tray-state");
  await expect(state).toHaveAttribute("data-value", "compose");
  await expect(state).toHaveText("Notation test");

  const lines = log.getByTestId("dice-log-entry").filter({ hasText: "Notation test" });
  await tray.getByTestId("dicex-tray-roll").click();
  await expect(state).toHaveAttribute("data-value", "result");
  await expect(lines).toHaveCount(1);
  // Roll again: the same request, label included.
  await tray.getByTestId("dicex-tray-again").click();
  await expect(lines).toHaveCount(2);
  await expect(state).toHaveAttribute("data-value", "result");

  // A palette die after the result: a fresh request, nothing of the old label.
  await tray.locator('[data-testid="dicex-tray-palette"][data-value="6"]').click();
  await expect(state).toHaveAttribute("data-value", "compose");
  await expect(state).toHaveText("Other");
  const count = await log.getByTestId("dice-log-entry").count();
  await tray.getByTestId("dicex-tray-roll").click();
  const last = log.getByTestId("dice-log-entry").nth(count);
  await expect(last).toContainText(/Player 1\s*— 1d6: /);
  await expect(last).not.toContainText("Notation test");
  await expect(lines).toHaveCount(2);
  await p1.context().close();
});
