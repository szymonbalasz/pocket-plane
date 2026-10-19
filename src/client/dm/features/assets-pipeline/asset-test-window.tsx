// `asset.test` (FR-ASSET-19, OQ-ASSET-08, CON-28): test-mode-only DM window hosting the
// picker, so the picker can be verified before scenes-map's flows exist. S5 (FR-ASSET-27): also
// one image attach control (`owner = "asset-test"`) listing every ID it returned, in order
// (duplicates included: dedupe is the caller's, and this caller keeps them visible), and a Dialog
// whose control pastes / drops into targets inside the portal (seams S5).
import type { AssetRecord } from "@shared/assets-pipeline/schemas";
import { Button } from "@ui/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@ui/components/ui/overlays";
import { AssetPicker } from "@ui/features/assets-pipeline/AssetPicker";
import { ImageAttach } from "@ui/features/assets-pipeline/attach/ImageAttach";
import { Textarea } from "@ui/features/party-board/controls";
import { defineWindow } from "@ui/features/play-shell/registry";
import { isTestMode } from "@ui/features/play-shell/test-windows";
import { useRecords } from "@ui/sync/store";
import { ImagesIcon } from "lucide-react";
import { useRef, useState } from "react";

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
      <div className="flex shrink-0 items-start gap-2">
        <ImageAttach
          className="flex-1"
          owner="asset-test"
          max={ATTACH_TEST_MAX}
          count={attached.length}
          onAdd={(id) => setAttached((rows) => [...rows, { n: rows.length, id }])}
        />
        <AttachDialogTest />
      </div>
      <AttachedIds rows={attached} />
    </div>
  );
}

function AttachedIds({ rows }: { rows: { n: number; id: string }[] }) {
  return (
    <ol
      data-testid="asset-test-attached"
      className="max-h-16 shrink-0 overflow-auto text-xs text-muted-foreground"
    >
      {rows.map(({ n, id }) => (
        <li key={n} data-testid="asset-test-attached-id" data-record-id={id} className="font-mono">
          {id}
        </li>
      ))}
    </ol>
  );
}

/** Seams S5: the control and its paste / drop targets inside a Dialog's portal. */
function AttachDialogTest() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<{ n: number; id: string }[]>([]);
  const [text, setText] = useState("");
  const paste = useRef<HTMLTextAreaElement>(null);
  const drop = useRef<HTMLDivElement>(null);
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-testid="asset-test-dialog-open"
        onClick={() => setOpen(true)}
      >
        In a dialog
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="asset-test-dialog" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Attach in a dialog (test)</DialogTitle>
          </DialogHeader>
          <Textarea
            ref={paste}
            data-testid="asset-test-dialog-text"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div
            ref={drop}
            data-testid="asset-test-dialog-drop"
            className="rounded-md border p-4 text-xs text-muted-foreground"
          >
            Drop zone
          </div>
          <ImageAttach
            owner="asset-test-dialog"
            max={ATTACH_TEST_MAX}
            count={rows.length}
            onAdd={(id) => setRows((r) => [...r, { n: r.length, id }])}
            pasteTarget={paste}
            dropTarget={drop}
          />
          <AttachedIds rows={rows} />
        </DialogContent>
      </Dialog>
    </>
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
