// Test helpers for the palette tests (not a test file): a synced store with the sim's cast, a
// window registry like the clients' (launcher kinds of SP1's keys + Preferences + the test
// window), a real shell controller on in-memory storage, and a `CommandCtx` whose sender and shell
// record what they were asked. No DOM in `bun test`.
import { layoutKey } from "@shared/play-shell/layout";
import { emptyStore, type RecordStore } from "@shared/protocol/store";
import { BookOpenIcon } from "lucide-react";
import { CHAR_SHEET_KIND } from "../../character-sheet/window";
import { INITIATIVE_KIND } from "../../combat-tracker/window";
import { CMP_KIND } from "../../compendium/logic";
import { DICEX_TRAY_KIND } from "../../dice-extras/window-kind";
import { DICE_LOG_KIND } from "../../dice-roll-log/window";
import { PARTY_BOARD_KIND } from "../../party-board/logic";
import { STATS_WINDOW_KIND } from "../../stats/logic";
import { PREFS_KIND } from "../PreferencesWindow";
import { availableKinds, createWindowRegistry, defineWindow, type ShellClient } from "../registry";
import { createShellController } from "../shell-store";
import { createLayoutStorage, type StorageBackend } from "../storage";
import { shellTestWindow } from "../test-windows";
import type { CommandCtx } from "./types";

const Body = () => null;

const win = (kind: string, title: string, order: number, launcher = true) =>
  defineWindow({
    kind,
    title,
    clients: ["dm", "player"],
    defaultSize: { w: 320, h: 300 },
    minSize: { w: 200, h: 200 },
    defaultPosition: { anchor: "top-left", dx: 60 + order, dy: 10 },
    ...(launcher ? { launcher: { icon: BookOpenIcon, label: title, order } } : {}),
    component: Body,
  });

/** A client registry: SP1's key windows (no Rules: SP2 not registered), Preferences, test window. */
export function testRegistry(client: ShellClient, extra: readonly string[] = []) {
  const defs = [
    win(DICE_LOG_KIND, "Game log", 10),
    win(INITIATIVE_KIND, "Initiative", 20),
    win(DICEX_TRAY_KIND, "Dice tray", 30),
    win(CHAR_SHEET_KIND, "Character sheet", 40),
    win(CMP_KIND, "Compendium", 50),
    win(PARTY_BOARD_KIND, "Party", 60),
    win(STATS_WINDOW_KIND, "Stats", 70),
    win(PREFS_KIND, "Preferences", 0, false),
    { ...shellTestWindow, clients: [client] },
    ...extra.map((k, i) => win(k, k, 100 + i)),
  ].map((d) => ({ ...d, clients: [client] }));
  return createWindowRegistry(client, defs);
}

export const MIRA = "char-mira";
export const THORN = "char-thorn";
export const OWL = "pet-owl";
export const GOBLIN_BOSS = "npc-boss";
export const ENC = "enc-1";

export interface StoreOpts {
  client?: ShellClient;
  /** player-1 (Mira's owner) or player-2 (Thorn's). */
  playerId?: string;
  started?: boolean;
  paused?: boolean;
  testMode?: boolean;
  features?: string[];
}

