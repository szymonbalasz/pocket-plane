import { describe, expect, test } from "bun:test";
import { createApp } from "./app";
import { createTestServices } from "./testing/services";

describe("route table", () => {
  test("FR-FIX-24 no HTTP route or WS intent for reset, load or the import pipeline", () => {
    const s = createTestServices();
    const app = createApp(s);
    const paths = app.routes.map((r) => `${r.method} ${r.path}`);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(p).not.toMatch(/fixture|reset|load|import/i);
    expect([...s.intents].filter((n) => /import|fixture|reset|load/.test(n))).toEqual([]);
    expect(s.commands.has("import.batch")).toBe(true);
  });

  test("REST routes per CAMP §9 (OQ-CAMP-15 proposed paths)", () => {
    const app = createApp(createTestServices());
    const paths = new Set(app.routes.map((r) => `${r.method} ${r.path}`));
    for (const p of [
      "POST /api/dm/login",
      "GET /api/campaigns",
      "POST /api/campaigns",
      "PATCH /api/campaigns/:id",
      "POST /api/campaigns/:id/activate",
      "GET /api/players",
      "POST /api/players",
      "PATCH /api/players/:id",
      "GET /api/join/:token",
    ]) {
      expect(paths.has(p)).toBe(true);
    }
  });
});
