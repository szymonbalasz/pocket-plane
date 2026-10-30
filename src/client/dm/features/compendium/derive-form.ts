// Derive… form model (FR-CMP-27), pure: the creature core prefilled from the monster entry's
// definition (name, size, CR, AC, HP max + formula, initiative, speed); every other stat block
// field (attacks, scores, saves, senses) is kept from the definition. Copy text on by default.
import type { EntryDefinition } from "@shared/compendium/rest";
import type { FacetsOf } from "@shared/compendium/schemas";
import { hpAverage, parseHpFormula } from "@shared/entities/hp-formula";
import { CreatureType, MonsterStatBlock } from "@shared/entities/schemas";

export interface DeriveFields {
  name: string;
  size: string;
  cr: string;
  ac: string;
  hpMax: string;
  hpFormula: string;
  initBonus: string;
  speed: string;
  copyText: boolean;
}

export function initialDerive(
  entryName: string,
  d: Pick<EntryDefinition, "statBlock">,
): DeriveFields {
  const sb = d.statBlock;
  return {
    name: entryName,
    size: sb.size,
    cr: sb.cr,
    ac: String(sb.ac),
    hpMax: String(sb.hpMax),
    hpFormula: sb.hpFormula ?? "",
    initBonus: String(sb.initBonus),
    speed: sb.speed === undefined ? "" : String(sb.speed),
    copyText: true,
  };
}

export type MonsterFacets = FacetsOf<"monster">;

/**
 * FR-CMPX-08: what an entry-only monster's form derives from: its facets, nothing else. The AC and
 * HP here never reach the result: the form starts them empty and `deriveStatBlock` requires them.
 */
export function entryOnlyBase(facets: MonsterFacets): Pick<EntryDefinition, "statBlock"> {
  const type = CreatureType.safeParse(facets.type);
  return {
    statBlock: {
      size: facets.size,
      cr: facets.cr,
      ac: 10,
      hpMax: 1,
      initBonus: 0,
      attacks: [],
      ...(type.success ? { type: type.data } : {}),
    },
  };
}

/** "Average N" for a valid HP formula, else null. */
export function formulaAverage(formula: string): number | null {
  return formula.trim() !== "" && parseHpFormula(formula) ? hpAverage(formula) : null;
}

/** The derived stat block: the definition's with the shown fields replaced, validated. */
export function deriveStatBlock(
  f: DeriveFields,
  d: Pick<EntryDefinition, "statBlock">,
): { ok: true; value: MonsterStatBlock } | { ok: false; message: string } {
  // `Number("")` is 0, a valid AC: an empty box (FR-CMPX-08) must not pass as one.
  if (f.ac.trim() === "") return { ok: false, message: "AC: Required" };
  if (f.hpMax.trim() === "") return { ok: false, message: "HP max: Required" };
  const { hpFormula: _f, speed: _s, ...rest } = d.statBlock;
  const formula = f.hpFormula.trim();
  const p = MonsterStatBlock.safeParse({
    ...rest,
    size: f.size,
    cr: f.cr,
    ac: Number(f.ac),
    hpMax: Number(f.hpMax),
    initBonus: Number(f.initBonus),
    ...(formula ? { hpFormula: formula } : {}),
    ...(f.speed.trim() !== "" ? { speed: Number(f.speed) } : {}),
  });
  if (p.success) return { ok: true, value: p.data };
  const i = p.error.issues[0];
  return {
    ok: false,
    message: i ? `${i.path.join(".") || "Stat block"}: ${i.message}` : "Invalid",
  };
}
