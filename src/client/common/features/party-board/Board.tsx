// `party.board` "Party Manager" frame, both clients (FR-PARTY-11, -59, -60, -67): the tabs of the
// registry (`party-tabs.ts`: Party status, Handouts, Inventory, Loot, then RS's), visible ones
// only, choice remembered per browser (`seen.ts`; `openPartyTab` switches it, FR-PARTY-30); Party
// status the first time and whenever the stored tab isn't shown. Each client passes its parts
// (Handouts; the DM's companion parts). FR-PARTY-46: the strip scrolls sideways where the labels
// don't fit, never cutting one. FR-PARTY-50 / -66: a tab, once shown, stays mounted while the
// window is open (the others `hidden`, as minimised windows, FR-SHELL-36), so its drafts survive a
// tab switch; closing the window unmounts them all.
import { useEffect, useState, useSyncExternalStore } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useSync } from "../../sync/store";
import type { PartyTab } from "./logic";
import { tabKeyOf } from "./open-tab";
import { type PartyTabParts, partyTabs, shownTab, visibleTabIds } from "./party-tabs";
import { partyMemory } from "./seen";

/** FR-PARTY-11: the stored tab choice per browser, keyed like the layout (campaign + viewer). */
function useTabMemory(): [PartyTab | null, (t: PartyTab) => void] {
  const key = useSync((s) => tabKeyOf(s.store.you));
  const { tabs } = partyMemory();
  useEffect(() => tabs.bind(key), [tabs, key]);
  const read = () => {
    const s = tabs.state.getState();
    return s.key === key ? s.tab : null;
  };
  // Not zustand's `useStore`: its server snapshot is the initial state (static render tests).
  const tab = useSyncExternalStore(tabs.state.subscribe, read, read);
  return [tab, (t: PartyTab) => tabs.choose(key, t)];
}

/** FR-PARTY-67: the visible tab ids, re-read on store changes (one string, stable). */
function useVisibleTabs(): string[] {
  const ids = useSync((s) =>
    visibleTabIds({
      role: s.store.you?.role ?? "player",
      playerId: s.store.you?.playerId ?? null,
      store: s.store,
    }).join("\n"),
  );
  return ids.split("\n");
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

export function PartyBoard({ parts }: { parts: PartyTabParts }) {
  const [stored, setTab] = useTabMemory();
  const visible = useVisibleTabs();
  const tab = shownTab(stored, visible);
  const visited = useVisited(tab);
  const tabs = partyTabs().filter((t) => visible.includes(t.id));
  return (
    <div data-testid="party-board" className="flex h-full flex-col gap-2 p-2">
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-2">
        <TabsList
          data-testid="party-tabs"
          className="w-full max-w-full justify-start overflow-x-auto overflow-y-hidden"
        >
          {tabs.map((t) => (
            <TabsTrigger
              key={t.id}
              value={t.id}
              data-testid="party-tab"
              data-value={t.id}
              className="shrink-0"
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {/* Hidden panels take no pointer or key events and aren't focusable (`hidden`). */}
        {tabs.map((t) => (
          <TabsContent
            key={t.id}
            value={t.id}
            forceMount
            hidden={tab !== t.id}
            className="min-h-0 flex-1"
          >
            {visited.has(t.id) ? t.render(parts) : null}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
