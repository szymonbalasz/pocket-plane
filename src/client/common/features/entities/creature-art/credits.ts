// Token art credits (FR-ENT-29): per creature type the game-icons.net icon, its author and page.
// Shown in the About dialog's "Token art" section (Compendium and Creatures "Credits" links);
// ATTRIBUTION.md lists the same rows (licence test).
import type { CreatureType } from "@shared/entities/schemas";

export const TOKEN_ART_LICENCE = "CC BY 3.0";
export const TOKEN_ART_LICENCE_URL = "https://creativecommons.org/licenses/by/3.0/";
export const TOKEN_ART_SITE = "game-icons.net";
export const TOKEN_ART_SITE_URL = "https://game-icons.net";

export type TokenArtAuthor = "Lorc" | "Delapouite";

export interface TokenArtCredit {
  /** game-icons.net icon name. */
  icon: string;
  author: TokenArtAuthor;
  url: string;
}

const credit = (icon: string, author: TokenArtAuthor): TokenArtCredit => ({
  icon,
  author,
  url: `https://game-icons.net/1x1/${author.toLowerCase()}/${icon}.html`,
});

export const TOKEN_ART_CREDITS: Readonly<Record<CreatureType, TokenArtCredit>> = {
  aberration: credit("tentacle-strike", "Lorc"),
  beast: credit("wolf-head", "Lorc"),
  celestial: credit("angel-wings", "Lorc"),
  construct: credit("golem-head", "Delapouite"),
  dragon: credit("dragon-head", "Lorc"),
  elemental: credit("fire-silhouette", "Lorc"),
  fey: credit("fairy", "Lorc"),
  fiend: credit("devil-mask", "Delapouite"),
  giant: credit("giant", "Delapouite"),
  humanoid: credit("visored-helm", "Lorc"),
  monstrosity: credit("hydra", "Lorc"),
  ooze: credit("slime", "Delapouite"),
  plant: credit("carnivorous-plant", "Delapouite"),
  undead: credit("dread-skull", "Lorc"),
};