/** The sim's cast as each client holds it: a player gets other PCs redacted, no customs. */
export function testStore(o: StoreOpts = {}): RecordStore {
  const client = o.client ?? "dm";
  const playerId = client === "player" ? (o.playerId ?? "p1") : null;
  const dm = client === "dm";
  const entity: Record<string, unknown> = {
    [MIRA]: { id: MIRA, kind: "character", name: "Mira", ownerPlayerId: "p1" },
    [THORN]: { id: THORN, kind: "character", name: "Thorn", ownerPlayerId: "p2" },
  };
  // The owl: Mira's pet (full row to the DM and its owner; none to the other player here).
  if (dm || playerId === "p1") {
    entity[OWL] = {
      id: OWL,
      kind: "monster",
      name: "Owl",
      ownerPlayerId: "p1",
      companionOf: MIRA,
      statBlock: { hpMax: 1, size: "tiny", type: "beast" },
    };
  }
  if (dm) {
    entity[GOBLIN_BOSS] = { id: GOBLIN_BOSS, kind: "monster", name: "Goblin Boss" };
  }
  const records: RecordStore["records"] = {
    entity,
    campaign: {
      c1: {
        id: "c1",
        name: "Camp",
        features: o.features ?? [],
        pause: o.paused
          ? { message: null, imageAssetId: null, backAt: null, startedAt: "2026-01-01T00:00:00Z" }
          : null,
      },
    },
  };
  if (o.started) {
    records.encounter = {
      [ENC]: { id: ENC, status: "started", round: 1, turnCombatantId: "cb-mira" },
    };
    records.combatant = {
      "cb-mira": {
        id: "cb-mira",
        encounterId: ENC,
        name: "Mira",
        kind: "pc",
        position: 1,
        initiative: 15,
        hpCurrent: 20,
        entityId: MIRA,
      },
      "cb-gob": {
        id: "cb-gob",
        encounterId: ENC,
        name: "Goblin",
        kind: "monster",
        position: 2,
        initiative: 12,
        hpCurrent: 7,
      },
    };
  }
  if (o.testMode) records.probe = {};
  return {
    ...emptyStore(),
    you: { campaignId: "c1", role: client, playerId },
    records,
  };
}

function memoryBackend(): StorageBackend {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

export interface TestCtx extends CommandCtx {
  sent: { name: string; payload: unknown }[];
  calls: string[];
  /** The real controller behind `shell` (window state after commands). */
  controller: ReturnType<typeof createShellController>;
}

/** A `CommandCtx` over a real shell controller; `send` records and acks with `result`. */
export function testCtx(
  o: StoreOpts & { live?: boolean; result?: unknown; registryExtra?: string[] } = {},
): TestCtx {
  const client = o.client ?? "dm";
  const store = testStore(o);
  const registry = testRegistry(client, o.registryExtra);
  const controller = createShellController({
    registry,
    storage: createLayoutStorage(() => memoryBackend()),
    viewport: () => ({ w: 1440, h: 900 }),
  });
  controller.restore(layoutKey("c1", client === "dm" ? { role: "dm" } : { playerId: "p1" }));
  const available = availableKinds(registry, store);
  const sent: TestCtx["sent"] = [];
  const calls: string[] = [];
  const dispatch = (a: Parameters<typeof controller.dispatch>[0]) =>
    controller.dispatch(a, available);
  const ctx: TestCtx = {
    client,
    store,
    live: o.live ?? true,
    registry,
    get windows() {
      return controller.store.getState().windows;
    },
    available,
    shell: {
      openWindow: (kind) => {
        calls.push(`open:${kind}`);
        dispatch({ type: "open", kind, by: "user" });
      },
      focusWindow: (kind) => {
        calls.push(`focus:${kind}`);
        dispatch({ type: "focus", kind });
      },
      toggleWindow: (kind) => {
        calls.push(`toggle:${kind}`);
        dispatch({ type: "toggle", kind });
      },
      resetLayout: () => {
        calls.push("reset");
        dispatch({ type: "reset" });
      },
    },
    async send<R>(name: string, payload: unknown) {
      sent.push({ name, payload });
      return (o.result ?? {}) as R;
    },
    openPalette: (prefix) => void calls.push(`palette:${prefix ?? ""}`),
    openShortcuts: () => void calls.push("shortcuts"),
    sent,
    calls,
    controller,
  };
  return ctx;
}

/** A window's state in the controller (`closed` when absent). */
export const stateOf = (ctx: TestCtx, kind: string) =>
  ctx.controller.store.getState().windows.find((w) => w.kind === kind)?.state ?? "closed";
