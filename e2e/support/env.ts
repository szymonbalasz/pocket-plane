import { readFileSync } from "node:fs";
import type { Browser, Page } from "@playwright/test";

interface Manifest {
  playerLinks: { player: string; campaign: string; url: string }[];
}

export function e2eEnv() {
  const secret = process.env.E2E_DM_SECRET;
  const manifestFile = process.env.E2E_MANIFEST;
  if (!secret || !manifestFile) throw new Error("Run E2E via `bun run e2e`.");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as Manifest;
  const link = (player: string) => {
    const l = manifest.playerLinks.find((x) => x.player === player);
    if (!l) throw new Error(`No link for ${player}`);
    return l.url;
  };
  return { secret, link };
}

/** One isolated browser context per role (AGENTS §9.6). */
export async function rolePage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext();
  return ctx.newPage();
}

export async function loginDm(page: Page, secret: string) {
  await page.goto("/");
  await page.getByTestId("camp-login-secret").fill(secret);
  await page.getByTestId("camp-login-submit").click();
}
