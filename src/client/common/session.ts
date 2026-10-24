// The one client credential / session helper (BL-94): the DM secret's storage key and its
// read / write (FR-CAMP-04), a player page's link token (`/p/<token>`), and this page's REST
// client with its credential (DM `Bearer <secret>`; player `Authorization: Player <token>`,
// route-local on the compendium routes, FR-CMP-13). The DM session, the player app, the player
// Compendium / Rules windows and the command palette all read these; nothing else copies them.
import type { AppType } from "@server/app";
import { hc } from "hono/client";
import { type Api, createApi } from "./api";

/** Where the DM session keeps the secret (FR-CAMP-04; this browser only). */
export const DM_SECRET_KEY = "pocket-plane.dmSecret";

/** The stored DM secret; null when none or storage is blocked. */
export function readDmSecret(): string | null {
  try {
    return globalThis.localStorage?.getItem(DM_SECRET_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Store (or, `null`, forget) the DM secret; a blocked storage keeps it for this page only. */
export function writeDmSecret(secret: string | null): void {
  try {
    if (secret === null) globalThis.localStorage?.removeItem(DM_SECRET_KEY);
    else globalThis.localStorage?.setItem(DM_SECRET_KEY, secret);
  } catch {
    // Private mode / blocked site data: the session still holds it in memory.
  }
}

/** The link token of a player page (`/p/<token>`), decoded; null elsewhere. */
export function linkTokenFromPath(pathname: string): string | null {
  const m = /^\/p\/([^/?#]+)/.exec(pathname);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

/** A REST client sending `Authorization: Player <token>` (compendium routes only). */
export function playerApi(token: string | null): Api {
  return hc<AppType>(window.location.origin, {
    headers: (): Record<string, string> => (token ? { Authorization: `Player ${token}` } : {}),
  });
}

const apis = new Map<"dm" | "player", Api>();

/** This page's REST client with its credential: the stored DM secret, or this page's link token. */
export function pageApi(role: "dm" | "player"): Api {
  let api = apis.get(role);
  if (!api) {
    api =
      role === "dm"
        ? createApi(readDmSecret)
        : playerApi(linkTokenFromPath(window.location.pathname));
    apis.set(role, api);
  }
  return api;
}
