import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { lootMove } from "@server/features/party-loot/commands";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import type { Endpoint } from "@shared/party-loot/schemas";

type R = { id(k: string, t: string): string };
const mira = (r: R): Endpoint => ({
  kind: "character",
  characterId: r.id("char-mira", ENTITY_TYPE),
});
const thorn = (r: R): Endpoint => ({
  kind: "character",
  characterId: r.id("char-thorn", ENTITY_TYPE),
});
const party: Endpoint = { kind: "party" };
const outside: Endpoint = { kind: "world" };

/**
 * LOOT §13 coin moves: m1 pot → Mira 20 gp; m2 pot → Thorn 10 gp 30 sp; m3 Thorn → Mira 2 gp
 * "Rations"; m4 Mira → Outside 1 gp "Rope". Pot 5 pp, 30 gp; Mira 21 gp; Thorn 8 gp 30 sp.
 */
export default defineFixture({
  key: "loot-wallets",
  kind: "setup",
  requires: ["loot-1", "char-mira", "char-thorn"],
  ownerSpec: "party-loot",
  steps: [
    step(lootMove, (r) => ({ from: party, to: mira(r), gp: 20 })),
    step(lootMove, (r) => ({ from: party, to: thorn(r), gp: 10, sp: 30 })),
    step(lootMove, (r) => ({ from: thorn(r), to: mira(r), gp: 2, text: "Rations" })),
    step(lootMove, (r) => ({ from: mira(r), to: outside, gp: 1, text: "Rope" })),
  ],
});
