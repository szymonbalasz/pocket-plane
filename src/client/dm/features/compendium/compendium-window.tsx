// DM `cmp.compendium` (FR-CMP-18–21, -24/25/27): the shared body with the DM's credential, the
// import panel on top, New homebrew in the toolbar, entry actions (Derive…, Clone / Edit /
// Delete), Monsters tab and monster rows as drag sources. The session module is imported
// lazily (it reads localStorage at load; keeps the registry testable), as `combat-tracker/rest`.
import type { Api } from "@ui/api";
import { Skeleton } from "@ui/components/ui/primitives";
import { CompendiumBody, CompendiumEntryBody } from "@ui/features/compendium/CompendiumWindow";
import { compendiumWindowBase, entryWindowBase } from "@ui/features/compendium/window";
import { defineWindow, type WindowProps } from "@ui/features/play-shell/registry";
import { loadChunk } from "@ui/lib/lazy-chunk";
import { useEffect, useState } from "react";
import { useOpenStatBlock } from "../entities/statblock/store";
import { EntryActions, NewHomebrew } from "./EntryActions";
import { ImportPanel } from "./ImportPanel";

function useSessionApi(): Api | null {
  const [api, setApi] = useState<Api | null>(null);
  useEffect(() => {
    let live = true;
    // hc clients are callable proxies: never a setState updater. Stale chunk: skeleton + notice.
    loadChunk(() => import("../campaign-management/session"), { notice: true }).then(
      (m) => live && setApi(() => m.api),
      (err) => console.error("compendium: session failed to load", err),
    );
    return () => {
      live = false;
    };
  }, []);
  return api;
}

function DmCompendium() {
  const openStatBlock = useOpenStatBlock();
  const api = useSessionApi();
  if (!api) return <Skeleton className="m-2 h-8" />;
  return (
    <CompendiumBody
      api={api}
      viewer="dm"
      top={<ImportPanel api={api} />}
      toolbar={<NewHomebrew api={api} />}
      entryActions={(data) => <EntryActions api={api} data={data} openAtTable={openStatBlock} />}
    />
  );
}

/** FR-CMP-76: a popped-out entry keeps the DM's entry actions. */
function DmCompendiumEntry({ instance }: WindowProps) {
  const openStatBlock = useOpenStatBlock();
  const api = useSessionApi();
  if (!api) return <Skeleton className="m-2 h-8" />;
  return (
    <CompendiumEntryBody
      api={api}
      viewer="dm"
      instance={instance}
      entryActions={(data) => <EntryActions api={api} data={data} openAtTable={openStatBlock} />}
    />
  );
}

export const dmCompendiumWindow = defineWindow({
  ...compendiumWindowBase,
  clients: ["dm"],
  component: DmCompendium,
});

export const dmCompendiumEntryWindow = defineWindow({
  ...entryWindowBase,
  clients: ["dm"],
  component: DmCompendiumEntry,
});
