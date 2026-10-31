// e2e-bundle: base
// Full text in the Dice tray (fix/sheet-full-text walkthrough, defect C): a long error in a tray at
// its 300 × 240 minimum never pushes the Roll bar out of the window. The message area takes the
// room there is and scrolls inside the tray; the whole message stays readable, no tooltip. Real
// tray errors are one line, so the real error element gets long text, measured with the built CSS.
import { expect, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";
import { moveTo, resizeTo } from "./support/text-fit";

const LONG = Array.from(
  { length: 8 },
  (_, i) => `Sentence ${i + 1} of a long tray error that must stay readable.`,
).join(" ");

test("full text: a long tray error scrolls inside a minimum-height tray; the Roll bar stays in the window and clickable", async ({
  browser,
}) => {
  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1600, height: 900 });
  await loginDm(dm, e2eEnv().secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const tray = await openWindow(dm, "dicex.tray");
  await moveTo(dm, tray, 400, 200);
  await resizeTo(dm, tray, 300, 240);

  await tray.locator('[data-testid="dicex-tray-palette"][data-value="6"]').click();
  await tray.getByTestId("dicex-tray-expression").fill("1d6+((abc");
  await tray.getByTestId("dicex-tray-roll").click();
  const error = tray.getByTestId("dicex-tray-error");
  await expect(error).toBeVisible();
  const barBefore = await tray.getByTestId("dicex-tray-bar").boundingBox();

  await error.evaluate((e, text) => {
    e.textContent = text;
  }, LONG);
  await expect(error).toHaveText(LONG);

  const facts = await tray.evaluate((w) => {
    const roll = w.querySelector('[data-testid="dicex-tray-roll"]') as HTMLElement;
    const area = w.querySelector('[data-testid="dicex-tray-messages"]') as HTMLElement;
    const tray = w.querySelector('[data-testid="dicex-tray"]') as HTMLElement;
    const wr = w.getBoundingClientRect();
    const r = roll.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const body = tray.parentElement as HTMLElement;
    area.scrollTop = area.scrollHeight;
    const a = area.getBoundingClientRect();
    return {
      inside: r.top >= wr.top && r.bottom <= wr.bottom && r.right <= wr.right,
      hit: hit?.closest("[data-testid]")?.getAttribute("data-testid") ?? null,
      bodyScrolls: body.scrollHeight > body.clientHeight,
      scrolls: area.scrollHeight > area.clientHeight + 1,
      seen: a.height,
      atEnd: area.scrollTop + area.clientHeight >= area.scrollHeight - 1,
      sideways: area.scrollWidth - area.clientWidth,
    };
  });
  expect(facts).toMatchObject({
    inside: true,
    hit: "dicex-tray-roll",
    bodyScrolls: false,
    scrolls: true,
    atEnd: true,
    sideways: 0,
  });
  // At the minimum a line of the message shows, the rest a scroll away, and the dice area keeps its
  // least height, so the staged dice aren't hidden until the error clears.
  expect(facts.seen).toBeGreaterThanOrEqual(14);
  expect((await tray.getByTestId("dicex-tray-area").boundingBox())?.height).toBeGreaterThanOrEqual(
    20,
  );
  // The bar hasn't moved for it.
  expect((await tray.getByTestId("dicex-tray-bar").boundingBox())?.y).toBe(barBefore?.y);
  await tray.screenshot({ path: test.info().outputPath("tray-240.png") });

  // With room, the same message shows whole and nothing scrolls.
  await resizeTo(dm, tray, 460, 620);
  const messages = tray.getByTestId("dicex-tray-messages");
  expect(await messages.evaluate((m) => m.scrollHeight - m.clientHeight)).toBeLessThanOrEqual(1);
  await expect(tray.getByTestId("dicex-tray-roll")).toBeInViewport({ ratio: 1 });
});
