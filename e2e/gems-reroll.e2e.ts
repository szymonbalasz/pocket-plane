// e2e-bundle: gems-reroll-e2e
// Thin Inspiration reroll flow (GEM §13 E2E, GM1; DICE FR-DICE-65, -68): DM, player-1 (Mira),
// player-2. Gems on, Mira holds 2 Inspiration gems. player-1 hovers Mira's Perception line (4 + 3
// = 7) → "Inspiration: reroll" → "Spend?" ✓ → the spend line and the new roll line show for all
// three; the old line is struck with a "rerolled" Badge that jumps to the new line. The DM
// switches gems off → the struck line and the spend line go without a reload, the final roll
// stays; on → back. player-2's frames never carry the DM's hidden DM-SECRET-GEM line. Rules,
// leaks, races: bun test.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow } from "./support/shell";

const live = (page: Page) =>
  expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
const line = (log: Locator, text: string) =>
  log.locator('[data-testid="dice-log-entry"]').filter({ hasText: text });

/** `camp.setFeature` over a socket of its own (no Campaign options UI before GM3). */
function setGems(page: Page, secret: string, on: boolean) {
  return page.evaluate(
    ([secret, on]) =>
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`);
        ws.onopen = () =>
          ws.send(JSON.stringify({ type: "hello", credential: { role: "dm", secret } }));
        let sent = false;
        ws.onmessage = (m) => {
          const f = JSON.parse(String(m.data)) as { type: string };
          if (f.type === "snapshot" && !sent) {
            sent = true;
            const payload = { feature: "gems", on };
            const intentId = crypto.randomUUID();
            ws.send(JSON.stringify({ type: "intent", intentId, name: "camp.setFeature", payload }));
          } else if (f.type === "ack") {
            ws.close();
            resolve();
          } else if (f.type === "reject") {
            ws.close();
            reject(new Error(String(m.data)));
          }
        };
      }),
    [secret, on] as const,
  );
}

test("FR-GEM-19 FR-GEM-33 FR-DICE-65 FR-DICE-68 FR-GEM-05 P1 rerolls Perception from its line: spend + new line for all, old struck → jumps; gems off hides the traces live, on restores", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const { secret, link } = e2eEnv();
  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await live(dm);
  const p1 = await rolePage(browser);
  await p1.goto(link("Player 1"));
  await live(p1);
  // session-sim-9 presents the "Thieves' Map" handout to player-1 at load.
  await p1.getByTestId("party-present-close").click();
  const p2 = await rolePage(browser);
  const p2Frames: string[] = [];
  p2.on("websocket", (ws) => {
    ws.on("framereceived", (f) => p2Frames.push(String(f.payload)));
  });
  await p2.goto(link("Player 2"));
  await live(p2);

  const logs = [await openWindow(dm, "dice.log"), await openWindow(p1, "dice.log")];
  logs.push(await openWindow(p2, "dice.log"));
  const [dmLog, p1Log, p2Log] = logs as [Locator, Locator, Locator];
  const old = "Mira — Perception: 4 + 3 = 7";
  for (const log of logs) await expect(line(log, old)).toHaveCount(1);
  // The action shows for Mira's owner, never for player-2.
  await expect(line(p2Log, old).getByTestId("dice-log-action")).toHaveCount(0);

  const perc = line(p1Log, old);
  await perc.hover();
  const action = perc.locator('[data-testid="dice-log-action"][data-value="gem.reroll"]');
  await expect(action).toHaveAttribute("aria-label", "Inspiration: reroll");
  await action.click();
  await expect(perc.getByTestId("dice-log-action-confirm")).toContainText("Spend?");
  await perc.getByTestId("dice-log-action-yes").click();

  for (const log of logs) {
    await expect(line(log, "Mira spends an Inspiration gem — rerolls Perception (7)")).toHaveCount(
      1,
    );
    const struck = line(log, old);
    await expect(struck).toHaveAttribute("data-superseded", "true");
    await expect(struck.getByTestId("dice-log-rerolled")).toHaveText("rerolled");
    await expect(line(log, "Perception (reroll, was 7)")).toHaveCount(1);
  }
  const fresh = line(dmLog, "Perception (reroll, was 7)");
  const freshId = await fresh.getAttribute("data-record-id");
  await expect(line(dmLog, old).getByTestId("dice-log-rerolled")).toHaveAttribute(
    "data-record-id",
    freshId as string,
  );
  // The badge jumps to the new line (FR-DICE-37 highlight).
  await line(dmLog, old).getByTestId("dice-log-rerolled").click();
  await expect(fresh).toHaveAttribute("data-focused", "true");
  expect(p2Frames.join("\n")).not.toContain("DM-SECRET-GEM");

  // Walkthrough d2: the fixture's to-hit the DM already ruled (Apply hit, still pending) offers
  // no reroll to its owner, who never gets the DM's hit-ruling.
  const ruled = line(p1Log, "Light crossbow attack");
  await expect(ruled).toHaveCount(1);
  await ruled.hover();
  await expect(ruled.getByTestId("dice-log-action")).toHaveCount(0);

  // Walkthrough f2: physical dice. The form outlives the 4 s "Spend?"; closed unsent, a second
  // try opens it again; "Roll for me" sends.
  const p1Options = p1Log.getByTestId("dice-roll-options");
  if ((await p1Options.getAttribute("data-state")) !== "open") await p1Options.click();
  await p1Log.getByTestId("dice-roll-physical").click();
  await expect(p1Log.getByTestId("dice-roll-physical")).toHaveAttribute("data-state", "checked");
  const stealth = line(p1Log, "Stealth (adv): 6");
  const form = p1.locator("form").filter({ has: p1.getByTestId("dice-manual-label") });
  const openForm = async () => {
    await stealth.hover();
    await stealth.locator('[data-testid="dice-log-action"][data-value="gem.reroll"]').click();
    await stealth.getByTestId("dice-log-action-yes").click();
    await expect(form).toBeVisible();
    await expect(form.getByTestId("dice-manual-label")).toContainText("Stealth (reroll)");
  };
  await openForm();
  await p1.waitForTimeout(5_000);
  await expect(form).toBeVisible();
  await p1.keyboard.press("Escape");
  await expect(form).toHaveCount(0);
  await p1.waitForTimeout(4_500);
  await expect(stealth.getByTestId("dice-log-action-confirm")).toHaveCount(0);
  await openForm();
  await form.getByTestId("dice-manual-auto").click();
  for (const log of logs) await expect(line(log, "Stealth (adv) (reroll, was 11)")).toHaveCount(1);

  // Off: the struck line and the spend line go live; the final roll stays, its marker stripped.
  await setGems(dm, secret, false);
  for (const log of logs) {
    await expect(line(log, old)).toHaveCount(0);
    await expect(line(log, "spends an Inspiration gem")).toHaveCount(0);
    await expect(line(log, "(reroll, was")).toHaveCount(0);
    await expect(log.locator(`[data-record-id="${freshId}"]`)).toHaveCount(1);
  }
  // On: back.
  await setGems(dm, secret, true);
  for (const log of logs) {
    await expect(line(log, old)).toHaveAttribute("data-superseded", "true");
    await expect(line(log, "Perception (reroll, was 7)")).toHaveCount(1);
  }
  expect(p2Frames.join("\n")).not.toContain("DM-SECRET-GEM");
});
