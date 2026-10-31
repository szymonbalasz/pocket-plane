// "Send to game log" (FR-SHARE-01, -02, -11): names an entry or a sheet row; the server builds the
// text. `labelled`: the compendium's outline Button; else the sheet's small icon Button. `confirm`:
// the DM's homebrew players can't open yet (FR-SHARE-11): sending shows its text to everyone, so
// ask first. Test ID `share-send`, `data-source` = `compendium` or the sheet list, `data-record-id`.
import { SHARE_TO_LOG, type ShareToLogIntent } from "@shared/log-share/schemas";
import { SendIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/overlays";
import { Tip } from "../../components/ui/tip";
import { useCbtIntent } from "../combat-tracker/store";

const LABEL = "Send to game log";

const sourceValue = (s: ShareToLogIntent) => (s.from === "compendium" ? "compendium" : s.list);
const idOf = (s: ShareToLogIntent) => (s.from === "compendium" ? s.entryId : s.rowId);

export function ShareButton({
  source,
  labelled = false,
  confirm = false,
  className,
}: {
  source: ShareToLogIntent;
  labelled?: boolean;
  confirm?: boolean;
  className?: string;
}) {
  const { send, disabled } = useCbtIntent();
  const [asking, setAsking] = useState(false);
  const share = async () => {
    const res = await send(SHARE_TO_LOG, source);
    if (res !== undefined) toast.success("Sent to the game log");
  };
  const onClick = () => {
    if (confirm) setAsking(true);
    else void share();
  };
  const props = {
    "data-testid": "share-send",
    "data-source": sourceValue(source),
    "data-record-id": idOf(source),
    disabled,
    onClick,
  };
  return (
    <>
      {labelled ? (
        <Button variant="outline" size="sm" className={className ?? "h-7 px-2 text-xs"} {...props}>
          <SendIcon className="size-3.5" /> {LABEL}
        </Button>
      ) : (
        <Tip content={LABEL} off={disabled}>
          <Button
            variant="ghost"
            size="icon"
            className={className ?? "size-6 shrink-0"}
            aria-label={LABEL}
            {...props}
          >
            <SendIcon className="size-3" />
          </Button>
        </Tip>
      )}
      {confirm && (
        <Dialog open={asking} onOpenChange={setAsking}>
          <DialogContent data-testid="share-confirm-dialog">
            <DialogHeader>
              <DialogTitle>Show this to everyone?</DialogTitle>
              <DialogDescription>
                Players can't open this entry yet. Sending it puts its full text in everyone's game
                log. The entry itself stays unshared.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                data-testid="share-confirm-cancel"
                variant="ghost"
                onClick={() => setAsking(false)}
              >
                Keep private
              </Button>
              <Button
                data-testid="share-confirm-send"
                disabled={disabled}
                onClick={() => {
                  setAsking(false);
                  void share();
                }}
              >
                Send to game log
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
