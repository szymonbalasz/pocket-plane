// `party.board` "Party" frame, both clients (FR-PARTY-11, -29, -41): tabs Handouts, Inventory, Loot
// and Companions (choice remembered per browser, `seen.ts`; `openPartyTab` switches it, FR-PARTY-30).
// Each client passes its Handouts tab (and the DM its Companions parts); Inventory, Loot
// (party-loot's body, FR-LOOT-21) and Companions are shared. FR-PARTY-46: the strip scrolls
// sideways where the four labels don't fit (the 340-px min width), never cutting one.
import { type ReactNode, useEffect, useSyncExternalStore } from "react";
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

export function PartyBoard({
  handouts,
  companions,
}: {
  handouts: ReactNode;
  /** DM: New pet… and the row menu (FR-PARTY-43). */
  companions?: CompanionsDmParts;
}) {
  const [tab, setTab] = useTabMemory();
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
        <TabsContent value="handouts" className="flex min-h-0 flex-1 flex-col">
          {handouts}
        </TabsContent>
        <TabsContent value="inventory" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <InventoryTab />
          </ScrollArea>
        </TabsContent>
        <TabsContent value="loot" className="min-h-0 flex-1">
          <LootLog />
        </TabsContent>
        <TabsContent value="companions" className="min-h-0 flex-1">
          <CompanionsTab dm={companions} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
