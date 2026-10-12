// `asset.test` (FR-ASSET-19, OQ-ASSET-08, CON-28): test-mode-only DM window hosting the
// picker, so the picker can be verified before scenes-map's flows exist.
import type { AssetRecord } from "@shared/assets-pipeline/schemas";
import { defineWindow } from "@ui/features/play-shell/registry";
import { isTestMode } from "@ui/features/play-shell/test-windows";
import { useRecords } from "@ui/sync/store";
import { ImagesIcon } from "lucide-react";
import { useState } from "react";
import { AssetPicker } from "./AssetPicker";

function AssetTestBody() {
  const assets = useRecords<AssetRecord>("asset");
  const [chosen, setChosen] = useState<string | null>(null);
  const name = assets.find((a) => a.id === chosen)?.name;
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 text-sm">
      <AssetPicker onSelect={setChosen} className="min-h-0 flex-1" />
      <p className="text-xs text-muted-foreground">
        Selected:{" "}
        <span data-testid="asset-test-selected" data-record-id={chosen ?? undefined}>
          {name ?? "none"}
        </span>
      </p>
    </div>
  );
}

export const assetTestWindow = defineWindow({
  kind: "asset.test",
  title: "Images (test)",
  clients: ["dm"],
  // Between sync.probes (bottom-left) and shell.test (bottom-right), below camp.players: no
  // overlap at 1280×720 (FR-SHELL-08). Small by default; resizable.
  defaultSize: { w: 360, h: 224 },
  minSize: { w: 300, h: 200 },
  defaultPosition: { anchor: "bottom-left", dx: 568 },
  // Test mode only; the launcher is the only way to open it before scenes-map's flows.
  launcher: { icon: ImagesIcon, label: "Images", order: 920 },
  available: isTestMode,
  component: AssetTestBody,
});
