// e2e-bundle: alert-sounds-e2e
// Alert sounds (dice-extras §13 T13–T14; FR-ASSET-52, FR-CAMP-49, FR-SHELL-130–132): the DM's
// three upload refusals show inline; Chime picked for Turn, Test ▶ plays it; player-1's turn alert
// plays the picked sound (`turn:played`), muted → `turn:muted` with the flash kept.
import os from "node:os";
import path from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { writeAudioLimitFiles } from "./support/audio";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { openWindow, shellWindow } from "./support/shell";

const by = (scope: Page | Locator, testId: string, value: string) =>
  scope.locator(`[data-testid="${testId}"][data-value="${value}"]`);

test("FR-ASSET-52 FR-CAMP-49 FR-SHELL-130 FR-SHELL-132 upload refusals, Chime for Turn, the turn alert plays it; muted → none", async ({
  browser,
}, info) => {
  const { secret, link, recordId } = e2eEnv();
  const chime = recordId("audio-chime", "audio-asset");
  const mira = recordId("combat-1", "combatant", 0);
  const files = writeAudioLimitFiles(
    path.join(os.tmpdir(), `pp-e2e-audio-${process.pid}-${info.workerIndex}`),
  );

  const dm = await rolePage(browser);
  await loginDm(dm, secret);
  await expect(dm.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  const player = await rolePage(browser);
  const frames: string[] = [];
  player.on("websocket", (ws) => ws.on("framereceived", (f) => frames.push(String(f.payload))));
  // FR-SHELL-131: the picks preload at idle after the snapshot, by capability URL only.
  const fetched = player.waitForResponse((r) => r.url().endsWith(`/api/assets/${chime}/audio`));
  await player.goto(link("Player 1"));
  expect((await fetched).status()).toBe(200);
  const topbar = player.getByTestId("ui-topbar");
  await expect(player.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
  await player.getByTestId("ui-topbar").click(); // the first interaction unlocks audio

  // T13: Campaign options → three inline refusals; nothing added.
  const panel = await openWindow(dm, "camp.players");
  await panel.getByTestId("camp-options-open").click();
  const options = dm.getByTestId("camp-options");
  const error = options.getByTestId("camp-sound-error");
  for (const [file, message] of [
    [files["big.wav"], "Too large (max 512 KB)"],
    [files["long.wav"], "Too long (max 5 s)"],
    [files["fake.mp3"], "Not a sound (MP3, OGG or WAV)"],
  ] as const) {
    await options.getByTestId("camp-sound-file").setInputFiles(file);
    await expect(error).toHaveText(message);
  }

  // Chime for Turn (the bundle picked it for request / pause: already preloaded, not fetched again).
  const turnRow = by(options, "camp-sound", "turn");
  const select = turnRow.getByTestId("camp-sound-select");
  await expect(select).toHaveAttribute("data-value", "default");
  await select.click();
  await dm.getByRole("option", { name: "Chime" }).click();
  await expect(select).toHaveAttribute("data-value", chime);
  await turnRow.getByTestId("camp-sound-test").click();
  await expect(turnRow.getByTestId("camp-sound-test")).toHaveAttribute("data-outcome", "played");
  // The request row shows the bundle's pick; resume its silent default.
  await expect(
    by(options, "camp-sound", "request").getByTestId("camp-sound-select"),
  ).toHaveAttribute("data-value", chime);
  await dm.keyboard.press("Escape");

  // T14: Next to Mira's turn → the player's turn alert plays the Chime.
  const init = await openWindow(dm, "cbt.initiative");
  const turn = init.locator('[data-testid="cbt-init-row"][data-turn="true"]');
  const toMira = async () => {
    if ((await turn.getAttribute("data-record-id")) === mira) {
      await init.getByTestId("cbt-init-prev").click();
      await expect(turn).not.toHaveAttribute("data-record-id", mira);
    }
    for (let i = 0; i < 10; i++) {
      const before = await turn.getAttribute("data-record-id");
      await init.getByTestId("cbt-init-next").click();
      await expect(turn).not.toHaveAttribute("data-record-id", before ?? "");
      if ((await turn.getAttribute("data-record-id")) === mira) return;
    }
    throw new Error("Mira's turn never came");
  };
  await toMira();
  await expect(topbar).toHaveAttribute("data-test-last-sound", /^turn:played:\d+$/);

  // Muted (Preferences → Sound): the next turn alert is silent; the flash and Toast stay.
  const chip = player.getByTestId("ui-prefs-open");
  await chip.click();
  await expect(shellWindow(player, "shell.prefs")).toBeVisible();
  await player.getByTestId("ui-sound-mute").click();
  await expect(chip).toHaveAttribute("data-sound-state", "muted");
  await toMira();
  await expect(topbar).toHaveAttribute("data-test-last-sound", /^turn:muted:\d+$/);
  await expect(player.getByTestId("ui-alert-flash")).toHaveAttribute("data-alert-id", "cbt.turn");
  await expect(player.getByTestId("ui-alert-toast")).toContainText("Your turn — Mira");

  // FR-ASSET-57: no `audio-asset` row ever reaches the player; the picked ID only as a pick.
  expect(frames.some((f) => f.includes("audio-asset"))).toBe(false);
  expect(frames.some((f) => f.includes(chime))).toBe(true);
  await player.context().close();
  await dm.context().close();
});
