// Test services: in-memory DB from the template, config via parseConfig (no .env needed).
import os from "node:os";
import { type Clock, type CommandContext, manualClock, realContext } from "../commands/context";
import { parseConfig } from "../config";
import type { Db } from "../db/client";
import { openTestDb } from "../db/testing";
import { silentLogger } from "../log";
import { createServices, type Services } from "../services";

export const TEST_SECRET = "test-dm-secret-0123";

export interface TestServicesOptions {
  testMode?: boolean;
  clock?: Clock;
  ctx?: () => CommandContext;
  db?: Db;
  env?: Record<string, string>;
}

export function createTestServices(opts: TestServicesOptions = {}): Services {
  const config = parseConfig(
    {
      PP_PORT: "0",
      PP_DATA_DIR: os.tmpdir(),
      PP_DATA_DISPOSABLE: "1",
      PP_TEST_MODE: opts.testMode === false ? "" : "1",
      PP_DM_SECRET: TEST_SECRET,
      ...opts.env,
    },
    { requireSecret: true },
  );
  const clock = opts.clock ?? manualClock();
  return createServices({
    config,
    db: opts.db ?? openTestDb(),
    log: silentLogger,
    clock,
    ctx: opts.ctx ?? (() => realContext(clock)),
  });
}

export const DM_ACTOR = { role: "dm" as const, playerId: null, campaignId: null };
