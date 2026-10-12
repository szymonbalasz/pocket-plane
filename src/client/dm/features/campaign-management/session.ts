// DM session: secret in localStorage (FR-CAMP-04), REST client, campaign list.

import type { CampaignSummary } from "@shared/campaign-management/schemas";
import { type Api, ApiError, call, createApi } from "@ui/api";
import { create } from "zustand";

const KEY = "pocket-plane.dmSecret";

interface DmSession {
  secret: string | null;
  campaigns: CampaignSummary[] | null;
  setSecret(s: string | null): void;
  loadCampaigns(): Promise<void>;
}

export const useDmSession = create<DmSession>((set) => ({
  secret: localStorage.getItem(KEY),
  campaigns: null,
  setSecret(s) {
    if (s === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, s);
    set({ secret: s, campaigns: null });
  },
  async loadCampaigns() {
    const r = await dmCall<{ campaigns: CampaignSummary[] }>(api.api.campaigns.$get());
    if (r) set({ campaigns: r.campaigns });
  },
}));

export const api: Api = createApi(() => useDmSession.getState().secret);

/** Like `call`, but a 401 logs the DM out (changed secret → login screen, FR-CAMP-04). */
export async function dmCall<T>(
  p: Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>,
): Promise<T | null> {
  try {
    return await call<T>(p);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      useDmSession.getState().setSecret(null);
      return null;
    }
    throw err;
  }
}
