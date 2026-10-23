// Mini recorded Open5e set (CMP §13 `cmp-srd-mini`), as TS modules per AGENTS §9.3. Same records
// as the bundled `srd-5.1` files, `wotc-srd` only; licence test: FR-CMP-06.
import type { Open5eResponses } from "@server/features/compendium/adapter/open5e";
import { armor } from "./armor";
import { classes } from "./classes";
import { conditions } from "./conditions";
import { magicitems } from "./magicitems";
import { monsters } from "./monsters";
import { sections } from "./sections";
import { spells } from "./spells";
import { weapons } from "./weapons";

/** Source `version` of the mini set (CMP §13: the bundled version differs, so **Update** shows). */
export const SRD_MINI_VERSION = "mini";

export const srdMini: Open5eResponses = {
  monsters,
  spells,
  magicitems,
  weapons,
  armor,
  conditions,
  classes,
};

/**
 * CMP §13.3 `cmp-rules-mini`: the mini `sections` set (Actions in Combat, Attacking, Cover, Damage
 * and Healing, Movement). Not in `srdMini`, so bundles with `cmp-srd-mini` hold no rule cards.
 */
export const rulesMini: Open5eResponses = { sections };
