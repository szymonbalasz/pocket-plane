// `cmp.deriveMonster` (FR-CMP-27, OQ-CMP-08): a custom monster from a monster entry, in one
// transaction: entities' `createIn` (derive from the entry's definition, FR-ENT-09) and, if
// `copyText`, the NPC sheet's Features rows (CHARX internal row insert). Events: `EntityCreated`,
// then the sheet's `CharacterSheetEdited`. A bad body or a failed row → nothing written.
import {
  clip,
  DERIVE_NAME_MAX,
  DERIVE_ROWS_MAX,
  DeriveMonsterBody,
  ROW_SOURCE_MAX,
  ROW_TEXT_MAX,
} from "@shared/compendium/homebrew";
import { bookAbbr } from "@shared/compendium/match";
import type { BodyOf, StatBlockSection } from "@shared/compendium/schemas";
import type { EntityRecord } from "@shared/entities/schemas";
import { EntityCreated } from "@shared/events/entities";
import { eq } from "drizzle-orm";
import { defineCommand } from "../../commands/commands";
import { invalid, notFound } from "../../commands/errors";
import type { Tx } from "../../db/client";
import { compendiumSource } from "../../db/schema";
import { insertSheetRows } from "../character-sheet/row-insert";
import { createIn } from "../entities/commands";
import { getEntry } from "./entries";
import { campaignOf } from "./homebrew";

export const DERIVE_MONSTER = "cmp.deriveMonster";
const ENTRY_NOT_FOUND = "Entry not found";

/** A book: its abbreviation ("MM", FR-CMPX-16); other imported: the source's name ("SRD 5.1"); homebrew: "Homebrew". */
export function sourceLabelOf(tx: Tx, source: string | null): string {
  if (source === null) return "Homebrew";
  const abbr = bookAbbr(source);
  if (abbr !== null) return clip(abbr, ROW_SOURCE_MAX);
  const row = tx
    .select({ name: compendiumSource.name })
    .from(compendiumSource)
    .where(eq(compendiumSource.key, source))
    .get();
  return clip(row?.name ?? source, ROW_SOURCE_MAX);
}

/**
 * FR-CMP-27's rows: traits, then actions (and bonus actions) without a mapped attack on the new
 * creature, reactions, legendary actions; name ≤ 60, text clipped to 600, ≤ 30 rows.
 */
export function featureRowsOf(
  body: BodyOf<"monster">,
  attackNames: readonly string[],
  source: string,
) {
  const mapped = new Set(attackNames.map((n) => n.trim().toLowerCase()));
  const unmapped = (s: StatBlockSection) => !mapped.has(s.name.trim().toLowerCase());
  const sections = [
    ...body.traits,
    ...body.actions.filter(unmapped),
    ...body.bonusActions.filter(unmapped),
    ...body.reactions,
    ...(body.legendary?.actions ?? []),
  ];
  return sections.slice(0, DERIVE_ROWS_MAX).map((s) => ({
    name: clip(s.name, DERIVE_NAME_MAX),
    source,
    text: clip(s.text, ROW_TEXT_MAX),
  }));
}

export const deriveMonster = defineCommand({
  name: DERIVE_MONSTER,
  input: DeriveMonsterBody,
  execute({ entryId, entity: body, copyText }, env): { entity: EntityRecord } {
    const cid = campaignOf(env);
    const e = getEntry(env.tx, entryId);
    if (!e || (e.campaignId !== null && e.campaignId !== cid)) throw notFound(ENTRY_NOT_FOUND);
    if (e.kind !== "monster") {
      throw invalid("Only monster entries derive a creature", [
        { path: ["entryId"], message: "Not a monster entry" },
      ]);
    }
    const { record, change } = createIn(env, {
      ...body,
      kind: "monster",
      // FR-CMPX-08: an entry-only monster has no definition to derive from; the form filled it in.
      ...(e.definitionId === null ? {} : { derivedFromId: e.definitionId }),
    });
    env.emit({
      type: EntityCreated.type,
      campaignId: record.campaignId,
      payload: {
        entityId: record.id,
        kind: record.kind,
        ...(record.derivedFromId ? { derivedFromId: record.derivedFromId } : {}),
      },
      changes: [change],
    });
    if (copyText && record.kind === "monster") {
      const rows = featureRowsOf(
        e.body as BodyOf<"monster">,
        record.statBlock.attacks.map((a) => a.name),
        sourceLabelOf(env.tx, e.source),
      );
      if (rows.length > 0) insertSheetRows(env, record.id, { list: "features", rows });
    }
    return { entity: record };
  },
});
