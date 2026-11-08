// e2e-bundle: animated-tokens
// Animated tokens (ANIM §13, thin): the DM uploads a WebM in the token picker (Reading video…,
// the Safari note, the film badge) and sets it on Mira; the DM's and player-1's canvases play
// it (the token's Konva Image draws a <video> whose time advances), the hidden animated token
// never reaches player-1, and Map effects ▸ Still stops it on the still frame.
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { e2eEnv, loginDm, rolePage } from "./support/env";
import { konvaNodes } from "./support/konva";
import { shellWindow } from "./support/shell";

const WISP = path.join(
  import.meta.dirname,
  "..",
  "fixtures",
  "assets",
  "tokens",
  "animated-wisp.webm",
);

async function live(page: Page) {
  await expect(page.getByTestId("sync-connection-status")).toHaveAttribute("data-state", "live");
}

/** What a token's art draws: `video` with its time, `image`, or null (no node / no art). */
const art = (page: Page, tokenId: string) =>
  page.evaluate((id) => {
    type KNode = { id(): string; find(s: string): { image(): unknown }[] };
    const K = (window as unknown as { Konva?: { stages: { find(s: string): KNode[] }[] } }).Konva;
    const node = K?.stages.flatMap((s) => s.find(".map-token")).find((n) => n.id() === id);
    if (!node) return null;
    for (const i of node.find("Image")) {
      const el = i.image();
      if (el instanceof HTMLVideoElement) {
        return { kind: "video", time: el.currentTime, paused: el.paused, src: el.src };
      }
      if (el instanceof HTMLImageElement)
        return { kind: "image", time: 0, paused: true, src: el.src };
    }
    return null;
  }, tokenId);

/** The token's video is playing: drawn, and its time moves. */
async function expectPlaying(page: Page, tokenId: string) {
  await expect
    .poll(async () => (await art(page, tokenId))?.kind, { timeout: 15_000 })
    .toBe("video");
  const t0 = (await art(page, tokenId))?.time ?? 0;
  await expect
    .poll(async () => (await art(page, tokenId))?.time ?? 0, { timeout: 10_000 })
    .not.toBe(t0);
}

test("FR-ANIM-08 FR-ANIM-10 FR-ANIM-11 FR-ANIM-12 FR-ANIM-14 DM uploads a WebM token, DM and player see it move, the hidden one never reaches the player, Still stops it", async ({
  browser,
}) => {
  const { secret, link, recordId } = e2eEnv();
  const wispAsset = recordId("animated-token", "asset", 0);
  const mira = recordId("town", "token");
  const wisp = recordId("animated-town", "token", 0);
  const lurker = recordId("animated-town", "token", 1);

  const dm = await rolePage(browser);
  await dm.setViewportSize({ width: 1440, height: 900 });
  await loginDm(dm, secret);
  await live(dm);
  await expectPlaying(dm, wisp);
  await expectPlaying(dm, lurker);

  // Token image… on Mira: upload the WebM (the same bytes as the library's Wisp → existing).
  await expect.poll(async () => (await konvaNodes(dm, "map-token", mira)).length).toBe(1);
  const [m] = await konvaNodes(dm, "map-token", mira);
  await dm.mouse.click(m?.x ?? 0, m?.y ?? 0, { button: "right" });
  await dm.getByTestId("map-token-menu-image").click();
  const dialog = dm.getByRole("dialog", { name: "Token image" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("asset-picker-file-input")).toHaveAttribute(
    "accept",
    /video\/webm/,
  );
  await dialog.getByTestId("asset-picker-file-input").setInputFiles(WISP);
  await expect(dialog.getByTestId("anim-upload-webm-note")).toContainText("Safari");
  const tile = dialog.locator(`[data-testid="asset-picker-item"][data-record-id="${wispAsset}"]`);
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  await expect(tile.getByTestId("anim-picker-badge")).toBeVisible();
  await dialog.getByTestId("anim-upload-webm-note-dismiss").click();
  await expect(dialog.getByTestId("anim-upload-webm-note")).toHaveCount(0);
  await dialog.getByTestId("asset-picker-select").click();
  await expect(dialog).toHaveCount(0);
  await expectPlaying(dm, mira);

  // Player 1: Wisp and Mira move; Lurker (hidden) is never drawn.
  const p = await rolePage(browser);
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.goto(link("Player 1"));
  await live(p);
  await expectPlaying(p, wisp);
  await expectPlaying(p, mira);
  expect(await art(p, lurker)).toBeNull();

  // Map effects ▸ Still: the still frame (thumb image), the video paused; Full plays again.
  await p.getByTestId("ui-prefs-open").click();
  const prefs = shellWindow(p, "shell.prefs");
  await prefs.getByTestId("vfx-pref-level-still").click();
  await expect.poll(async () => (await art(p, wisp))?.kind).toBe("image");
  expect((await art(p, wisp))?.src).toContain(`/api/assets/${encodeURIComponent(wispAsset)}/thumb`);
  await prefs.getByTestId("vfx-pref-level-full").click();
  await expectPlaying(p, wisp);
});
