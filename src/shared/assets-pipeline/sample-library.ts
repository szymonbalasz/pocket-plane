// Test data for image search and the picker (ASSET §13.1): the DM's `asset` records as the
// `images` + `image-tags` fixture units load them (names, tags, ingest order). Unit tests only;
// the fixture units stay the source of truth (`fixtures/units/assets-pipeline/`).
import { type AssetRecord, pickerOrder } from "./schemas";

/** `[name, tags]` in ingest order: `images` (7), then `image-tags`' 24 listed images. */
const LIBRARY: readonly (readonly [string, readonly string[]])[] = [
  ["town", ["Maps"]],
  ["battlemap", ["Maps"]],
  ["token-mira", ["Tokens"]],
  ["token-goblin", ["Tokens"]],
  ["token-wolf", ["Tokens"]],
  ["token-elite", ["Tokens"]],
  ["token-thorn", ["Tokens"]],
  ["Elite Goblin", ["Tokens", "Portraits"]],
  ["Goblin Elder", ["Tokens"]],
  ["Goblin Archer", ["Tokens"]],
  ["Hobgoblin Captain", ["Tokens"]],
  ["Wolf Pack Leader", ["Tokens"]],
  ["Skeleton Guard", ["Tokens"]],
  ["Bandit Captain", ["Tokens"]],
  ["Mira Portrait", ["Portraits"]],
  ["Thorn Portrait", ["Portraits"]],
  ["Elder Sage", ["Portraits"]],
  ["Goblin Cave", ["Maps"]],
  ["Forest Road", ["Maps"]],
  ["Ruined Keep", ["Maps", "zz-lair-secret"]],
  ["Harbour Town", ["Maps"]],
  ["Wanted Poster Goblin King", ["Handouts"]],
  ["Treasure Map", ["Handouts"]],
  ["Royal Seal Letter", ["Handouts"]],
  ["Wooden Chest", ["Props"]],
  ["Barrel Stack", ["Props"]],
  ["Campfire", ["Props"]],
  ["Goblin Totem", ["Props", "Items"]],
  ["Elven Cloak", ["Items"]],
  ["Potion Bottle", ["Items"]],
  ["Misc Sketch", []],
];

/** Stable 22-char ids (`a00…`), one `createdAt` per image: later ingests sort first (FR-ASSET-10). */
export function sampleLibrary(): AssetRecord[] {
  return LIBRARY.map(([name, tags], i) => ({
    id: `a${String(i).padStart(21, "0")}`,
    campaignId: "c1",
    seq: i + 1,
    name,
    mime: "image/svg+xml",
    bytes: 1500,
    width: 256,
    height: 256,
    displayWidth: 256,
    displayHeight: 256,
    createdAt: `2026-10-19T12:00:${String(i).padStart(2, "0")}.000Z`,
    tags: [...tags],
  })).sort(pickerOrder);
}

/** The sample record named `name`. */
export function sampleNamed(lib: readonly AssetRecord[], name: string): AssetRecord {
  const a = lib.find((x) => x.name === name);
  if (!a) throw new Error(`no sample image ${name}`);
  return a;
}
