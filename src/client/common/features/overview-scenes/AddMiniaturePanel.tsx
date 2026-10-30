// The Add miniature tool's panel (FR-OVW-20, -32): name, owner and the switch first, because the
// picker is modal; choosing the picture places it. The picker itself: `OverviewEditorHost`.
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import { MINIATURE_NAME_MAX } from "@shared/overview-scenes/schemas";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/overlays";
import { Input, Label } from "../../components/ui/primitives";
import { useRecords } from "../../sync/store";
import { useLive } from "../scenes-map/intents";
import { AddHiddenSwitch } from "./add-hidden";
import { useOverviewEditor } from "./overview-editor";

const NOBODY = "__none__";

export function AddMiniaturePanel() {
  const live = useLive();
  const players = useRecords<PlayerRecord>("player");
  const [text, setText] = useState("");
  const [owner, setOwner] = useState(NOBODY);
  return (
    <div
      data-testid="ovw-add-miniature-panel"
      className="flex w-56 flex-col gap-2 rounded-md border bg-background/95 p-2 text-sm shadow-sm backdrop-blur"
    >
      <div className="grid gap-1">
        <Label htmlFor="ovw-add-miniature-name" className="text-xs">
          Name (optional)
        </Label>
        <Input
          id="ovw-add-miniature-name"
          data-testid="ovw-add-miniature-name"
          maxLength={MINIATURE_NAME_MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="ovw-add-miniature-owner" className="text-xs">
          Owner (optional)
        </Label>
        <Select value={owner} onValueChange={setOwner}>
          <SelectTrigger
            id="ovw-add-miniature-owner"
            data-testid="ovw-add-miniature-owner"
            className="min-w-0"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              value={NOBODY}
              data-testid="ovw-add-miniature-owner-option"
              data-record-id=""
            >
              Nobody
            </SelectItem>
            {players.map((p) => (
              <SelectItem
                key={p.id}
                value={p.id}
                data-testid="ovw-add-miniature-owner-option"
                data-record-id={p.id}
              >
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <AddHiddenSwitch />
      <Button
        size="sm"
        variant="outline"
        data-testid="ovw-add-miniature-choose"
        disabled={!live}
        onClick={() =>
          useOverviewEditor.setState({
            picking: {
              kind: "miniature",
              text,
              ownerPlayerId: owner === NOBODY ? null : owner,
            },
          })
        }
      >
        Choose image…
      </Button>
    </div>
  );
}
