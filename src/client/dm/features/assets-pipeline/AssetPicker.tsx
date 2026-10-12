// DM asset picker (FR-ASSET-17, ASSET §7): the campaign's images, upload by file input or
// drop, "Select" returns the asset ID. Hosted by scene / token / portrait flows (Dialog) and
// the test-mode `asset.test` window.
import { type AssetRecord, pickerOrder } from "@shared/assets-pipeline/schemas";
import { Button } from "@ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Tooltip,
} from "@ui/components/ui/overlays";
import { Alert, Skeleton } from "@ui/components/ui/primitives";
import { Progress } from "@ui/components/ui/progress";
import { AssetImg } from "@ui/features/assets-pipeline/AssetImg";
import { cn } from "@ui/lib/utils";
import { useRecords, useSync } from "@ui/sync/store";
import { UploadIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useDmSession } from "../campaign-management/session";
import { uploadAsset } from "./upload";

type Upload =
  | { phase: "idle" }
  | { phase: "sending"; pct: number }
  | { phase: "processing" }
  | { phase: "error"; message: string };

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export interface AssetPickerProps {
  /** Called by "Select" with the chosen asset ID. */
  onSelect(assetId: string): void;
  initialSelectedId?: string | null;
  selectLabel?: string;
  className?: string;
}

export function AssetPicker({
  onSelect,
  initialSelectedId = null,
  selectLabel = "Select",
  className,
}: AssetPickerProps) {
  const records = useRecords<AssetRecord>("asset");
  const assets = useMemo(() => [...records].sort(pickerOrder), [records]);
  const everLive = useSync((s) => s.everLive);
  const live = useSync((s) => s.state === "live");
  const [selected, setSelected] = useState<string | null>(initialSelectedId);
  const [pending, setPending] = useState<string | null>(null);
  const [upload, setUpload] = useState<Upload>({ phase: "idle" });
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const busy = upload.phase === "sending" || upload.phase === "processing";

  // FR-ASSET-17: select an uploaded item once its record is in the store (after the
  // reconnect snapshot if the connection dropped meanwhile).
  useEffect(() => {
    if (pending && assets.some((a) => a.id === pending)) {
      setSelected(pending);
      setPending(null);
    }
  }, [pending, assets]);

  async function send(file: File) {
    const secret = useDmSession.getState().secret;
    if (!secret || !live || busy) return;
    setUpload({ phase: "sending", pct: 0 });
    const r = await uploadAsset(file, secret, {
      onProgress: (pct) => setUpload({ phase: "sending", pct }),
      onProcessing: () => setUpload({ phase: "processing" }),
    });
    if (r.kind === "unauthorized") {
      useDmSession.getState().setSecret(null);
      return;
    }
    if (r.kind === "error") {
      setUpload({ phase: "error", message: r.message });
      return;
    }
    setUpload({ phase: "idle" });
    if (r.outcome === "existing") toast("Already uploaded");
    setPending(r.asset.id);
  }

  const onFiles = (files: FileList | null) => {
    const f = files?.[0];
    if (f) void send(f);
  };

  return (
    <section
      aria-label="Image picker"
      data-testid="asset-picker"
      data-dragging={dragging || undefined}
      className={cn(
        "flex min-h-0 flex-col gap-3",
        dragging && "rounded-md outline-2 outline-dashed outline-primary",
        className,
      )}
      onDragOver={(e) => {
        if (!live || busy || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        setDragging(false);
        if (!live || busy || e.dataTransfer.files.length === 0) return;
        e.preventDefault();
        onFiles(e.dataTransfer.files);
      }}
    >
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          data-testid="asset-picker-upload"
          disabled={!live || busy}
          onClick={() => input.current?.click()}
        >
          <UploadIcon className="size-4" /> Upload
        </Button>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          data-testid="asset-picker-file-input"
          disabled={!live || busy}
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <span className="text-xs text-muted-foreground">or drop an image here</span>
        <Button
          size="sm"
          className="ml-auto"
          data-testid="asset-picker-select"
          disabled={selected === null || !assets.some((a) => a.id === selected)}
          onClick={() => selected && onSelect(selected)}
        >
          {selectLabel}
        </Button>
      </div>

      {upload.phase === "sending" && (
        <div data-testid="asset-upload-progress" className="flex items-center gap-2 text-xs">
          <Progress value={upload.pct} className="flex-1" />
          <span>{upload.pct}%</span>
        </div>
      )}
      {upload.phase === "processing" && (
        <div data-testid="asset-upload-progress" className="text-xs text-muted-foreground">
          Processing…
        </div>
      )}
      {upload.phase === "error" && (
        <Alert variant="destructive" data-testid="asset-upload-error">
          {upload.message}
        </Alert>
      )}

      {!everLive ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="aspect-square" />
          ))}
        </div>
      ) : assets.length === 0 ? (
        <p
          data-testid="asset-picker-empty"
          className="py-6 text-center text-sm text-muted-foreground"
        >
          No images yet. Upload a map or token art.
        </p>
      ) : (
        <ul
          aria-label="Images"
          className="grid min-h-0 grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2 overflow-auto"
        >
          {assets.map((a) => (
            <li key={a.id}>
              <Tooltip content={`${a.displayWidth} × ${a.displayHeight} · ${mb(a.bytes)}`}>
                <button
                  type="button"
                  data-testid="asset-picker-item"
                  data-record-id={a.id}
                  aria-pressed={selected === a.id}
                  data-selected={selected === a.id || undefined}
                  onClick={() => setSelected(a.id)}
                  onDoubleClick={() => onSelect(a.id)}
                  className={cn(
                    "flex w-full flex-col gap-1 rounded-md border p-1 text-left hover:bg-accent",
                    selected === a.id && "border-primary ring-2 ring-primary",
                  )}
                >
                  <AssetImg id={a.id} file="thumb" alt={a.name} className="aspect-square w-full" />
                  <span className="truncate text-xs">{a.name}</span>
                </button>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Dialog host for scene / token / portrait flows (ASSET §7). */
export function AssetPickerDialog({
  open,
  onOpenChange,
  title = "Choose an image",
  ...picker
}: AssetPickerProps & { open: boolean; onOpenChange(open: boolean): void; title?: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-2xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <AssetPicker
          {...picker}
          className="max-h-[60vh]"
          onSelect={(id) => {
            picker.onSelect(id);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
