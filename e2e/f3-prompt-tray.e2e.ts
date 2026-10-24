// e2e-bundle: f3-prompt-tray-e2e
// Sprint 11 F3 (BL-112, FR-DICEX-83): B (player-1, Mira) holds two open prompts. Tray closed:
// Alt+click Insight's Roll → the tray adjusts it; the tray's Roll answers → the prompt is spent
// and the tray closes again (it was closed before the stage; sim-14 glitch 7). Tray already open:
// Alt+click Perception's Roll → tray Roll → the prompt is spent and the tray stays open on the
// result, as any tray roll (FR-DICEX-10). Rules: bun test (tray-restore).
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

// Headless Chromium has WebGL only through SwiftShader, which Chrome gates behind a flag.
test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] } });

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");

test("FR-DICEX-83 BL-112 a prompt answered through the tray puts the tray back: closed → closed, open → open on the result", async ({
  browser,
}) => {
  const { link } = e2eEnv();
  const p1 = await rolePage(browser);
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.goto(link("Player 1"));
  await live(p1);
  const prompts = p1.locator('[data-testid="note-toast"] [data-testid="dicex-prompt"]');
  const prompt = (label: string) => prompts.filter({ hasText: `DM: ${label} · Mira` });
  const tray = shellWindow(p1, "dicex.tray");
  const state = tray.getByTestId("dicex-tray-state");

  // Tray closed → Alt-stage Insight → tray Roll → spent, the tray closes again.
  await expect(tray).toHaveCount(0);
  await expect(prompt("Insight")).toBeVisible();
  await prompt("Insight")
    .getByTestId("dicex-prompt-roll")
    .click({ modifiers: ["Alt"] });
  await expect(state).toHaveAttribute("data-value", "adjust");
  await expect(tray).toContainText("Mira — Insight");
  await tray.getByTestId("dicex-tray-roll").click();
  await expect(prompt("Insight")).toHaveCount(0);
  await expect(tray).toHaveCount(0);
  await expect(p1.locator('[data-testid="dicex-popup"][data-record-id]')).toHaveCount(1);

  // Tray open (idle) → Alt-stage Perception → tray Roll → spent, the tray stays on the result.
  await openWindow(p1, "dicex.tray");
  await expect(state).toHaveAttribute("data-value", "idle");
  await expect(prompt("Perception")).toBeVisible();
  await prompt("Perception")
    .getByTestId("dicex-prompt-roll")
    .click({ modifiers: ["Alt"] });
  await expect(state).toHaveAttribute("data-value", "adjust");
  await tray.getByTestId("dicex-tray-roll").click();
  await expect(prompt("Perception")).toHaveCount(0);
  await expect(state).toHaveAttribute("data-value", "result");
  await p1.waitForTimeout(500);
  await expect(tray).toBeVisible();
  await p1.context().close();
});
