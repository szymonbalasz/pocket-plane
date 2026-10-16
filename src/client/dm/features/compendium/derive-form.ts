// Derive… form model (FR-CMP-27), pure: the creature core prefilled from the monster entry's
// definition (name, size, CR, AC, HP max + formula, initiative, speed); every other stat block
// field (attacks, scores, saves, senses) is kept from the definition. Copy text on by default.
import type { EntryDefinition } from "@shared/compendium/rest";
import { hpAverage, parseHpFormula } from "@shared/entities/hp-formula";
import { MonsterStatBlock } from "@shared/entities/schemas";

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

/** "Average N" for a valid HP formula, else null. */
export function formulaAverage(formula: string): number | null {
  return formula.trim() !== "" && parseHpFormula(formula) ? hpAverage(formula) : null;
}

/** The derived stat block: the definition's with the shown fields replaced, validated. */
export function deriveStatBlock(
  f: DeriveFields,
  d: Pick<EntryDefinition, "statBlock">,
): { ok: true; value: MonsterStatBlock } | { ok: false; message: string } {
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
