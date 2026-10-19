// `party.handout` viewer body, both clients (FR-PARTY-09, -10, -14): title, images in order
// (`display`, fit to width; click toggles 100 %), then the body as text through `DiceText`
// (never HTML). Loads every visible header and this handout's body (`useLazyRecords`); a load
// that comes back without the id, an unshare or a delete → "No longer shared".
import {
  HANDOUT_BODY_TYPE,
  HANDOUT_TYPE,
  type HandoutBodyView,
  type HandoutView,
} from "@shared/party-board/schemas";
import type { LazyStatus } from "@shared/protocol/lazy";
import { type ReactNode, useState } from "react";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/primitives";
import { ScrollArea } from "../../components/ui/scroll-area";
import { cn } from "../../lib/utils";
import { type LazyRecords, useLazyRecords } from "../../sync/store";
import { AssetImg } from "../assets-pipeline/AssetImg";
import { DiceText } from "../dice-extras/DiceText";
import { GONE_TEXT, LOAD_FAILED } from "./logic";

/** Skeleton rows while a lazy load runs (FR-PARTY-10). */
export function LoadingRows({ testId, rows = 3 }: { testId: string; rows?: number }) {
  return (
    <div data-testid={testId} className="flex flex-col gap-2 p-1">
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

/** Load reject → inline "Couldn't load — Retry" (FR-PARTY-10). */
export function RetryLoad({ onRetry }: { onRetry(): void }) {
  return (
    <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
      <Button size="sm" variant="outline" data-testid="party-handout-retry" onClick={onRetry}>
        {LOAD_FAILED}
      </Button>
    </div>
  );
}

/** Both loads' combined state: an error anywhere wins, then loading. */
export function combined(a: LazyRecords<unknown>, b: LazyRecords<unknown>): LazyStatus {
  if (a.state === "error" || b.state === "error") return "error";
  if (a.state === "loading" || b.state === "loading") return "loading";
  return "ready";
}

export interface LoadedHandout {
  header: HandoutView;
  body: HandoutBodyView;
}

/** The selected handout's header + body, loaded (FR-PARTY-10). */
export function useHandout(handoutId: string) {
  const headers = useLazyRecords<HandoutView>(HANDOUT_TYPE);
  const bodies = useLazyRecords<HandoutBodyView>(HANDOUT_BODY_TYPE, [handoutId]);
  const state = combined(headers, bodies);
  const header = headers.rows.find((h) => h.id === handoutId);
  const body = bodies.rows.find((b) => b.id === handoutId);
  const loaded: LoadedHandout | null = header && body ? { header, body } : null;
  const retry = () => {
    if (headers.state === "error") headers.retry();
    if (bodies.state === "error") bodies.retry();
  };
  return { state, loaded, retry };
}

function HandoutImage({ id, title, index }: { id: string; title: string; index: number }) {
  const [full, setFull] = useState(false);
  return (
    <button
      type="button"
      data-testid="party-handout-image"
      data-record-id={id}
      data-zoom={full ? "full" : "fit"}
      aria-label={full ? "Fit image to width" : "Show image at 100 %"}
      className={cn("block shrink-0 overflow-auto rounded-md", full ? "max-w-none" : "w-full")}
      onClick={() => setFull((f) => !f)}
    >
      <AssetImg
        id={id}
        file="display"
        alt={`${title} — image ${index + 1}`}
        className={full ? "max-w-none" : "h-auto min-h-24 w-full"}
      />
    </button>
  );
}

export function GoneMessage() {
  return (
    <p data-testid="party-handout-gone" className="p-4 text-sm text-muted-foreground">
      {GONE_TEXT}
    </p>
  );
}

/** The read view of one loaded handout; `extras` = the DM's Badge and Buttons. */
export function HandoutArticle({ loaded, extras }: { loaded: LoadedHandout; extras?: ReactNode }) {
  const { header, body } = loaded;
  return (
    <ScrollArea className="h-full">
      <article
        data-testid="party-handout-view"
        data-record-id={header.id}
        className="flex flex-col gap-3 p-3"
      >
        <h2 data-testid="party-handout-title" className="text-base font-semibold break-words">
          {header.title}
        </h2>
        {extras}
        {header.imageAssetIds.map((id, i) => (
          <HandoutImage key={id} id={id} title={header.title} index={i} />
        ))}
        {body.body !== "" && (
          <p data-testid="party-handout-body" className="text-sm leading-relaxed break-words">
            <DiceText text={body.body} context={{ label: header.title, category: "other" }} />
          </p>
        )}
      </article>
    </ScrollArea>
  );
}

/** States around the view (FR-PARTY-10): nothing selected, loading, error, gone, ready. */
export function HandoutBody({
  handoutId,
  render,
}: {
  handoutId: string | null;
  render(loaded: LoadedHandout): ReactNode;
}) {
  if (handoutId === null) {
    return (
      <p className="p-4 text-sm text-muted-foreground">Open a handout from the Party board.</p>
    );
  }
  return <SelectedHandout handoutId={handoutId} render={render} />;
}

function SelectedHandout({
  handoutId,
  render,
}: {
  handoutId: string;
  render(loaded: LoadedHandout): ReactNode;
}) {
  const { state, loaded, retry } = useHandout(handoutId);
  if (loaded) return <>{render(loaded)}</>;
  if (state === "error") return <RetryLoad onRetry={retry} />;
  if (state === "loading") return <LoadingRows testId="party-handout-loading" />;
  return <GoneMessage />;
}
