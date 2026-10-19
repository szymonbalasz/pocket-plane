// scenes-map's token menu entries (FR-MAP-18): rename, image, shape (FR-MAP-35), owner,
// hide/reveal, duplicate, delete (no confirm). No size entry (#120). Each sends one `map.*` intent; the server decides.
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import { MAP_INTENTS, TokenName, type TokenShape } from "@shared/scenes-map/schemas";
import {
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@ui/components/ui/menus";
import { AssetPickerDialog } from "@ui/features/assets-pipeline/AssetPicker";
import { toastReject, useMapIntent } from "@ui/features/scenes-map/intents";
import { useRecords } from "@ui/sync/store";
import {
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  ImageIcon,
  PencilIcon,
  ShapesIcon,
  Trash2Icon,
  UserIcon,
} from "lucide-react";
import { NameFormDialog } from "./NameFormDialog";
import { setMapSelection } from "./selection";
import type { TokenMenuDialogProps, TokenMenuEntry, TokenMenuItemProps } from "./token-menu";

const NONE = "__none__";

const SHAPES: { value: TokenShape; label: string }[] = [
  { value: "round", label: "Round" },
  { value: "square", label: "Square" },
  { value: "none", label: "None" },
];

function useSend() {
  const send = useMapIntent();
  return (name: string, payload: unknown) => send(name, payload).catch(toastReject);
}

export const scenesMapTokenMenu: readonly TokenMenuEntry[] = [
  {
    id: "map.rename",
    order: 10,
    Item: ({ openDialog }: TokenMenuItemProps) => (
      <DropdownMenuItem data-testid="map-token-menu-rename" onSelect={openDialog}>
        <PencilIcon /> Rename…
      </DropdownMenuItem>
    ),
    Dialog: function RenameToken({ token, close }: TokenMenuDialogProps) {
      const send = useMapIntent();
      return (
        <NameFormDialog
          open
          onOpenChange={(o) => !o && close()}
          title="Rename token"
          initial={token.name}
          schema={TokenName}
          testId="map-token-rename"
          onSubmit={(name) => send(MAP_INTENTS.updateToken, { tokenId: token.id, name })}
        />
      );
    },
  },
  {
    id: "map.image",
    order: 20,
    Item: ({ openDialog }: TokenMenuItemProps) => (
      <DropdownMenuItem data-testid="map-token-menu-image" onSelect={openDialog}>
        <ImageIcon /> Image…
      </DropdownMenuItem>
    ),
    Dialog: function TokenImage({ token, close }: TokenMenuDialogProps) {
      const send = useSend();
      return (
        <AssetPickerDialog
          open
          onOpenChange={(o) => !o && close()}
          title="Token image"
          initialSelectedId={token.imageAssetId}
          onSelect={(id) =>
            void send(MAP_INTENTS.updateToken, { tokenId: token.id, imageAssetId: id })
          }
        />
      );
    },
  },
  {
    id: "map.shape",
    order: 25,
    Item: function ShapeItem({ token }: TokenMenuItemProps) {
      const send = useSend();
      return (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-testid="map-token-menu-shape">
            <ShapesIcon /> Shape
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={token.shape}
              onValueChange={(v) =>
                void send(MAP_INTENTS.updateToken, { tokenId: token.id, shape: v as TokenShape })
              }
            >
              {SHAPES.map((sh) => (
                <DropdownMenuRadioItem
                  key={sh.value}
                  value={sh.value}
                  data-testid="map-token-shape-option"
                  data-value={sh.value}
                >
                  {sh.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      );
    },
  },
  {
    id: "map.owner",
    order: 30,
    Item: function OwnerItem({ token }: TokenMenuItemProps) {
      const players = useRecords<PlayerRecord>("player");
      const send = useSend();
      return (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-testid="map-token-menu-owner">
            <UserIcon /> Owner
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={token.ownerPlayerId ?? NONE}
              onValueChange={(v) =>
                void send(MAP_INTENTS.updateToken, {
                  tokenId: token.id,
                  ownerPlayerId: v === NONE ? null : v,
                })
              }
            >
              <DropdownMenuRadioItem
                value={NONE}
                data-testid="map-token-owner-option"
                data-record-id=""
              >
                None
              </DropdownMenuRadioItem>
              {players.map((p) => (
                <DropdownMenuRadioItem
                  key={p.id}
                  value={p.id}
                  data-testid="map-token-owner-option"
                  data-record-id={p.id}
                >
                  {p.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      );
    },
  },
  {
    id: "map.hide",
    order: 40,
    Item: function HideItem({ token }: TokenMenuItemProps) {
      const send = useSend();
      return (
        <DropdownMenuItem
          data-testid="map-token-menu-hide"
          data-hidden={token.hidden}
          onSelect={() =>
            void send(MAP_INTENTS.setTokenHidden, { tokenId: token.id, hidden: !token.hidden })
          }
        >
          {token.hidden ? <EyeIcon /> : <EyeOffIcon />} {token.hidden ? "Reveal" : "Hide"}
        </DropdownMenuItem>
      );
    },
  },
  {
    id: "map.duplicate",
    order: 50,
    Item: function DuplicateItem({ token }: TokenMenuItemProps) {
      const send = useMapIntent();
      return (
        <DropdownMenuItem
          data-testid="map-token-menu-duplicate"
          onSelect={() =>
            send(MAP_INTENTS.duplicateToken, { tokenId: token.id }).then(
              (r) => setMapSelection([(r as { tokenId: string }).tokenId]),
              toastReject,
            )
          }
        >
          <CopyIcon /> Duplicate{" "}
          <span className="ml-auto text-xs text-muted-foreground">Ctrl+D</span>
        </DropdownMenuItem>
      );
    },
  },
  {
    id: "map.delete",
    order: 60,
    Item: function DeleteItem({ token }: TokenMenuItemProps) {
      const send = useSend();
      return (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            data-testid="map-token-menu-delete"
            onSelect={() => void send(MAP_INTENTS.deleteToken, { tokenId: token.id })}
          >
            <Trash2Icon /> Delete
          </DropdownMenuItem>
        </>
      );
    },
  },
];
