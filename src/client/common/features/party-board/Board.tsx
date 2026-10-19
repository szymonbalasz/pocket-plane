// `party.board` "Party" frame, both clients (FR-PARTY-11, -29): tabs Handouts, Inventory and Loot
// (choice remembered per browser, `seen.ts`; `openPartyTab` switches it, FR-PARTY-30). Each client
// passes its Handouts tab; Inventory and Loot (party-loot's body, FR-LOOT-21) are shared.
import { type ReactNode, useEffect, useSyncExternalStore } from "react";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useSync } from "../../sync/store";
import { LootLog } from "../party-loot/LootLog";
import { InventoryTab } from "./Inventory";
import { PARTY_TABS, type PartyTab } from "./logic";
import { tabKeyOf } from "./open-tab";
import { partyMemory } from "./seen";

const TAB_LABEL: Record<PartyTab, string> = {
  handouts: "Handouts",
  inventory: "Inventory",
  loot: "Loot",
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

export function PartyBoard({ handouts }: { handouts: ReactNode }) {
  const [tab, setTab] = useTabMemory();
  return (
    <div data-testid="party-board" className="flex h-full flex-col gap-2 p-2">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as PartyTab)}
        className="flex min-h-0 flex-1 flex-col gap-2"
      >
        <TabsList>
          {PARTY_TABS.map((t) => (
            <TabsTrigger key={t} value={t} data-testid="party-tab" data-value={t}>
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
      </Tabs>
    </div>
  );
}
