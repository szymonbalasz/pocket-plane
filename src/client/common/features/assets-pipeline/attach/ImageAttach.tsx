// Image attach control (FR-ASSET-20–23, -27, ASSET §7): Upload, From library, drop and clipboard
// paste for every form that holds image asset IDs. It never holds the caller's list: `onAdd` once
// per finished image; order, removal, slot layout and dedupe are the caller's (seams S5). Uploads
// are attachments (`listed=false`). No uploader context (player client) → renders nothing.
import type { AssetRecord } from "@shared/assets-pipeline/schemas";
import { Button } from "@ui/components/ui/button";
import { Tooltip } from "@ui/components/ui/overlays";
import { Alert } from "@ui/components/ui/primitives";
import { Progress } from "@ui/components/ui/progress";
import { cn } from "@ui/lib/utils";
import { useRecords, useSync } from "@ui/sync/store";
import { ImagesIcon, UploadIcon } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { AssetPickerDialog } from "../AssetPicker";
import { type AttachUploader, useAttachUploader } from "../uploader";
import { type AttachGate, handleDragOver, handleDrop, handlePaste } from "./handlers";
import { ATTACH_TYPES, AttachQueue, IDLE_STATUS, noMoreImages, progressText } from "./queue";

export interface ImageAttachProps {
  /** The caller's slot cap. */
  max: number;
  /** Images the caller holds now. */
  count: number;
  /** Once per finished image, in pick / upload order. May repeat an id the caller holds. */
  onAdd(assetId: string): void;
  /** Test-ID scope (`data-owner`), e.g. "party-editor". */
  owner: string;
  /** Paste anywhere inside is handled; default: the control. May sit inside a portal (Dialog). */
  pasteTarget?: RefObject<HTMLElement | null>;
  /** Drop anywhere inside is handled (outlined while dragging files); default: the control. */
  dropTarget?: RefObject<HTMLElement | null>;
  /** Show "From library" (default true). */
  library?: boolean;
  /** Host form busy. */
  disabled?: boolean;
  className?: string;
}

export function ImageAttach(props: ImageAttachProps) {
  const uploader = useAttachUploader();
  if (!uploader) return null;
  return <AttachControl {...props} uploader={uploader} />;
}

/** The picker's drag outline (FR-ASSET-17), put on the drop target while files hover it. */
const DRAG_CLASSES = ["rounded-md", "outline-2", "outline-dashed", "outline-primary"];

/**
 * Attaches `bind`'s listeners to the ref's element (else `self`'s) and re-attaches when the
 * element changes, e.g. a Dialog's content mounting in its portal (seams S5).
 */
function useTargetListeners(
  target: RefObject<HTMLElement | null> | undefined,
  self: RefObject<HTMLElement | null>,
  bind: (el: HTMLElement) => () => void,
) {
  const attached = useRef<{ el: HTMLElement; off(): void } | null>(null);
  useEffect(() => {
    const el = target?.current ?? self.current;
    if (attached.current?.el === el) return;
    attached.current?.off();
    attached.current = el ? { el, off: bind(el) } : null;
  });
  useEffect(
    () => () => {
      attached.current?.off();
      attached.current = null;
    },
    [],
  );
}

