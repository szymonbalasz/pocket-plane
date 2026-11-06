// FR-CMP-77: a sheet row's name links to its compendium entry, matched by exact name when the sheet
// loads; rows store nothing. One lookup per sheet, again when its names change, the connection comes
// back or the Compendium refetches. No answer yet, an error, or no match: the name stays plain text.
// The lookup and the link: compendium/name-links (shared with the party inventory, FR-CMP-84).
import type { SheetData } from "@shared/character-sheet/sheet";
import type { NameLookupKind, NameMatch } from "@shared/compendium/rest";
import type { Attack } from "@shared/entities/schemas";
import type { ReactNode } from "react";
import {
  CompendiumNameLinks,
  LinkedName,
  type LookupName,
  linkMap,
  linkOfKinds,
  lookupNames,
  type NameLinkMap,
} from "../compendium/name-links";

export type LinkedList = "attacks" | "spells" | "features" | "items";

/** The kinds a list's names can be, first match wins: an attack is a weapon, else a spell; a
 * feature is a class feature, else a feat, a class option, an item (FR-CMPX-36). */
const KINDS: Readonly<Record<LinkedList, readonly NameLookupKind[]>> = {
  attacks: ["item", "spell"],
  spells: ["spell"],
  features: ["feature", "feat", "option", "item"],
  items: ["item"],
};

/** A feature row no name matches links by its source: a race trait to its race, a background's
 * feature to its background (FR-CMPX-36). */
const SOURCE_KINDS: readonly NameLookupKind[] = ["race", "background"];

/** One sheet's lookup: each kind + name once, in a stable order (the request's key). */
export function namesToLookUp(
  sheet: Pick<SheetData, "spells" | "features" | "items">,
  attacks: readonly Pick<Attack, "name">[],
): LookupName[] {
  const rows: [LinkedList, readonly { name: string }[]][] = [
    ["attacks", attacks],
    ["spells", sheet.spells],
    ["features", sheet.features],
    ["items", sheet.items],
  ];
  const out: LookupName[] = [];
  for (const [list, named] of rows) {
    for (const { name } of named) for (const kind of KINDS[list]) out.push({ kind, name });
  }
  for (const { source } of sheet.features) {
    if (source) for (const kind of SOURCE_KINDS) out.push({ kind, name: source });
  }
  return lookupNames(out);
}

export type SheetLinkMap = NameLinkMap;
export { linkMap };

/** What this row's name links to (a feature row: else its source), or null: plain text. */
export const linkOf = (
  links: SheetLinkMap,
  list: LinkedList,
  name: string,
  source?: string,
): NameMatch | null =>
  linkOfKinds(links, KINDS[list], name) ??
  (list === "features" && source ? linkOfKinds(links, SOURCE_KINDS, source) : null);

/** Holds a sheet's links; `off` (edit mode: names are inputs) sends no lookups. */
export function SheetLinks({
  client,
  sheet,
  attacks,
  off,
  children,
}: {
  client: "dm" | "player";
  sheet: Pick<SheetData, "spells" | "features" | "items">;
  attacks: readonly Pick<Attack, "name">[];
  off: boolean;
  children: ReactNode;
}) {
  return (
    <CompendiumNameLinks client={client} names={namesToLookUp(sheet, attacks)} off={off}>
      {children}
    </CompendiumNameLinks>
  );
}

/** A row's name in view mode: a link to its entry (a feature row: else its source's), or plain text. */
export function CompendiumName({
  list,
  name,
  source,
  rowId,
}: {
  list: LinkedList;
  name: string;
  source?: string;
  rowId?: string;
}) {
  const via = list === "features" && source ? { kinds: SOURCE_KINDS, name: source } : undefined;
  return (
    <LinkedName
      kinds={KINDS[list]}
      name={name}
      via={via}
      rowId={rowId}
      testId="charx-compendium-link"
    />
  );
}
