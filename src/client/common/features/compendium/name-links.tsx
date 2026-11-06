// FR-CMP-77 / FR-CMP-84: names that link to the compendium entry of that exact name and kind,
// matched when the list loads; rows store nothing. One provider per list (a sheet, the party
// inventory, the Loot log): one lookup (in batches of NAME_LOOKUP_MAX), again when its names
// change, the connection comes back or the Compendium refetches. No answer yet, an error, or no
// match: the name stays plain text.
import {
  NAME_LOOKUP_MAX,
  type NameLookupKind,
  type NameMatch,
  nameLookupKey,
} from "@shared/compendium/rest";
import { NAME_MAX } from "@shared/compendium/schemas";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { pageApi } from "../../session";
import { useSync } from "../../sync/store";
import { useOpenWindow } from "../play-shell/ShellContext";
import { CMP_ENTRY_KIND, CMP_KIND } from "./logic";
import { showSearch, useCmpNav } from "./nav";
import { popoutInstance } from "./popout";
import { eagerApi, LOOKUP_DEBOUNCE_MS, lookupCompendiumNames } from "./search";

export type LookupName = { kind: NameLookupKind; name: string };

/** Each kind + name once, in a stable order (the request's key); names no entry can have dropped. */
export function lookupNames(names: Iterable<LookupName>): LookupName[] {
  const out = new Map<string, LookupName>();
  for (const n of names) {
    const name = n.name.trim();
    if (name.length === 0 || name.length > NAME_MAX) continue;
    const key = nameLookupKey(n.kind, name);
    if (!out.has(key)) out.set(key, { kind: n.kind, name });
  }
  return [...out.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, n]) => n);
}

/** The request bodies for one lookup: NAME_LOOKUP_MAX names each. */
export function lookupBatches(names: readonly LookupName[]): LookupName[][] {
  const out: LookupName[][] = [];
  for (let i = 0; i < names.length; i += NAME_LOOKUP_MAX) {
    out.push(names.slice(i, i + NAME_LOOKUP_MAX));
  }
  return out;
}

export type NameLinkMap = ReadonlyMap<string, NameMatch>;

export const linkMap = (matches: readonly NameMatch[]): NameLinkMap =>
  new Map(matches.map((m) => [nameLookupKey(m.kind, m.name), m]));

/** What a name links to, trying `kinds` in order (first match wins), or null: plain text. */
export function linkOfKinds(
  links: NameLinkMap,
  kinds: readonly NameLookupKind[],
  name: string,
): NameMatch | null {
  for (const kind of kinds) {
    const m = links.get(nameLookupKey(kind, name));
    if (m) return m;
  }
  return null;
}

const NO_LINKS: NameLinkMap = new Map();
const LinksContext = createContext<NameLinkMap>(NO_LINKS);

/** The links of the nearest provider (none → no links). */
export const useNameLinks = () => useContext(LinksContext);

/** Holds a list's links; `off` (e.g. edit mode: names are inputs) sends no lookups. */
export function CompendiumNameLinks({
  client,
  names,
  off = false,
  children,
}: {
  client: "dm" | "player";
  names: Iterable<LookupName>;
  off?: boolean;
  children: ReactNode;
}) {
  const [links, setLinks] = useState(NO_LINKS);
  const live = useSync((s) => s.state === "live");
  const nonce = useCmpNav((s) => s.listNonce);
  const key = JSON.stringify(lookupNames(names));
  // biome-ignore lint/correctness/useExhaustiveDependencies: `nonce` asks again after the Compendium's own writes.
  useEffect(() => {
    if (off || !live) return;
    const asked = JSON.parse(key) as LookupName[];
    if (asked.length === 0) {
      setLinks(NO_LINKS);
      return;
    }
    let current = true;
    const t = setTimeout(() => {
      const api = eagerApi(pageApi(client));
      Promise.all(lookupBatches(asked).map((b) => lookupCompendiumNames(api, b))).then(
        (matches) => current && setLinks(linkMap(matches.flat())),
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

/** One entry → its own window (FR-CMP-76); several share the name → the Compendium on that search. */
function NameLink({
  link,
  name,
  rowId,
  testId,
}: {
  link: NameMatch;
  name: string;
  rowId?: string;
  testId: string;
}) {
  const openWindow = useOpenWindow();
  const { entryId, kind } = link;
  return (
    <button
      type="button"
      className={LINK_CLASS}
      data-testid={testId}
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

/** A name: a link to its entry (the first of `kinds` with a match), or plain text. */
export function LinkedName({
  kinds,
  name,
  rowId,
  testId,
}: {
  kinds: readonly NameLookupKind[];
  name: string;
  rowId?: string;
  testId: string;
}) {
  const link = linkOfKinds(useNameLinks(), kinds, name.trim());
  return link ? <NameLink link={link} name={name} rowId={rowId} testId={testId} /> : name;
}
