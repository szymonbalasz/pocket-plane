import { defineConfig, devices } from "@playwright/test";

// Run via `bun run e2e` (scripts/e2e.ts): it builds, loads fixtures into a temp dir,
// starts the server on port 0 and passes the URL in E2E_BASE_URL.
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  // Screenshot baselines (e2e/visual.e2e.ts) are Linux renders from CI, one set, no OS suffix.
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFileName}/{arg}{ext}",
  // Hang guards, not timing checks: with bundles side by side (PP_E2E_WORKERS) a test runs up to
  // twice as long (popup-line's 3D dice rounds: 15 s alone, 25–30 s at 4 workers) and a live update
  // can take over the 5 s expect default to land.
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    // Anti-aliasing noise passes; a moved control, a colour or a font change fails.
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, threshold: 0.2 },
  },
  use: {
    baseURL: process.env.E2E_BASE_URL,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 800 },
  },
});
