// Campaign switcher, new campaign, rename (CAMP §7, FR-CAMP-06/07/09/10). FR-CAMP-51: the
// switcher shrinks with the top bar to its chevron + 48 px of name; the name ellipsises.
import {
  CampaignName,
  type CampaignRecord,
  type CampaignSummary,
} from "@shared/campaign-management/schemas";
import { Button } from "@ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
} from "@ui/components/ui/overlays";
import { usePresence, useRecords, useSync } from "@ui/sync/store";
import { useState } from "react";
import { toast } from "sonner";
import { NameDialog } from "./NameDialog";
import { api, dmCall, useDmSession } from "./session";

export function CampaignBar({ campaigns }: { campaigns: CampaignSummary[] }) {
  const loadCampaigns = useDmSession((s) => s.loadCampaigns);
  const liveCampaign = useRecords<CampaignRecord>("campaign")[0];
  const presence = usePresence();
  const state = useSync((s) => s.state);
  const active = campaigns.find((c) => c.active);
  const [pending, setPending] = useState<CampaignSummary | null>(null);
  // Unknown while not live (FR-SYNC-29); switching needs live anyway.
  const online = presence.known ? presence.online.size : 0;

  async function activate(c: CampaignSummary) {
    setPending(null);
    try {
      await dmCall(api.api.campaigns[":id"].activate.$post({ param: { id: c.id } }));
      await loadCampaigns();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  function choose(id: string) {
    const c = campaigns.find((x) => x.id === id);
    if (!c || c.active) return;
    if (online > 0) setPending(c);
    else void activate(c);
  }

  const activeName = liveCampaign?.name ?? active?.name ?? "";

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Select value={active?.id ?? ""} onValueChange={choose} disabled={state !== "live"}>
        <Tooltip content={activeName}>
          <span className="inline-flex min-w-0">
            <SelectTrigger
              data-testid="camp-campaign-switcher"
              aria-label="Active campaign"
              title={activeName}
              className="min-w-24 max-w-full"
            >
              <span className="min-w-0 truncate">
                <SelectValue placeholder="Choose campaign">
                  <span data-testid="camp-campaign-name">{activeName}</span>
                </SelectValue>
              </span>
            </SelectTrigger>
          </span>
        </Tooltip>
        <SelectContent>
          {campaigns.map((c) => (
            <SelectItem
              key={c.id}
              value={c.id}
              data-testid="camp-campaign-option"
              data-record-id={c.id}
            >
              {c.id === active?.id ? activeName : c.name}
              {c.active ? " (active)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <NameDialog
        title="New campaign"
        label="Name"
        schema={CampaignName}
        testId="camp-campaign-new"
        submitLabel="Create"
        trigger={
          <Button variant="outline" className="shrink-0">
            New campaign
          </Button>
        }
        onSubmit={async (name) => {
          await dmCall(api.api.campaigns.$post({ json: { name } }));
          await loadCampaigns();
          toast.success(`Created "${name}"`);
        }}
      />
      {active && (
        <NameDialog
          title="Rename campaign"
          label="Name"
          schema={CampaignName}
          initial={activeName}
          testId="camp-campaign-rename"
          submitLabel="Rename"
          trigger={
            <Button variant="ghost" className="shrink-0">
              Rename
            </Button>
          }
          onSubmit={async (name) => {
            await dmCall(
              api.api.campaigns[":id"].$patch({ param: { id: active.id }, json: { name } }),
            );
            await loadCampaigns();
          }}
        />
      )}
      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent data-testid="camp-switch-dialog">
          <DialogHeader>
            <DialogTitle>
              Switch to <strong>{pending?.name}</strong>?
            </DialogTitle>
            <DialogDescription>
              {online} online player{online === 1 ? "" : "s"} will wait until you switch back.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              data-testid="camp-switch-cancel"
              onClick={() => setPending(null)}
            >
              Cancel
            </Button>
            <Button
              data-testid="camp-switch-confirm"
              onClick={() => pending && void activate(pending)}
            >
              Switch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
