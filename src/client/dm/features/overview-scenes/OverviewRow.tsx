// An overview's row in the Scenes window (FR-OVW-14), beside the battle scenes': an Overview mark,
// "Live" on the shown one, Show, Rename, Duplicate, Move and Delete. Actions off while not live;
// viewing always works. Test IDs `ovw-scene-*`.
import { OVW_INTENTS, type OverviewRecord } from "@shared/overview-scenes/schemas";
import { Tooltip } from "@ui/components/ui/overlays";
import { toastReject, useMapIntent } from "@ui/features/scenes-map/intents";
import { GlobeIcon } from "lucide-react";
import { entryActions, ListRow, useScenesList } from "../scenes-map/list-row";
import { useDmMap } from "../scenes-map/view-state";

export function OverviewRow({
  overview,
  parentId,
  depth,
  viewed,
  onRename,
  rowRef,
}: {
  overview: OverviewRecord;
  parentId: string | null;
  depth: number;
  viewed: boolean;
  onRename(): void;
  /** The row's button: FR-MAP-51's focus lands here. */
  rowRef: React.Ref<HTMLButtonElement>;
}) {
  const api = useScenesList();
  const view = useDmMap((s) => s.view);
  const send = useMapIntent();
  const overviewId = overview.id;
  return (
    <ListRow
      prefix="ovw"
      kind="overview"
      id={overviewId}
      name={overview.name}
      parentId={parentId}
      depth={depth}
      active={overview.active}
      viewed={viewed}
      rowRef={rowRef}
      onView={() => view(overviewId)}
      mark={
        <Tooltip content="Overview">
          <GlobeIcon
            className="size-4 shrink-0 text-muted-foreground"
            aria-label="Overview"
            data-testid="ovw-scene-mark"
          />
        </Tooltip>
      }
      actions={entryActions(api, {
        prefix: "ovw",
        kind: "overview",
        id: overviewId,
        name: overview.name,
        parentId,
        active: overview.active,
        viewed,
        onRename,
        onDuplicate: () => send(OVW_INTENTS.duplicate, { overviewId }).catch(toastReject),
      })}
    />
  );
}
