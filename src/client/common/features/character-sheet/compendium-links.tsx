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

/** The kinds a list's names can be, first match wins: an attack is a weapon, else a spell. */
const KINDS: Readonly<Record<LinkedList, readonly NameLookupKind[]>> = {
  attacks: ["item", "spell"],
  spells: ["spell"],
  features: ["feature"],
  items: ["item"],
};

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
  return lookupNames(out);
}

export type SheetLinkMap = NameLinkMap;
export { linkMap };

/** What this row's name links to, or null: plain text. */
export const linkOf = (links: SheetLinkMap, list: LinkedList, name: string): NameMatch | null =>
  linkOfKinds(links, KINDS[list], name);

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

/** A row's name in view mode: a link to its entry, or plain text. */
export function CompendiumName({
  list,
  name,
  rowId,
}: {
  list: LinkedList;
  name: string;
  rowId?: string;
}) {
  return (
    <LinkedName kinds={KINDS[list]} name={name} rowId={rowId} testId="charx-compendium-link" />
  );
}
