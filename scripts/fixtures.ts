// `bun run fixtures:reset | fixtures:load <bundle> | fixtures:reset-load <bundle> [--profile p]`
import { library } from "../fixtures";
import { armCrashHook } from "../src/server/commands/crash";
import { ConfigError, formatCrashSpec, loadConfig, profileArg } from "../src/server/config";
import {
  FixtureError,
  load,
  reset,
  resetAndLoad,
} from "../src/server/features/fixtures-adapters/loader";
import { LockHeldError } from "../src/server/runtime/lock";
import type { Manifest } from "../src/server/runtime/manifest";

const BUDGET_MS = 3_000;

function printSummary(m: Manifest, secret: string, totalMs: number) {
  console.log(`Loaded bundle "${m.bundle}" in ${totalMs} ms (load ${m.durationMs} ms)`);
  console.log(`Fixtures: ${m.fixtures.join(", ")}`);
  for (const [key, types] of Object.entries(m.records)) {
    const parts = Object.entries(types).map(([t, ids]) => `${ids.length} ${t}`);
    console.log(`  ${key}: ${parts.join(", ") || "-"}`);
  }
  console.log(`DM URL:     ${m.dmUrl ?? "(port 0: see server output)"}`);
  console.log(`DM secret:  ${secret || "(PP_DM_SECRET not set)"}`);
  for (const l of m.playerLinks) console.log(`Player link: ${l.player} (${l.campaign}): ${l.url}`);
  if (totalMs > BUDGET_MS) console.warn(`warning: over the ${BUDGET_MS} ms budget (FR-FIX-10)`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const bundle = rest.find((a, i) => !a.startsWith("--") && rest[i - 1] !== "--profile");
  const config = loadConfig({ profile: profileArg(process.argv), requireSlot: true });
  const notice = (m: string) => console.warn(m);
  // Test-mode crash hook (#163): only `fixture:<key>` here; command points are the server's.
  if (config.testCrash?.point === "fixture") {
    armCrashHook(config.testCrash);
    notice(`PP_TEST_CRASH armed: the process kills itself at ${formatCrashSpec(config.testCrash)}`);
  }
  const t0 = performance.now();
  switch (cmd) {
    case "reset":
      await reset(config, { notice });
      console.log(`Reset ${config.dataDir} (profile ${config.profile}).`);
      return;
    case "load":
    case "reset-load": {
      if (!bundle) throw new FixtureError(`Usage: bun run fixtures:${cmd} <bundle> [--profile p]`);
      const m =
        cmd === "load"
          ? await load(config, library, bundle, { notice, now: Date.now() })
          : await resetAndLoad(config, library, bundle, { notice, now: Date.now() });
      printSummary(m, config.dmSecret, Math.round(performance.now() - t0));
      return;
    }
    default:
      throw new FixtureError("Usage: bun scripts/fixtures.ts reset|load|reset-load [bundle]");
  }
}

main().catch((err: unknown) => {
  if (err instanceof FixtureError || err instanceof ConfigError || err instanceof LockHeldError) {
    console.error(err.message);
  } else {
    console.error(err);
  }
  process.exit(1);
});
