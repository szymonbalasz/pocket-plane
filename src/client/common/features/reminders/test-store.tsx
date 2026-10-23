// Test-only fixtures for the reminders client tests: the bundle's names (Mira = player-1's,
// Thorn = player-2's; REM-* strings as FR-REM-27) as each viewer holds them, and a static render
// over a fake sync store (`reminder` loaded or not). Clicks and the real layout: e2e/rem-ui.e2e.ts.
import { EFFECT_TYPE } from "@shared/combat-extras/schemas";
import { ENCOUNTER_TYPE } from "@shared/combat-tracker/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import type { You } from "@shared/protocol/frames";
import { type LazyState, lazyAfterSnapshot, markLoaded } from "@shared/protocol/lazy";
import { emptyStore, type RecordMap } from "@shared/protocol/store";
import {
  REMINDER_TYPE,
  type ReminderRecord,
  type ReminderView,
  redactReminder,
  reminderVisibility,
} from "@shared/reminders/schemas";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { TooltipProvider } from "../../components/ui/overlays";
import { SyncContext, type SyncState } from "../../sync/store";
import { createWindowRegistry } from "../play-shell/registry";
import { ShellProvider } from "../play-shell/ShellContext";

export const DM: You = { campaignId: "c", role: "dm", playerId: null };
export const P1: You = { campaignId: "c", role: "player", playerId: "p1" };
export const P2: You = { campaignId: "c", role: "player", playerId: "p2" };

const pc = (id: string, name: string, owner: string) => ({
  id,
  kind: "character",
  campaignId: "c",
  name,
  ownerPlayerId: owner,
  portraitAssetId: null,
});
export const ENTITIES = [
  pc("mira", "Mira", "p1"),
  pc("thorn", "Thorn", "p2"),
  { id: "gob", kind: "monster", campaignId: "c", name: "Goblin", ownerPlayerId: null },
];

let n = 0;
const rem = (o: Partial<ReminderRecord> & Pick<ReminderRecord, "id" | "text">): ReminderRecord => {
  n += 1;
  return {
    campaignId: "c",
    seq: n,
    characterId: null,
    source: "",
    rolls: [],
    strongholdId: null,
    facilityId: null,
    createdByPlayerId: null,
    createdAt: `2026-01-01T00:00:00.00${n}Z`,
    updatedAt: `2026-01-01T00:00:00.00${n}Z`,
    dmOnly: false,
    ownerPlayerId: o.characterId === "mira" ? "p1" : o.characterId === "thorn" ? "p2" : null,
    linkHidden: false,
    ...o,
  };
};

/** The DM's rows, in creation order. */
export const REMINDERS: ReminderRecord[] = [
  rem({ id: "r-bread", text: "Fresh bread: +1 HP on a short rest\nAsk the cook" }),
  rem({
    id: "r-steam",
    text: "Steam Rooms: advantage on the first CON save after a long rest",
    source: "Greystone Keep: Steam Rooms",
    strongholdId: "h-grey",
    facilityId: "f-steam",
    rolls: [{ id: "rl-steam", label: "Steam", expression: "1d20", category: "saving-throw" }],
  }),
  rem({
    id: "r-charm",
    characterId: "mira",
    text: "REM-MIRA-CHARM Lucky charm: once a day add 1d4 to a save",
    rolls: [{ id: "rl-charm", label: "Charm", expression: "1d4", category: "saving-throw" }],
  }),
  rem({
    id: "r-thorn-own",
    characterId: "thorn",
    text: "REM-THORN-OWN Owe Brenna 20 gp",
    createdByPlayerId: "p2",
  }),
  rem({
    id: "r-thorn-secret",
    characterId: "thorn",
    text: "REM-SECRET-THORN The blade is cursed",
    dmOnly: true,
  }),
  rem({
    id: "r-vault",
    text: "REM-SECRET-VAULT <b>vault</b>",
    strongholdId: "h-tower",
    linkHidden: true,
  }),
];

/** What a viewer holds of `rows` (FR-REM-13, the shared rule the server applies). */
export function viewOf(rows: readonly ReminderRecord[], you: You): ReminderView[] {
  return rows.flatMap((r) => {
    const v = reminderVisibility(r, you);
    return v === "hidden" ? [] : [v === "full" ? r : redactReminder(r)];
  });
}

const byId = <T extends { id: string }>(rows: readonly T[]) =>
  Object.fromEntries(rows.map((r) => [r.id, r]));

export interface StoreOpts {
  rows?: readonly ReminderRecord[];
  /** `reminder` state: loaded (default), still loading, or failed. */
  lazy?: "ready" | "loading" | "error";
  live?: boolean;
  effects?: readonly Record<string, unknown>[];
  round?: number | null;
  sent?: [string, unknown][];
}

export function syncStore(you: You, o: StoreOpts = {}) {
  let lazy: LazyState = lazyAfterSnapshot(1);
  const state = o.lazy ?? "ready";
  if (state === "ready") lazy = { ...lazy, loaded: markLoaded(lazy.loaded, REMINDER_TYPE) };
  if (state === "error") lazy = { ...lazy, failed: markLoaded(lazy.failed, REMINDER_TYPE) };
  if (state === "loading") lazy = { ...lazy, loading: markLoaded(lazy.loading, REMINDER_TYPE) };
  const records: RecordMap = {
    [ENTITY_TYPE]: byId(ENTITIES),
    [REMINDER_TYPE]: state === "ready" ? byId(viewOf(o.rows ?? REMINDERS, you)) : {},
    [EFFECT_TYPE]: byId((o.effects ?? []) as { id: string }[]),
    player: {
      p1: { id: "p1", name: "Player 1", color: "#ff6b6b" },
      p2: { id: "p2", name: "Player 2", color: "#4dabf7" },
    },
  };
  if (o.round != null) {
    records[ENCOUNTER_TYPE] = { e1: { id: "e1", status: "started", round: o.round } };
  }
  const sent = o.sent;
  return createStore<SyncState>()(
    () =>
      ({
        state: o.live === false ? "reconnecting" : "live",
        everLive: true,
        store: { ...emptyStore(), you, records },
        lazy,
        connection: {
          load: () => null,
          retryLoad: () => null,
          sendIntent: (name: string, payload: unknown) => {
            sent?.push([name, payload]);
            return Promise.resolve({});
          },
        },
      }) as unknown as SyncState,
  );
}

export function renderWith(you: You, node: ReactNode, o: StoreOpts = {}) {
  // The shell's title marker takes `document` at render; a stub is enough for a static render.
  const g = globalThis as { document?: unknown };
  g.document = { title: "", hidden: false };
  try {
    return renderToStaticMarkup(
      <SyncContext.Provider value={syncStore(you, o)}>
        <ShellProvider registry={createWindowRegistry(you.role === "dm" ? "dm" : "player", [])}>
          <TooltipProvider delayDuration={0} skipDelayDuration={0}>
            {node}
          </TooltipProvider>
        </ShellProvider>
      </SyncContext.Provider>,
    );
  } finally {
    delete g.document;
  }
}

/** Values of `attr` on every element with `data-testid=id`, in document order. */
export function attrs(html: string, id: string, attr: string): string[] {
  return [...html.matchAll(new RegExp(`<[^>]*data-testid="${id}"[^>]*>`, "g"))].map(
    (m) => m[0].match(new RegExp(`${attr}="([^"]*)"`))?.[1] ?? "",
  );
}

/** Opening tags of every element with `data-testid=id`. */
export const tags = (html: string, id: string) =>
  [...html.matchAll(new RegExp(`<[^>]*data-testid="${id}"[^>]*>`, "g"))].map((m) => m[0]);
