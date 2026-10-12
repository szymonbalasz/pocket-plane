// Test-mode sync probe panel + "drop connection" (FR-SYNC-27). Shown only when the snapshot
// carries the `probe` type (server in test mode).
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import type { ProbeRecord } from "@shared/live-sync/schemas";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, Input } from "../../components/ui/primitives";
import { cn } from "../../lib/utils";
import { useHasType, useRecords, useSync } from "../../sync/store";

function useSend() {
  const connection = useSync((s) => s.connection);
  return (name: string, payload: unknown) =>
    connection.sendIntent(name, payload).catch((e: Error) => {
      toast.error(e.message);
    });
}

function ProbeRow({ probe, players }: { probe: ProbeRecord; players: PlayerRecord[] }) {
  const you = useSync((s) => s.store.you);
  const live = useSync((s) => s.state === "live");
  const send = useSend();
  const [text, setText] = useState(probe.text);
  const [base, setBase] = useState(probe.text);
  if (base !== probe.text) {
    setBase(probe.text);
    setText(probe.text);
  }
  const isDm = you?.role === "dm";
  const canEdit = isDm || (probe.ownerPlayerId !== null && probe.ownerPlayerId === you?.playerId);
  const save = () =>
    isDm
      ? send("probe.set", {
          id: probe.id,
          text,
          hidden: probe.hidden,
          ownerPlayerId: probe.ownerPlayerId,
        })
      : send("probe.edit", { id: probe.id, text });
  return (
    <li
      data-testid="sync-probe-row"
      data-record-id={probe.id}
      data-hidden={probe.hidden}
      className={cn("flex items-center gap-2", probe.hidden && "opacity-50")}
    >
      <Input
        data-testid="sync-probe-text"
        value={text}
        disabled={!canEdit || !live}
        onChange={(e) => setText(e.target.value)}
        className="flex-1"
      />
      {canEdit && (
        <Button data-testid="sync-probe-save" size="sm" disabled={!live} onClick={save}>
          Save
        </Button>
      )}
      {isDm && (
        <>
          <Button
            data-testid="sync-probe-toggle-hidden"
            size="sm"
            variant="outline"
            disabled={!live}
            onClick={() =>
              send("probe.set", {
                id: probe.id,
                text: probe.text,
                hidden: !probe.hidden,
                ownerPlayerId: probe.ownerPlayerId,
              })
            }
          >
            {probe.hidden ? "Reveal" : "Hide"}
          </Button>
          <select
            data-testid="sync-probe-owner"
            aria-label="Owner"
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            value={probe.ownerPlayerId ?? ""}
            disabled={!live}
            onChange={(e) =>
              send("probe.set", {
                id: probe.id,
                text: probe.text,
                hidden: probe.hidden,
                ownerPlayerId: e.target.value || null,
              })
            }
          >
            <option value="">No owner</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </>
      )}
    </li>
  );
}

export function ProbePanel() {
  const hasProbes = useHasType("probe");
  const probes = useRecords<ProbeRecord>("probe");
  const players = useRecords<PlayerRecord>("player");
  const isDm = useSync((s) => s.store.you?.role === "dm");
  const live = useSync((s) => s.state === "live");
  const connection = useSync((s) => s.connection);
  const send = useSend();
  const [newText, setNewText] = useState("");
  if (!hasProbes) return null;
  return (
    <Card data-testid="sync-probe-panel">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Sync probes (test mode)</CardTitle>
        <Button
          data-testid="sync-drop-connection"
          size="sm"
          variant="outline"
          onClick={() => connection.drop()}
        >
          Drop connection
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <ul className="flex flex-col gap-2">
          {probes.map((p) => (
            <ProbeRow key={p.id} probe={p} players={players} />
          ))}
        </ul>
        {probes.length === 0 && <p className="text-sm text-muted-foreground">No probes.</p>}
        {isDm && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send("probe.set", { text: newText, hidden: false }).then(() => setNewText(""));
            }}
          >
            <Input
              data-testid="sync-probe-new-text"
              placeholder="New probe text"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
            />
            <Button data-testid="sync-probe-create" type="submit" size="sm" disabled={!live}>
              Add
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
