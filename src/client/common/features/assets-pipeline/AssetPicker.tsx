// DM asset picker (FR-ASSET-17, ASSET §7): the campaign's listed images, upload by file input or
// drop, "Select" returns the asset ID. Hosted by scene / token / portrait flows (Dialog), the
// attach control's "From library" (FR-ASSET-23) and the test-mode `asset.test` window. In `@ui`
// since S5; uploads go through the client's uploader context (FR-ASSET-27). S6 (FR-ASSET-44–48):
// search (shared matcher over name + tags), tag chips, the selected image's tag editor and Manage
// tags; `context` tags uploads. Search and filter work on the store while disconnected; tag
// editing needs `live`. Both reset each time the picker mounts (opens). BL-49: the header counts
// the library's images and warns from ASSET_LIBRARY_WARN_AT on (the DM snapshot's ceiling, CON-44).
import { type AssetRecord, pickerOrder } from "@shared/assets-pipeline/schemas";
import {
  ALL_IMAGES,
  liveFilter,
  matchImages,
  type TagFilter,
  tagChips,
} from "@shared/assets-pipeline/search";
import { type ImageContext, tagKey } from "@shared/assets-pipeline/tags";
import { Button } from "@ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Tooltip,
} from "@ui/components/ui/overlays";
import { Alert, Input, Skeleton } from "@ui/components/ui/primitives";
import { Progress } from "@ui/components/ui/progress";
import { AssetImg } from "@ui/features/assets-pipeline/AssetImg";
import { cn } from "@ui/lib/utils";
import { useRecords, useSync } from "@ui/sync/store";
import { SearchIcon, UploadIcon, XIcon } from "lucide-react";
import { type Ref, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ManageTags } from "./tags/ManageTags";
import { TagChipRow } from "./tags/TagChipRow";
import { TagEditor } from "./tags/TagEditor";
import { useAttachUploader, withContextTags } from "./uploader";

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
  /** FR-ASSET-48: the host; sets the tag sent with uploads (FR-ASSET-41). None = no tag. */
  context?: ImageContext;
  /**
   * FR-ASSET-45: the search Input, for a Dialog host to focus on open. The inline picker (New
   * scene) passes none and never takes focus (review #26).
   */
  searchRef?: Ref<HTMLInputElement>;
}

/**
 * BL-49: from this many listed images on, the picker warns the DM. The DM snapshot reaches its
 * 1.5 MiB ceiling (live-sync CON-44) at about 2,580 images with typical tags (sprint-6 measure).
 */
export const ASSET_LIBRARY_WARN_AT = 2000;

const count = (n: number) => n.toLocaleString("en-US");

/** BL-49: the header's image count. */
export const libraryCountText = (n: number) => (n === 1 ? "1 image" : `${count(n)} images`);

/** BL-49: the large-library warning, or null below ASSET_LIBRARY_WARN_AT. */
export const librarySizeWarning = (n: number) =>
  n < ASSET_LIBRARY_WARN_AT
    ? null
    : `Large library: ${count(n)} images. Above about 2,500 the live game slows down; delete images you no longer use.`;

/** FR-ASSET-45 / -46: the empty result, with or without a tag chip on. */
export const noMatchText = (q: string, tag: string | null) =>
  tag === null ? `No images match ${q}` : `No images match ${q} in ${tag}`;

