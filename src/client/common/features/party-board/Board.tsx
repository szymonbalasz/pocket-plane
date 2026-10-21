// `party.board` "Party" frame, both clients (FR-PARTY-11, -29, -41): tabs Handouts, Inventory, Loot
// and Companions (choice remembered per browser, `seen.ts`; `openPartyTab` switches it, FR-PARTY-30).
// Each client passes its Handouts tab (and the DM its Companions parts); Inventory, Loot
// (party-loot's body, FR-LOOT-21) and Companions are shared. FR-PARTY-46: the strip scrolls
// sideways where the four labels don't fit (the 340-px min width), never cutting one.
// FR-PARTY-50 (BL-48): a tab, once shown, stays mounted while the window is open (the others
// `hidden`, as minimised windows, FR-SHELL-36), so its drafts survive a tab switch; closing the
// window unmounts them all.
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useSync } from "../../sync/store";
import { LootLog } from "../party-loot/LootLog";
import { type CompanionsDmParts, CompanionsTab } from "./Companions";
import { InventoryTab } from "./Inventory";
import { PARTY_TABS, type PartyTab } from "./logic";
import { tabKeyOf } from "./open-tab";
import { partyMemory } from "./seen";

const TAB_LABEL: Record<PartyTab, string> = {
  handouts: "Handouts",
  inventory: "Inventory",
  loot: "Loot",
  companions: "Companions",
};

/** FR-PARTY-11: the tab choice per browser, keyed like the layout (campaign + viewer). */
function useTabMemory(): [PartyTab, (t: PartyTab) => void] {
  const key = useSync((s) => tabKeyOf(s.store.you));
  const { tabs } = partyMemory();
  useEffect(() => tabs.bind(key), [tabs, key]);
  const read = () => {
    const s = tabs.state.getState();
    return s.key === key ? s.tab : "handouts";
  };
  // Not zustand's `useStore`: its server snapshot is the initial state (static render tests).
  const tab = useSyncExternalStore(tabs.state.subscribe, read, read);
  return [tab, (t: PartyTab) => tabs.choose(key, t)];
}

/** FR-PARTY-50: tabs shown so far in this mount (each mounts on its first visit, then stays). */
function useVisited(tab: PartyTab): ReadonlySet<PartyTab> {
  const [visited, setVisited] = useState<ReadonlySet<PartyTab>>(() => new Set([tab]));
  if (!visited.has(tab)) {
    const next = new Set(visited).add(tab);
    setVisited(next);
    return next;
  }
  return visited;
}

export function PartyBoard({
  handouts,
  companions,
}: {
  handouts: ReactNode;
  /** DM: New pet… and the row menu (FR-PARTY-43). */
  companions?: CompanionsDmParts;
}) {
  const [tab, setTab] = useTabMemory();
  const visited = useVisited(tab);
  // Hidden panels take no pointer or key events and aren't focusable (`hidden`).
  const panel = (t: PartyTab, className: string, body: ReactNode) => (
    <TabsContent value={t} forceMount hidden={tab !== t} className={className}>
      {visited.has(t) ? body : null}
    </TabsContent>
  );
  return (
    <div data-testid="party-board" className="flex h-full flex-col gap-2 p-2">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as PartyTab)}
        className="flex min-h-0 flex-1 flex-col gap-2"
      >
        <TabsList
          data-testid="party-tabs"
          className="w-full max-w-full justify-start overflow-x-auto overflow-y-hidden"
        >
          {PARTY_TABS.map((t) => (
            <TabsTrigger
              key={t}
              value={t}
              data-testid="party-tab"
              data-value={t}
              className="shrink-0"
            >
              {TAB_LABEL[t]}
            </TabsTrigger>
          ))}
        </TabsList>
        {panel("handouts", "flex min-h-0 flex-1 flex-col", handouts)}
        {panel(
          "inventory",
          "min-h-0 flex-1",
          <ScrollArea className="h-full">
            <InventoryTab />
          </ScrollArea>,
        )}
        {panel("loot", "min-h-0 flex-1", <LootLog />)}
        {panel("companions", "min-h-0 flex-1", <CompanionsTab dm={companions} />)}
      </Tabs>
    </div>
  );
}
