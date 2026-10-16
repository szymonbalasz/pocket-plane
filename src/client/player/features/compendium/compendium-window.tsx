// Player `cmp.compendium` (FR-CMP-18, -19): the shared body (no Monsters tab, no import, no drag)
// over a REST client that sends the player's link token as `Authorization: Player <token>`
// (FR-CMP-13; route-local on the compendium routes only).
import type { AppType } from "@server/app";
import type { Api } from "@ui/api";
import { CompendiumBody } from "@ui/features/compendium/CompendiumWindow";
import { compendiumWindowBase } from "@ui/features/compendium/window";
import { defineWindow } from "@ui/features/play-shell/registry";
import { hc } from "hono/client";

/** The link token of this page (`/p/<token>`), as the player app reads it. */
export function linkTokenFromPath(pathname: string): string | null {
  const m = /^\/p\/([^/?#]+)/.exec(pathname);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

/** REST client with `Authorization: Player <token>` (compendium routes only). */
export function playerCompendiumApi(token: string | null): Api {
  return hc<AppType>(window.location.origin, {
    headers: (): Record<string, string> => (token ? { Authorization: `Player ${token}` } : {}),
  });
}

let api: Api | null = null;
const playerApi = () => {
  api ??= playerCompendiumApi(linkTokenFromPath(window.location.pathname));
  return api;
};

function PlayerCompendium() {
  return <CompendiumBody api={playerApi()} viewer="player" />;
}

export const playerCompendiumWindow = defineWindow({
  ...compendiumWindowBase,
  clients: ["player"],
  component: PlayerCompendium,
});
