// Test-mode send form (FR-NOTE-22) in `note.history`. DM: text, audience, action owner, label.
// Player: text and label only (audience self, owner DM, enforced by the server).
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import type { NoteTestSendInput } from "@shared/notifications/schemas";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/primitives";
import { useRecords, useSync } from "../../sync/store";
import { rejectMessage } from "./logic";

const SELECT = "h-8 rounded-md border border-input bg-background px-2 text-sm";

/** DM form values → intent payload. Audience / owner: `dm`, `all`, `player:<id>`, `` (none). */
export function testSendPayload(f: {
  text: string;
  audience: string;
  owner: string;
  label: string;
}): NoteTestSendInput {
  const out: NoteTestSendInput = { text: f.text };
  if (f.audience.startsWith("player:")) {
    out.audience = "player";
    out.audiencePlayerId = f.audience.slice(7);
  } else out.audience = f.audience as "dm" | "all";
  if (f.owner !== "") {
    out.actionLabel = f.label.trim() || "Resolve";
    if (f.owner.startsWith("player:")) {
      out.actionRole = "player";
      out.actionPlayerId = f.owner.slice(7);
    } else out.actionRole = "dm";
  }
  return out;
}

export function TestSendForm() {
  const isDm = useSync((s) => s.store.you?.role === "dm");
  const live = useSync((s) => s.state === "live");
  const connection = useSync((s) => s.connection);
  const players = useRecords<PlayerRecord>("player");
  const [text, setText] = useState("");
  const [audience, setAudience] = useState("all");
  const [owner, setOwner] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const payload = isDm
    ? testSendPayload({ text, audience, owner, label })
    : { text, ...(label.trim() ? { actionLabel: label.trim() } : {}) };
  const send = () => {
    setBusy(true);
    connection
      .sendIntent("note.testSend", payload)
      .then(() => setText(""))
      .catch((err) => toast.error(rejectMessage(err)))
      .finally(() => setBusy(false));
  };

  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-dashed p-2"
      aria-label="Send test notification"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <Input
        data-testid="note-test-text"
        aria-label="Text"
        placeholder="Test notification text"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        {isDm && (
          <>
            <select
              data-testid="note-test-audience"
              aria-label="Audience"
              className={SELECT}
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
            >
              <option value="all">All</option>
              <option value="dm">DM</option>
              {players.map((p) => (
                <option key={p.id} value={`player:${p.id}`}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              data-testid="note-test-owner"
              aria-label="Action owner"
              className={SELECT}
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            >
              <option value="">No action</option>
              <option value="dm">DM</option>
              {players.map((p) => (
                <option key={p.id} value={`player:${p.id}`}>
                  {p.name}
                </option>
              ))}
            </select>
          </>
        )}
        <Input
          data-testid="note-test-label"
          aria-label="Action label"
          placeholder={isDm ? "Label" : "Label (Resolve)"}
          className="h-8 w-28"
          value={label}
          disabled={isDm && owner === ""}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Button
          data-testid="note-test-send"
          size="sm"
          type="submit"
          className="ml-auto"
          disabled={!live || busy || text.trim() === ""}
        >
          Send
        </Button>
      </div>
    </form>
  );
}
