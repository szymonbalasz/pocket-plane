// Bundle registry. Append-only (AGENTS §9.9): add your own lines.
import type { Bundle } from "@server/features/fixtures-adapters/fixture-types";
import base from "./base";
import campaignSwitch from "./campaign-switch";
import sessionSim from "./session-sim";
import syncProbe from "./sync-probe";

export const bundles: readonly Bundle[] = [base, sessionSim, campaignSwitch, syncProbe];
