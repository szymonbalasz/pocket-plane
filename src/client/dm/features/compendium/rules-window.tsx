// DM `cmp.rules` (FR-CMP-63, -67): the shared Rules body with the DM's credential, **New house
// rule** on the House rules page (the Compendium's homebrew form, kind `rule`; the window
// refetches on save) and the empty state's Open Compendium. The session module loads lazily (it
// reads localStorage at load; keeps the registry testable), as `compendium-window.tsx`.
import type { Api } from "@ui/api";
import { Button } from "@ui/components/ui/button";
import { Skeleton } from "@ui/components/ui/primitives";
import { useLive } from "@ui/features/combat-tracker/store";
import { CMP_KIND } from "@ui/features/compendium/logic";
import { refetchRules } from "@ui/features/compendium/rules/nav";
import { RulesBody } from "@ui/features/compendium/rules/RulesWindow";
import { rulesWindowBase } from "@ui/features/compendium/rules/window";
import { defineWindow } from "@ui/features/play-shell/registry";
import { useOpenWindow } from "@ui/features/play-shell/ShellContext";
import { loadChunk } from "@ui/lib/lazy-chunk";
import { PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { HomebrewDialog } from "./HomebrewForm";
import type { FormMode } from "./homebrew-form";

function NewHouseRule({ api }: { api: Api }) {
  const live = useLive();
  const [mode, setMode] = useState<FormMode | null>(null);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-7"
        data-testid="cmp-rules-new-house"
        disabled={!live}
        onClick={() => setMode({ kind: "new", preset: "rule" })}
      >
        <PlusIcon className="size-3.5" /> New house rule
      </Button>
      <HomebrewDialog
        api={api}
        mode={mode}
        onClose={() => setMode(null)}
        onSaved={() => refetchRules()}
      />
    </>
  );
}

function DmRules() {
  const [api, setApi] = useState<Api | null>(null);
  const openWindow = useOpenWindow();
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
  if (!api) return <Skeleton className="m-2 h-8" />;
  return (
    <RulesBody
      api={api}
      viewer="dm"
      houseAction={<NewHouseRule api={api} />}
      onOpenCompendium={() => openWindow(CMP_KIND)}
    />
  );
}

export const dmRulesWindow = defineWindow({
  ...rulesWindowBase,
  clients: ["dm"],
  component: DmRules,
});
