// FR-CMP-16 `useDefinitions(ids)`: campaign rows from the store; imported rows only once loaded
// (never mere store presence); `loading` / `ready` / `error`; players never load. Static render
// over a fake store (effects don't run: the load request itself is `importedIdsToLoad`).
import { describe, expect, test } from "bun:test";
import { ENTITY_TYPE, IMPORTED_ENTITY_TYPE } from "@shared/entities/schemas";
import { emptyLoaded, type LazyState, lazyAfterSnapshot } from "@shared/protocol/lazy";
import { emptyStore } from "@shared/protocol/store";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore } from "zustand";
import { SyncContext, type SyncState } from "../../sync/store";
import { campaignDefinitions, importedIdsToLoad, useDefinitions } from "./definitions";

const MONSTER = {
  size: "small",
  ac: 15,
  hpMax: 7,
  initBonus: 2,
  speed: 30,
  attacks: [],
  abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
  cr: "1/4",
};
const base = {
  portraitAssetId: null,
  tokenShape: null,
  derivedFromId: null,
  createdAt: "t",
  updatedAt: "t",
};
const custom = {
  ...base,
  id: "elite",
  kind: "monster",
  name: "Elite",
  campaignId: "c1",
  statBlock: MONSTER,
  ownerPlayerId: null,
  hpCurrent: null,
};
const imported = (id: string, name: string) => ({
  ...base,
  id,
  kind: "monster",
  name,
  campaignId: null,
  statBlock: MONSTER,
  ownerPlayerId: null,
  hpCurrent: null,
  source: "srd-5.1",
  sourceKey: `monster/${id}`,
  licence: "CC BY 4.0",
  attribution: "SRD 5.1",
  importedAt: "t",
});

function syncState(o: { role: "dm" | "player"; loaded?: string[]; failed?: string[] }) {
  const lazy: LazyState = { ...lazyAfterSnapshot(1) };
  if (o.loaded) lazy.loaded = { ...emptyLoaded(), ids: { [IMPORTED_ENTITY_TYPE]: o.loaded } };
  if (o.failed) lazy.failed = { ...emptyLoaded(), ids: { [IMPORTED_ENTITY_TYPE]: o.failed } };
  const records = {
    [ENTITY_TYPE]: { elite: custom },
    // Goblin and Wolf are in the store (live upserts reach the DM); only loaded ones count.
    [IMPORTED_ENTITY_TYPE]: { gob: imported("gob", "Goblin"), wolf: imported("wolf", "Wolf") },
  };
  const you = { campaignId: "c1", role: o.role, playerId: o.role === "dm" ? null : "p1" };
  return createStore<SyncState>()(
    () =>
      ({
        state: "live",
        store: { ...emptyStore(), you, records },
        lazy,
        notLiveSince: null,
        everLive: true,
        connection: { load: () => null, retryLoad: () => null },
      }) as unknown as SyncState,
  );
}

function Probe({ ids }: { ids: string[] }) {
  const d = useDefinitions(ids);
  return <pre>{JSON.stringify({ ids: [...d.byId.keys()].sort(), state: d.state })}</pre>;
}

function render(o: Parameters<typeof syncState>[0], ids: string[]) {
  const html = renderToStaticMarkup(
    <SyncContext.Provider value={syncState(o)}>
      <Probe ids={ids} />
    </SyncContext.Provider>,
  );
  return JSON.parse((html.match(/<pre>(.*)<\/pre>/)?.[1] ?? "{}").replaceAll("&quot;", '"')) as {
    ids: string[];
    state: string;
  };
}

describe("FR-CMP-16 useDefinitions", () => {
  test("FR-CMP-16 useDefinitions: campaign rows from the store; imported only once loaded; loading / ready / error", () => {
    expect(render({ role: "dm" }, ["elite", "gob"])).toEqual({ ids: ["elite"], state: "loading" });
    expect(render({ role: "dm", loaded: ["gob"] }, ["elite", "gob"])).toEqual({
      ids: ["elite", "gob"],
      state: "ready",
    });
    // Loaded but not requested here: not returned (another consumer's id).
    expect(render({ role: "dm", loaded: ["gob", "wolf"] }, ["gob"]).ids).toEqual(["elite", "gob"]);
    expect(render({ role: "dm", failed: ["gob"] }, ["gob"]).state).toBe("error");
    expect(render({ role: "dm" }, []).state).toBe("ready");
  });

  test("FR-CMP-16 useDefinitions player: store only, never loads, always ready", () => {
    expect(render({ role: "player" }, ["elite", "gob"])).toEqual({
      ids: ["elite"],
      state: "ready",
    });
    expect(importedIdsToLoad("player", ["gob"], new Set())).toEqual([]);
    expect(importedIdsToLoad(undefined, ["gob"], new Set())).toEqual([]);
  });

  test("FR-CMP-16 load request: the DM's ids that aren't campaign rows, unique and sorted", () => {
    expect(
      importedIdsToLoad("dm", ["wolf", "elite", "gob", "wolf", ""], new Set(["elite"])),
    ).toEqual(["gob", "wolf"]);
    expect([...campaignDefinitions([custom, { id: "x", kind: "character" }]).keys()]).toEqual([
      "elite",
    ]);
  });
});
