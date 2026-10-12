// scenes-map's token menu entries (FR-MAP-18): rename, image, owner, hide/reveal, duplicate,
// delete (no confirm). No size entry (#120). Each sends one `map.*` intent; the server decides.
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import { MAP_INTENTS, TokenName } from "@shared/scenes-map/schemas";
import {
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@ui/components/ui/menus";
import { toastReject, useMapIntent } from "@ui/features/scenes-map/intents";
import { useRecords } from "@ui/sync/store";
import {
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  ImageIcon,
  PencilIcon,
  Trash2Icon,
  UserIcon,
} from "lucide-react";
import { AssetPickerDialog } from "../assets-pipeline/AssetPicker";
import { NameFormDialog } from "./NameFormDialog";
import type { TokenMenuDialogProps, TokenMenuEntry, TokenMenuItemProps } from "./token-menu";
import { useDmMap } from "./view-state";

const NONE = "__none__";

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
      const select = useDmMap((s) => s.select);
      return (
        <DropdownMenuItem
          data-testid="map-token-menu-duplicate"
          onSelect={() =>
            send(MAP_INTENTS.duplicateToken, { tokenId: token.id }).then(
              (r) => select((r as { tokenId: string }).tokenId),
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
