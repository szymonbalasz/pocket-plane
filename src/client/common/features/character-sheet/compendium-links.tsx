// FR-CMP-77: a sheet row's name links to its compendium entry, matched by exact name when the sheet
// loads; rows store nothing. One lookup per sheet, again when its names change, the connection comes
// back or the Compendium refetches. No answer yet, an error, or no match: the name stays plain text.
import type { SheetData } from "@shared/character-sheet/sheet";
import { type NameLookupKind, type NameMatch, nameLookupKey } from "@shared/compendium/rest";
import type { Attack } from "@shared/entities/schemas";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { pageApi } from "../../session";
import { useSync } from "../../sync/store";
import { CMP_ENTRY_KIND, CMP_KIND } from "../compendium/logic";
import { showSearch, useCmpNav } from "../compendium/nav";
import { popoutInstance } from "../compendium/popout";
import { eagerApi, LOOKUP_DEBOUNCE_MS, lookupCompendiumNames } from "../compendium/search";
import { useOpenWindow } from "../play-shell/ShellContext";

export type LinkedList = "attacks" | "spells" | "features" | "items";

/** The kinds a list's names can be, first match wins: an attack is a weapon, else a spell. */
const KINDS: Readonly<Record<LinkedList, readonly NameLookupKind[]>> = {
  attacks: ["item", "spell"],
  spells: ["spell"],
  features: ["feature"],
  items: ["item"],
};

type LookupName = { kind: NameLookupKind; name: string };

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
  const out = new Map<string, LookupName>();
  for (const [list, named] of rows) {
    for (const { name } of named) {
      for (const kind of KINDS[list]) out.set(nameLookupKey(kind, name), { kind, name });
    }
  }
  return [...out.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, n]) => n);
}

export type SheetLinkMap = ReadonlyMap<string, NameMatch>;

export const linkMap = (matches: readonly NameMatch[]): SheetLinkMap =>
  new Map(matches.map((m) => [nameLookupKey(m.kind, m.name), m]));

/** What this row's name links to, or null: plain text. */
export function linkOf(links: SheetLinkMap, list: LinkedList, name: string): NameMatch | null {
  for (const kind of KINDS[list]) {
    const m = links.get(nameLookupKey(kind, name));
    if (m) return m;
  }
  return null;
}

const NO_LINKS: SheetLinkMap = new Map();
const LinksContext = createContext<SheetLinkMap>(NO_LINKS);

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
  const [links, setLinks] = useState(NO_LINKS);
  const live = useSync((s) => s.state === "live");
  const nonce = useCmpNav((s) => s.listNonce);
  const key = JSON.stringify(namesToLookUp(sheet, attacks));
  // biome-ignore lint/correctness/useExhaustiveDependencies: `nonce` asks again after the Compendium's own writes.
  useEffect(() => {
    if (off || !live) return;
    const names = JSON.parse(key) as LookupName[];
    if (names.length === 0) {
      setLinks(NO_LINKS);
      return;
    }
    let current = true;
    const t = setTimeout(() => {
      lookupCompendiumNames(eagerApi(pageApi(client)), names).then(
        (matches) => current && setLinks(linkMap(matches)),
        // Plain names are a fine answer to a failed lookup; the next change asks again.
        () => {},
      );
    }, LOOKUP_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(t);
    };
  }, [client, key, off, live, nonce]);
  return <LinksContext.Provider value={links}>{children}</LinksContext.Provider>;
}

const LINK_CLASS =
  "cursor-pointer text-left [overflow-wrap:anywhere] underline decoration-dotted decoration-muted-foreground/60 underline-offset-2 hover:decoration-solid print:no-underline";

function NameLink({ link, name, rowId }: { link: NameMatch; name: string; rowId?: string }) {
  const openWindow = useOpenWindow();
  const { entryId, kind } = link;
  return (
    <button
      type="button"
      className={LINK_CLASS}
      data-testid="charx-compendium-link"
      data-record-id={rowId}
      data-entry-id={entryId ?? undefined}
      data-kind={kind}
      onClick={() => {
        if (entryId !== null) {
          openWindow(CMP_ENTRY_KIND, popoutInstance({ mode: "entry", entryId }), { by: "user" });
          return;
        }
        showSearch(name, kind);
        openWindow(CMP_KIND, undefined, { by: "user" });
      }}
    >
      {name}
    </button>
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
  const link = linkOf(useContext(LinksContext), list, name);
  return link ? <NameLink link={link} name={name} rowId={rowId} /> : name;
}