function AttachControl({
  max,
  count,
  owner,
  pasteTarget,
  dropTarget,
  library = true,
  disabled = false,
  className,
  uploader,
  ...rest
}: ImageAttachProps & { uploader: AttachUploader }) {
  const latest = useRef({ max, count, disabled, onAdd: rest.onAdd });
  latest.current = { max, count, disabled, onAdd: rest.onAdd };
  const [status, setStatus] = useState(IDLE_STATUS);
  const [queue] = useState(
    () =>
      new AttachQueue({
        upload: (file, opts, h) => uploader.upload(file, opts, h),
        onAdd: (id) => latest.current.onAdd(id),
        onChange: setStatus,
      }),
  );
  const gate = (): AttachGate => ({
    queue,
    free: latest.current.max - latest.current.count,
    max: latest.current.max,
    disabled: latest.current.disabled,
    now: () => new Date(),
  });
  const self = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const assets = useRecords<AssetRecord>("asset");
  const live = useSync((s) => s.state === "live");

  useTargetListeners(pasteTarget, self, (el) => {
    const onPaste = (e: ClipboardEvent) => handlePaste(e, gate());
    el.addEventListener("paste", onPaste);
    return () => el.removeEventListener("paste", onPaste);
  });
  useTargetListeners(dropTarget, self, (el) => {
    let added: string[] = [];
    const outline = (on: boolean) => {
      if (on && added.length === 0) {
        added = DRAG_CLASSES.filter((c) => !el.classList.contains(c));
        el.classList.add(...added);
        el.dataset.attachDragging = "true";
      } else if (!on) {
        el.classList.remove(...added);
        added = [];
        delete el.dataset.attachDragging;
      }
    };
    const onOver = (e: DragEvent) => {
      if (handleDragOver(e)) outline(!latest.current.disabled);
    };
    const onLeave = (e: DragEvent) => {
      if (!(e.relatedTarget instanceof Node && el.contains(e.relatedTarget))) outline(false);
    };
    const onDrop = (e: DragEvent) => {
      outline(false);
      handleDrop(e, gate());
    };
    el.addEventListener("dragover", onOver);
    el.addEventListener("dragleave", onLeave);
    el.addEventListener("drop", onDrop);
    return () => {
      outline(false);
      el.removeEventListener("dragover", onOver);
      el.removeEventListener("dragleave", onLeave);
      el.removeEventListener("drop", onDrop);
    };
  });

  const remaining = Math.max(0, max - count - queue.pending);
  const full = remaining === 0;
  const uploadWhy = disabled ? "Not available right now" : full ? noMoreImages(max) : null;
  const libraryWhy = uploadWhy ?? (live ? null : "Not connected");
  const showLibrary = library && assets.length > 0;
  const progress = progressText(status);

  return (
    <div
      ref={self}
      data-testid="asset-attach"
      data-owner={owner}
      data-remaining={remaining}
      className={cn("flex flex-col gap-1.5", className)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Why why={uploadWhy}>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid="asset-attach-upload"
            disabled={uploadWhy !== null}
            onClick={() => input.current?.click()}
          >
            <UploadIcon className="size-4" /> Upload
          </Button>
        </Why>
        <input
          ref={input}
          type="file"
          multiple
          accept={ATTACH_TYPES.join(",")}
          className="hidden"
          data-testid="asset-attach-file-input"
          disabled={uploadWhy !== null}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            const g = gate();
            queue.add(
              files.map((file) => ({ file })),
              g.free,
              g.max,
            );
          }}
        />
        {showLibrary && (
          <Why why={libraryWhy}>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              data-testid="asset-attach-library"
              disabled={libraryWhy !== null}
              onClick={() => setPicking(true)}
            >
              <ImagesIcon className="size-4" /> From library
            </Button>
          </Why>
        )}
        <span
          data-testid={full ? "asset-attach-full" : "asset-attach-hint"}
          className="text-xs text-muted-foreground"
        >
          {full ? noMoreImages(max) : "or drop / paste an image"}
        </span>
      </div>
      {progress && (
        <div data-testid="asset-attach-progress" className="flex items-center gap-2 text-xs">
          {status.phase === "sending" && <Progress value={status.pct} className="flex-1" />}
          <span className={cn(status.phase === "processing" && "text-muted-foreground")}>
            {progress}
          </span>
        </div>
      )}
      {status.errors.length > 0 && (
        <Alert variant="destructive" data-testid="asset-attach-error" className="py-2">
          {status.errors.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional and immutable
            <p key={i} data-testid="asset-attach-error-line">
              {line}
            </p>
          ))}
        </Alert>
      )}
      {showLibrary && (
        <AssetPickerDialog
          open={picking}
          onOpenChange={setPicking}
          title="Add an image"
          selectLabel="Add"
          onSelect={(id) => {
            // The slot may have gone while the picker was open.
            if (gate().free - queue.pending > 0) latest.current.onAdd(id);
          }}
        />
      )}
    </div>
  );
}

/** A disabled Button's reason as a Tooltip on a wrapper (disabled elements get no pointer events). */
function Why({ why, children }: { why: string | null; children: ReactNode }) {
  if (why === null) return children;
  return (
    <Tooltip content={why}>
      <span className="inline-flex">{children}</span>
    </Tooltip>
  );
}
