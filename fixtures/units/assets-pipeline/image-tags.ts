import { ingestStep } from "@server/features/assets-pipeline/fixtures";
import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";

/** A DM tag only Ruined Keep holds (walkthrough IM10 leak scan, FR-ASSET-50). */
const SECRET_TAG = "zz-lair-secret";

/** `[file under library/, name, tags]`, in ingest order (= manifest order). */
const LISTED: readonly (readonly [string, string, readonly string[]])[] = [
  ["elite-goblin", "Elite Goblin", ["Tokens", "Portraits"]],
  ["goblin-elder", "Goblin Elder", ["Tokens"]],
  ["goblin-archer", "Goblin Archer", ["Tokens"]],
  ["hobgoblin-captain", "Hobgoblin Captain", ["Tokens"]],
  ["wolf-pack-leader", "Wolf Pack Leader", ["Tokens"]],
  ["skeleton-guard", "Skeleton Guard", ["Tokens"]],
  ["bandit-captain", "Bandit Captain", ["Tokens"]],
  ["mira-portrait", "Mira Portrait", ["Portraits"]],
  ["thorn-portrait", "Thorn Portrait", ["Portraits"]],
  ["elder-sage", "Elder Sage", ["Portraits"]],
  ["goblin-cave", "Goblin Cave", ["Maps"]],
  ["forest-road", "Forest Road", ["Maps"]],
  ["ruined-keep", "Ruined Keep", ["Maps", SECRET_TAG]],
  ["harbour-town", "Harbour Town", ["Maps"]],
  ["wanted-poster-goblin-king", "Wanted Poster Goblin King", ["Handouts"]],
  ["treasure-map", "Treasure Map", ["Handouts"]],
  ["royal-seal-letter", "Royal Seal Letter", ["Handouts"]],
  ["wooden-chest", "Wooden Chest", ["Props"]],
  ["barrel-stack", "Barrel Stack", ["Props"]],
  ["campfire", "Campfire", ["Props"]],
  ["goblin-totem", "Goblin Totem", ["Props", "Items"]],
  ["elven-cloak", "Elven Cloak", ["Items"]],
  ["potion-bottle", "Potion Bottle", ["Items"]],
  ["misc-sketch", "Misc Sketch", []],
];

/** Attachments (`listed: false`), tagged Handouts: never in the library or any snapshot. */
const ATTACHMENTS: readonly (readonly [string, string])[] = [
  ["pasted-image", "Pasted image 2026-10-19 20:15"],
  ["ransom-sketch", "Ransom sketch"],
];

const file = (f: string) => `library/${f}.svg`;

/** Names and strings the IM tests and walkthrough look for (ASSET §13.1). */
export const IMAGE_TAGS_FIXTURE = {
  key: "image-tags",
  secretTag: SECRET_TAG,
  listed: LISTED.map(([, name, tags]) => ({ name, tags: [...tags] })),
  attachments: ATTACHMENTS.map(([, name]) => name),
  /** Committed, never ingested: walkthrough IM7 uploads it. */
  uploadFile: file("upload-ogre"),
} as const;

/**
 * ASSET §13.1 `image-tags` (setup; requires `images`): 24 **listed** images from
 * `fixtures/assets/library/` (each a distinct shape, colour and label bar, ≤ 2 KB) with their tags
 * via `ingestStep(file, {name, tags})` (FR-ASSET-41), incl. the DM tag `zz-lair-secret` on Ruined
 * Keep and Misc Sketch untagged (`[]`); then 2 attachments tagged Handouts. Only ingests: no
 * encounter, token or combatant write, so it loads on top of `session-sim-9`'s running fight.
 * Asset IDs by index: the 24 listed in table order, then the 2 attachments (`r.id(key, "asset")`).
 */
export default defineFixture({
  key: IMAGE_TAGS_FIXTURE.key,
  kind: "setup",
  requires: ["images"],
  ownerSpec: "assets-pipeline",
  assets: [...LISTED.map(([f]) => file(f)), ...ATTACHMENTS.map(([f]) => file(f))],
  steps: [
    ...LISTED.map(([f, name, tags]) => ingestStep(file(f), { name, tags: [...tags] })),
    ...ATTACHMENTS.map(([f, name]) =>
      ingestStep(file(f), { name, listed: false, tags: ["Handouts"] }),
    ),
  ],
});
