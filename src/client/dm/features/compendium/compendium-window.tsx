// DM `cmp.compendium` (FR-CMP-18–21): the shared body with the DM's credential, the import
// panel on top, Monsters tab and monster rows as drag sources. The session module is imported
// lazily (it reads localStorage at load; keeps the registry testable), as `combat-tracker/rest`.
import type { Api } from "@ui/api";
import { Skeleton } from "@ui/components/ui/primitives";
import { CompendiumBody } from "@ui/features/compendium/CompendiumWindow";
import { compendiumWindowBase } from "@ui/features/compendium/window";
import { defineWindow } from "@ui/features/play-shell/registry";
import { useEffect, useState } from "react";
import { ImportPanel } from "./ImportPanel";

function DmCompendium() {
  const [api, setApi] = useState<Api | null>(null);
  useEffect(() => {
    let live = true;
    void import("../campaign-management/session").then((m) => live && setApi(() => m.api)); // hc clients are callable proxies: never a setState updater
    return () => {
      live = false;
    };
  }, []);
  if (!api) return <Skeleton className="m-2 h-8" />;
  return <CompendiumBody api={api} viewer="dm" top={<ImportPanel api={api} />} />;
}

export const dmCompendiumWindow = defineWindow({
  ...compendiumWindowBase,
  clients: ["dm"],
  component: DmCompendium,
});
