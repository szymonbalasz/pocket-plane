// Feature registry. Append-only (AGENTS §9.9): add your feature's line; nothing else.
import type { Feature } from "../services";
import { assetsPipeline } from "./assets-pipeline";
import { campaignManagement } from "./campaign-management";
import { fixturesAdapters } from "./fixtures-adapters";
import { liveSync } from "./live-sync";

export const features: readonly Feature[] = [
  campaignManagement,
  liveSync,
  fixturesAdapters,
  assetsPipeline,
];
