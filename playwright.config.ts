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
  timeout: 30_000,
  // A hang guard, not a timing check: with bundles side by side (PP_E2E_WORKERS) a live update can
  // take over the 5 s default to land.
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 800 },
  },
});
