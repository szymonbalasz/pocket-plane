// Handouts tab parts shared by both clients (FR-PARTY-10, -12, -13): the loaded list with its
// loading / error / empty states, and one row (thumb, title, share Badge, extras). Clicking a row
// opens `party.handout` on it.
import { HANDOUT_TYPE, type HandoutView } from "@shared/party-board/schemas";
import { ImageIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "../../components/ui/primitives";
import { ScrollArea } from "../../components/ui/scroll-area";
import { useLazyRecords } from "../../sync/store";
import { AssetImg } from "../assets-pipeline/AssetImg";
import { useOpenWindow } from "../play-shell/ShellContext";
import { EMPTY_HANDOUTS, PARTY_HANDOUT_KIND, sharedModeOf } from "./logic";
import { selectHandout } from "./selection";
import { LoadingRows, RetryLoad } from "./Viewer";

/** FR-PARTY-10: every visible header, loaded when the board opens. */
export function useHandoutHeaders() {
  return useLazyRecords<HandoutView>(HANDOUT_TYPE);
}

/** Opens the viewer on a handout (FR-PARTY-12 / -13 row click, notification "Open"). */
export function useOpenHandout() {
  const openWindow = useOpenWindow();
  return (id: string) => {
    selectHandout(id);
    openWindow(PARTY_HANDOUT_KIND);
  };
}

function Thumb({ h }: { h: HandoutView }) {
  const first = h.imageAssetIds[0];
  if (!first) {
    return (
      <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground">
        <ImageIcon className="size-4" aria-hidden />
      </span>
    );
  }
  return <AssetImg id={first} file="thumb" alt="" className="size-10 shrink-0 rounded-sm" />;
}

export function HandoutRow({
  h,
  badge,
  sub,
  mark,
  menu,
}: {
  h: HandoutView;
  badge: ReactNode;
  sub?: ReactNode;
  mark?: ReactNode;
  menu?: ReactNode;
}) {
  const open = useOpenHandout();
  return (
    <li
      data-testid="party-handout-row"
      data-record-id={h.id}
      data-shared={sharedModeOf(h)}
      data-new={mark ? "true" : "false"}
      className="flex items-center gap-1 has-[[data-slot=party-row-error]]:flex-wrap"
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => open(h.id)}
      >
        <Thumb h={h} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 break-words text-sm font-medium">{h.title}</span>
            {mark}
          </span>
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {badge}
            {sub}
          </span>
        </span>
      </button>
      {menu}
    </li>
  );
}

export function ShareBadge({ label, muted }: { label: string; muted: boolean }) {
  return (
    <Badge variant={muted ? "secondary" : "outline"} className="px-1.5 py-0">
      {label}
    </Badge>
  );
}

/** The list with FR-PARTY-10 states; `rows` already ordered. */
export function HandoutListBody({
  headers,
  children,
}: {
  headers: ReturnType<typeof useHandoutHeaders>;
  children: ReactNode;
}) {
  if (headers.state === "error") return <RetryLoad onRetry={headers.retry} />;
  if (headers.state === "loading") return <LoadingRows testId="party-handout-loading" />;
  if (headers.rows.length === 0) {
    return (
      <p data-testid="party-handout-empty" className="p-2 text-sm text-muted-foreground">
        {EMPTY_HANDOUTS}
      </p>
    );
  }
  return (
    <ScrollArea className="min-h-0 flex-1">
      <ul data-testid="party-handout-list" className="flex flex-col gap-0.5">
        {children}
      </ul>
    </ScrollArea>
  );
}
