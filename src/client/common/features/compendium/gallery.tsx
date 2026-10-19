// Entry gallery + lightbox (FR-CMP-51, CMP §7), both clients: the main image (`thumb`, full view
// width, ≤ 240 px high) under the entry header, then the others as 64 px `thumb` tiles; a click
// opens the lightbox (`display`, 90 vw × 80 vh) with Prev / Next (wrapping) and "n / N". States
// per FR-ASSET-16 via `AssetImg`. Viewers get exactly the IDs the entry read delivered (FR-CMP-48).
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../../components/ui/overlays";
import { AssetImg } from "../assets-pipeline/AssetImg";

/** `i + by` wrapped into `0…n-1`. */
export const wrapIndex = (i: number, by: number, n: number) => (n === 0 ? 0 : (i + by + n) % n);

export const lightboxCount = (i: number, n: number) => `${i + 1} / ${n}`;

/** The lightbox's inside: the `display` image, Prev / Next and the counter. */
export function LightboxView({
  ids,
  index,
  name,
  onIndex,
}: {
  ids: readonly string[];
  index: number;
  name: string;
  onIndex(i: number): void;
}) {
  const n = ids.length;
  const id = ids[index];
  if (id === undefined) return null;
  return (
    <div className="flex flex-col items-center gap-2">
      <AssetImg
        key={id}
        id={id}
        file="display"
        alt={`${name}, image ${index + 1}`}
        className="max-h-[80vh] min-h-24 min-w-24 max-w-full rounded"
      />
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          data-testid="cmp-lightbox-prev"
          aria-label="Previous image"
          disabled={n < 2}
          onClick={() => onIndex(wrapIndex(index, -1, n))}
        >
          <ChevronLeftIcon className="size-4" /> Prev
        </Button>
        <span data-testid="cmp-lightbox-count" className="text-xs text-muted-foreground">
          {lightboxCount(index, n)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          data-testid="cmp-lightbox-next"
          aria-label="Next image"
          disabled={n < 2}
          onClick={() => onIndex(wrapIndex(index, 1, n))}
        >
          Next <ChevronRightIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/** The entry's images; nothing when there are none (the view is unchanged). */
export function EntryGallery({ ids, name }: { ids: readonly string[]; name: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const [main, ...rest] = ids;
  if (main === undefined) return null;
  return (
    <div data-testid="cmp-entry-images" data-value={ids.length} className="space-y-1.5">
      <button
        type="button"
        data-testid="cmp-entry-image-main"
        data-record-id={main}
        aria-label={`${name}: open image 1`}
        className="block w-full cursor-zoom-in"
        onClick={() => setOpen(0)}
      >
        <AssetImg
          id={main}
          file="thumb"
          alt={`${name}, image 1`}
          className="max-h-60 min-h-16 w-full rounded-md"
        />
      </button>
      {rest.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {rest.map((id, i) => (
            <button
              key={id}
              type="button"
              data-testid="cmp-entry-image"
              data-record-id={id}
              data-value={i + 2}
              aria-label={`${name}: open image ${i + 2}`}
              className="cursor-zoom-in"
              onClick={() => setOpen(i + 1)}
            >
              <AssetImg
                id={id}
                file="thumb"
                alt={`${name}, image ${i + 2}`}
                className="size-16 rounded"
              />
            </button>
          ))}
        </div>
      )}
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent
          data-testid="cmp-lightbox"
          aria-describedby={undefined}
          className="w-auto max-w-[90vw] p-4 pt-10"
          onKeyDown={(e) => {
            if (open === null || ids.length < 2) return;
            if (e.key === "ArrowLeft") setOpen(wrapIndex(open, -1, ids.length));
            if (e.key === "ArrowRight") setOpen(wrapIndex(open, 1, ids.length));
          }}
        >
          <DialogTitle className="sr-only">{name}</DialogTitle>
          {open !== null && <LightboxView ids={ids} index={open} name={name} onIndex={setOpen} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
