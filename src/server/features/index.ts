// Feature registry. Append-only (AGENTS §9.9): add your feature's line; nothing else.
import type { Feature } from "../services";
import { campaignManagement } from "./campaign-management";

export const features: readonly Feature[] = [campaignManagement];
