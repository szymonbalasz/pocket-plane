// `party.board` "Party" frame, both clients (FR-PARTY-11): tabs Handouts and Inventory (choice
// remembered per browser, `seen.ts`), and the "Coin: open Party loot" link to `loot.log`. Each
// client passes its Handouts tab; the Inventory tab is shared.
import { PARTY_ITEM_TYPE, type PartyItemRecord } from "@shared/party-board/schemas";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useLazyRecords, useSync } from "../../sync/store";
import { LOOT_LOG_KIND } from "../party-loot/logic";
import { useOpenWindow } from "../play-shell/ShellContext";
import { PARTY_TABS, type PartyTab } from "./logic";
import { partyMemory, tabKey } from "./seen";
import { LoadingRows, RetryLoad } from "./Viewer";

const TAB_LABEL: Record<PartyTab, string> = { handouts: "Handouts", inventory: "Inventory" };

/** FR-PARTY-11: the tab choice per browser, keyed like the layout (campaign + viewer). */
function useTabMemory(): [PartyTab, (t: PartyTab) => void] {
  const you = useSync((s) => s.store.you);
  const key = you ? tabKey(you.campaignId, you.role, you.playerId) : null;
  const [tab, setTab] = useState<PartyTab>("handouts");
  useEffect(() => {
    if (key) setTab(partyMemory().memory.readTab(key));
  }, [key]);
  const choose = (t: PartyTab) => {
    setTab(t);
    if (key) partyMemory().memory.writeTab(key, t);
  };
  return [tab, choose];
}

/** Read-only party inventory: name, qty, notes, by name (FR-PARTY-24's list; actions in P4). */
function InventoryTab() {
  const { rows, state, retry } = useLazyRecords<PartyItemRecord>(PARTY_ITEM_TYPE);
  const sorted = useMemo(
    () => [...rows].sort((a, b) => a.name.localeCompare(b.name) || a.seq - b.seq),
    [rows],
  );
  if (state === "error") return <RetryLoad onRetry={retry} />;
  if (state === "loading") return <LoadingRows testId="party-item-loading" />;
  if (sorted.length === 0) {
    return (
      <p data-testid="party-item-empty" className="p-2 text-sm text-muted-foreground">
        Party inventory is empty
      </p>
    );
  }
  return (
    <ul data-testid="party-item-list" className="flex flex-col divide-y">
      {sorted.map((i) => (
        <li
          key={i.id}
          data-testid="party-item-row"
          data-record-id={i.id}
          className="flex items-baseline gap-2 px-1 py-1.5 text-sm"
        >
          <span className="min-w-0 flex-1 truncate">{i.name}</span>
          <span className="tabular-nums text-muted-foreground">×{i.qty}</span>
          {i.notes && (
            <span className="max-w-[40%] truncate text-xs text-muted-foreground">{i.notes}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function PartyBoard({ handouts }: { handouts: ReactNode }) {
  const [tab, setTab] = useTabMemory();
  const openWindow = useOpenWindow();
  return (
    <div data-testid="party-board" className="flex h-full flex-col gap-2 p-2">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as PartyTab)}
        className="flex min-h-0 flex-1 flex-col gap-2"
      >
        <div className="flex items-center justify-between gap-2">
          <TabsList>
            {PARTY_TABS.map((t) => (
              <TabsTrigger key={t} value={t} data-testid="party-tab" data-value={t}>
                {TAB_LABEL[t]}
              </TabsTrigger>
            ))}
          </TabsList>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            data-testid="party-loot-link"
            onClick={() => openWindow(LOOT_LOG_KIND)}
          >
            Coin: open Party loot
          </Button>
        </div>
        <TabsContent value="handouts" className="flex min-h-0 flex-1 flex-col">
          {handouts}
        </TabsContent>
        <TabsContent value="inventory" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <InventoryTab />
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
