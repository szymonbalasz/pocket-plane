// `asset.test` (FR-ASSET-19, OQ-ASSET-08, CON-28): test-mode-only DM window hosting the
// picker, so the picker can be verified before scenes-map's flows exist. S5 (FR-ASSET-27): also
// one image attach control (`owner = "asset-test"`) listing every ID it returned, in order
// (duplicates included: dedupe is the caller's, and this caller keeps them visible).
import type { AssetRecord } from "@shared/assets-pipeline/schemas";
import { AssetPicker } from "@ui/features/assets-pipeline/AssetPicker";
import { ImageAttach } from "@ui/features/assets-pipeline/attach/ImageAttach";
import { defineWindow } from "@ui/features/play-shell/registry";
import { isTestMode } from "@ui/features/play-shell/test-windows";
import { useRecords } from "@ui/sync/store";
import { ImagesIcon } from "lucide-react";
import { useState } from "react";

/** Slots of the test host's attach control. */
const ATTACH_TEST_MAX = 10;

function AssetTestBody() {
  const assets = useRecords<AssetRecord>("asset");
  const [chosen, setChosen] = useState<string | null>(null);
  const [attached, setAttached] = useState<{ n: number; id: string }[]>([]);
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
      <ImageAttach
        className="shrink-0"
        owner="asset-test"
        max={ATTACH_TEST_MAX}
        count={attached.length}
        onAdd={(id) => setAttached((rows) => [...rows, { n: rows.length, id }])}
      />
      <ol
        data-testid="asset-test-attached"
        className="max-h-16 shrink-0 overflow-auto text-xs text-muted-foreground"
      >
        {attached.map(({ n, id }) => (
          <li
            key={n}
            data-testid="asset-test-attached-id"
            data-record-id={id}
            className="font-mono"
          >
            {id}
          </li>
        ))}
      </ol>
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
