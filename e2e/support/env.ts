import { readFileSync } from "node:fs";
import type { Browser, Page } from "@playwright/test";

interface Manifest {
  bundle: string;
  /** Fixture key → record type → IDs created by that fixture (FR-FIX-09). */
  records: Record<string, Record<string, string[]>>;
  playerLinks: { player: string; campaign: string; url: string }[];
}

/**
 * The loaded bundle of this spec file. Pick it with a header line `// e2e-bundle: <name>`
 * (default `sync-probe`); `bun run e2e` loads each bundle into its own server and data dir.
 */
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
  /** ID of the `index`-th record of `type` a fixture created, e.g. `recordId("char-mira", "entity")`. */
  const recordId = (fixtureKey: string, type: string, index = 0) => {
    const id = manifest.records[fixtureKey]?.[type]?.[index];
    if (!id)
      throw new Error(
        `Bundle "${manifest.bundle}": fixture ${fixtureKey} has no ${type} #${index}`,
      );
    return id;
  };
  return { secret, link, bundle: manifest.bundle, recordId };
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