export function AssetPicker({
  onSelect,
  initialSelectedId = null,
  selectLabel = "Select",
  className,
  context,
  searchRef,
}: AssetPickerProps) {
  const records = useRecords<AssetRecord>("asset");
  const assets = useMemo(() => [...records].sort(pickerOrder), [records]);
  const chips = useMemo(() => tagChips(assets), [assets]);
  const [query, setQuery] = useState("");
  const [chosenFilter, setFilter] = useState<TagFilter>(ALL_IMAGES);
  // A chip whose last image lost the tag falls back to All.
  const filter = liveFilter(chosenFilter, chips);
  const shown = useMemo(() => matchImages(assets, query, filter), [assets, query, filter]);
  const everLive = useSync((s) => s.everLive);
  const live = useSync((s) => s.state === "live");
  const [selected, setSelected] = useState<string | null>(initialSelectedId);
  const [pending, setPending] = useState<string | null>(null);
  const [upload, setUpload] = useState<Upload>({ phase: "idle" });
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const search = useRef<HTMLInputElement | null>(null);
  const uploader = useAttachUploader();
  const canUpload = live && uploader !== null;
  const busy = upload.phase === "sending" || upload.phase === "processing";
  const sizeWarning = librarySizeWarning(assets.length);
  // FR-ASSET-45: a selection hidden by the search or filter stays selected.
  const selectedAsset = assets.find((a) => a.id === selected) ?? null;
  const filterLabel =
    filter.kind === "tag"
      ? (chips.tags.find((c) => c.key === filter.key)?.label ?? null)
      : filter.kind === "untagged"
        ? "Untagged"
        : null;

  // FR-ASSET-17: select an uploaded item once its record is in the store (after the
  // reconnect snapshot if the connection dropped meanwhile).
  useEffect(() => {
    if (pending && assets.some((a) => a.id === pending)) {
      setSelected(pending);
      setPending(null);
    }
  }, [pending, assets]);

  // FR-ASSET-45: Esc in a non-empty search clears it and nothing else (a second Esc closes the
  // host Dialog). Window capture runs before the Dialog's own Esc listener on the document.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = search.current;
      if (e.key !== "Escape" || !el || e.target !== el || el.value === "") return;
      e.stopPropagation();
      e.preventDefault();
      setQuery("");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  async function send(file: File) {
    if (!uploader || !live || busy) return;
    setUpload({ phase: "sending", pct: 0 });
    // The library's own uploads stay listed (FR-ASSET-24) and carry the context tag (FR-ASSET-41).
    const r = await withContextTags(uploader, () => context)(
      file,
      { listed: true },
      {
        onProgress: (pct) => setUpload({ phase: "sending", pct }),
        onProcessing: () => setUpload({ phase: "processing" }),
      },
    );
    // The uploader reset the secret (back to login).
    if (r.kind === "unauthorized") return;
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

  const setSearchEl = (el: HTMLInputElement | null) => {
    search.current = el;
    if (typeof searchRef === "function") searchRef(el);
    else if (searchRef) searchRef.current = el;
  };

  return (
    <section
      aria-label="Image picker"
      data-testid="asset-picker"
      data-context={context}
      data-dragging={dragging || undefined}
      className={cn(
        "flex min-h-0 flex-col gap-2",
        dragging && "rounded-md outline-2 outline-dashed outline-primary",
        className,
      )}
      onDragOver={(e) => {
        if (!canUpload || busy || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        setDragging(false);
        if (!canUpload || busy || e.dataTransfer.files.length === 0) return;
        e.preventDefault();
        onFiles(e.dataTransfer.files);
      }}
    >
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          data-testid="asset-picker-upload"
          disabled={!canUpload || busy}
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
          disabled={!canUpload || busy}
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <span className="text-xs text-muted-foreground">or drop an image here</span>
        {everLive && (
          <span
            data-testid="asset-library-count"
            className="ml-auto text-xs text-muted-foreground tabular-nums"
          >
            {libraryCountText(assets.length)}
          </span>
        )}
        {/* type="button": hosts embed the picker in their own form (New scene, MAP §7). */}
        <Button
          type="button"
          size="sm"
          className={cn(!everLive && "ml-auto")}
          data-testid="asset-picker-select"
          disabled={selectedAsset === null}
          onClick={() => selected && onSelect(selected)}
        >
          {selectLabel}
        </Button>
      </div>

      {sizeWarning && (
        <Alert variant="warning" data-testid="asset-library-size-warning" className="py-2 text-xs">
          {sizeWarning}
        </Alert>
      )}

      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={setSearchEl}
            aria-label="Search images"
            placeholder="Search images"
            data-testid="asset-picker-search"
            autoComplete="off"
            value={query}
            className="h-8 pl-8 pr-8"
            onChange={(e) => setQuery(e.target.value)}
            // Filtering is live: Enter never submits a host form (New scene).
            onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
          />
          {query !== "" && (
            <button
              type="button"
              aria-label="Clear search"
              data-testid="asset-picker-search-clear"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:bg-accent"
              onClick={() => {
                setQuery("");
                search.current?.focus();
              }}
            >
              <XIcon className="size-4" />
            </button>
          )}
        </div>
        <ManageTags chips={chips} live={live} />
      </div>
      {(chips.tags.length > 0 || chips.untagged > 0) && (
        <TagChipRow chips={chips} filter={filter} onFilter={setFilter} />
      )}
      {selectedAsset && (
        // Keyed: a typed tag or an error never carries over to another image.
        <TagEditor key={selectedAsset.id} asset={selectedAsset} chips={chips} live={live} />
      )}

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
      ) : shown.length === 0 ? (
        <div
          data-testid="asset-picker-no-match"
          className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground"
        >
          <p>{noMatchText(query, filterLabel)}</p>
          {filterLabel === null ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              data-testid="asset-picker-no-match-clear"
              onClick={() => setQuery("")}
            >
              Clear search
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              data-testid="asset-picker-search-all"
              onClick={() => setFilter(ALL_IMAGES)}
            >
              Search all images
            </Button>
          )}
        </div>
      ) : (
        <ul
          aria-label="Images"
          className="grid min-h-0 grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2 overflow-auto"
        >
          {shown.map((a) => (
            <li key={a.id}>
              <Tooltip content={tileTip(a)}>
                <button
                  type="button"
                  data-testid="asset-picker-item"
                  data-record-id={a.id}
                  data-tags={a.tags.map(tagKey).join(" ")}
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

/** Tile Tooltip (ASSET §7): display size, MB and the tags. */
function tileTip(a: AssetRecord): string {
  const base = `${a.displayWidth} × ${a.displayHeight} · ${mb(a.bytes)}`;
  return a.tags.length > 0 ? `${base} · ${a.tags.join(", ")}` : base;
}

/** Dialog host for scene / token / portrait flows (ASSET §7); focuses the search on open. */
export function AssetPickerDialog({
  open,
  onOpenChange,
  title = "Choose an image",
  ...picker
}: AssetPickerProps & { open: boolean; onOpenChange(open: boolean): void; title?: string }) {
  const search = useRef<HTMLInputElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[80vh] max-w-2xl"
        aria-describedby={undefined}
        data-context={picker.context}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          search.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <AssetPicker
          {...picker}
          searchRef={search}
          // ≥ 2 grid rows at 1280 × 720 under the four picker rows (ASSET §7).
          className="max-h-[calc(80vh-6rem)]"
          onSelect={(id) => {
            picker.onSelect(id);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
