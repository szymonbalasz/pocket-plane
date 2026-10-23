// FR-PARTY-67 (seams S1): Party Manager's tab registry, **append-only** (AGENTS §9.9). Entry =
// `{ id, label, order, visible?(viewer), render }`: rendered in `order`, visible ones only;
// `visible` (absent = always) is re-read on store changes; `render(parts)` gets the client's parts
// (each board window passes its own). PM2: Party status 10, Handouts 20, Inventory 30, Loot 40;
// RS appends Reminders 50, Strongholds 60. Tab memory accepts any registered id; one not
// registered or not visible shows Party status (FR-PARTY-60).
import type { RecordStore } from "@shared/protocol/store";
import { createElement, type ReactNode } from "react";
import { ScrollArea } from "../../components/ui/scroll-area";
import { LootLog } from "../party-loot/LootLog";
import type { CompanionsDmParts } from "./Companions";
import { InventoryTab } from "./Inventory";
import { STATUS_TAB } from "./logic";
import { StatusTab } from "./StatusTab";

/** Who a tab is for: client role, player id and the store (FR-PARTY-67). */
export interface PartyTabViewer {
  role: "dm" | "player";
  playerId: string | null;
  store: RecordStore;
}

/** Each client's parts; a track adds its own keys here. */
export interface PartyTabParts {
  /** The client's Handouts tab body (FR-PARTY-12, -13). */
  handouts: ReactNode;
  /** DM: New pet… and the pet row menu (FR-PARTY-62). */
  companions?: CompanionsDmParts;
}

export interface PartyTabEntry {
  id: string;
  label: string;
  order: number;
  visible?(viewer: PartyTabViewer): boolean;
  render(parts: PartyTabParts): ReactNode;
}

export const PARTY_TAB_ENTRIES: readonly PartyTabEntry[] = [
  {
    id: STATUS_TAB,
    label: "Party status",
    order: 10,
    render: (p) => createElement(StatusTab, { dm: p.companions }),
  },
  {
    id: "handouts",
    label: "Handouts",
    order: 20,
    render: (p) => createElement("div", { className: "flex h-full min-h-0 flex-col" }, p.handouts),
  },
  {
    id: "inventory",
    label: "Inventory",
    order: 30,
    render: () => createElement(ScrollArea, { className: "h-full" }, createElement(InventoryTab)),
  },
  { id: "loot", label: "Loot", order: 40, render: () => createElement(LootLog) },
];

/** The registered tabs in `order` (FR-PARTY-67). */
export const partyTabs = (entries: readonly PartyTabEntry[] = PARTY_TAB_ENTRIES) =>
  [...entries].sort((a, b) => a.order - b.order);

/** The ids of the tabs this viewer sees now, in order. */
export const visibleTabIds = (
  viewer: PartyTabViewer,
  entries: readonly PartyTabEntry[] = PARTY_TAB_ENTRIES,
) => partyTabs(entries).flatMap((t) => (!t.visible || t.visible(viewer) ? [t.id] : []));

/**
 * FR-PARTY-60: the tab shown for a stored one: itself while visible; nothing stored, `companions`
 * (retired), unknown or not visible now → Party status. The stored value itself is never changed
 * here, so a tab that turns visible again comes back.
 */
export const shownTab = (stored: string | null, visible: readonly string[]) =>
  stored !== null && visible.includes(stored) ? stored : STATUS_TAB;
