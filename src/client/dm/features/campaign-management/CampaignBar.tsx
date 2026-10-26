// Campaign title + menu, new campaign, rename (CAMP §7, FR-CAMP-06/07/09/10; kit-parity
// FR-KIT-11): the top bar's title is the switcher; its menu lists the campaigns, then New
// campaign… and Rename…. FR-CAMP-51: the title shrinks with the top bar; the name ellipsises.
import {
  CampaignName,
  type CampaignRecord,
  type CampaignSummary,
} from "@shared/campaign-management/schemas";
import { Button } from "@ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ui/components/ui/menus";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Tooltip,
} from "@ui/components/ui/overlays";
import { usePresence, useRecords, useSync } from "@ui/sync/store";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { NameDialog } from "./NameDialog";
import { api, dmCall, useDmSession } from "./session";

export type CampaignMenuItem =
  | {
      kind: "campaign";
      testId: "camp-campaign-option";
      recordId: string;
      label: string;
      disabled: boolean;
    }
  | { kind: "separator"; testId?: undefined; recordId?: undefined }
  | {
      kind: "new" | "rename";
      testId: "camp-campaign-new" | "camp-campaign-rename";
      recordId?: undefined;
      label: string;
      disabled: false;
    };

/**
 * FR-KIT-11: the title menu, top to bottom: the campaigns (the active one by its live name, "(active)"
 * after it; switching needs `live`), a separator, New campaign…, then Rename… (with an active
 * campaign only).
 */
export function campaignMenu(
  campaigns: readonly CampaignSummary[],
  activeName: string,
  live: boolean,
): CampaignMenuItem[] {
  const out: CampaignMenuItem[] = campaigns.map((c) => ({
    kind: "campaign",
    testId: "camp-campaign-option",
    recordId: c.id,
    label: `${c.active ? activeName : c.name}${c.active ? " (active)" : ""}`,
    disabled: !live,
  }));
  if (out.length > 0) out.push({ kind: "separator" });
  out.push({ kind: "new", testId: "camp-campaign-new", label: "New campaign…", disabled: false });
  if (campaigns.some((c) => c.active)) {
    out.push({ kind: "rename", testId: "camp-campaign-rename", label: "Rename…", disabled: false });
  }
  return out;
}

export function CampaignBar({ campaigns }: { campaigns: CampaignSummary[] }) {
  const loadCampaigns = useDmSession((s) => s.loadCampaigns);
  const liveCampaign = useRecords<CampaignRecord>("campaign")[0];
  const presence = usePresence();
  const state = useSync((s) => s.state);
  const active = campaigns.find((c) => c.active);
  const [pending, setPending] = useState<CampaignSummary | null>(null);
  const [naming, setNaming] = useState<"new" | "rename" | null>(null);
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
  const closeNaming = (open: boolean) => !open && setNaming(null);

  return (
    <div className="flex min-w-0 items-center">
      {/* Not modal: a menu item opens a dialog, which takes the focus. */}
      <DropdownMenu modal={false}>
        <Tooltip content={activeName || "Choose campaign"}>
          <span className="inline-flex min-w-0">
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-testid="camp-campaign-switcher"
                data-slot="topbar-title"
                aria-label="Active campaign"
                className="flex min-w-0 max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-lg leading-tight font-semibold outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 truncate" title={activeName}>
                  <span data-testid="camp-campaign-name">{activeName || "Choose campaign"}</span>
                </span>
                <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 opacity-70" />
              </button>
            </DropdownMenuTrigger>
          </span>
        </Tooltip>
        <DropdownMenuContent align="start" className="min-w-56">
          {campaignMenu(campaigns, activeName, state === "live").map((item) =>
            item.kind === "separator" ? (
              <DropdownMenuSeparator key="separator" />
            ) : (
              <DropdownMenuItem
                key={item.recordId ?? item.testId}
                data-testid={item.testId}
                data-record-id={item.recordId}
                disabled={item.disabled}
                onSelect={() =>
                  item.kind === "campaign" ? choose(item.recordId) : setNaming(item.kind)
                }
              >
                {item.label}
              </DropdownMenuItem>
            ),
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <NameDialog
        title="New campaign"
        label="Name"
        schema={CampaignName}
        testId="camp-campaign-new"
        submitLabel="Create"
        open={naming === "new"}
        onOpenChange={closeNaming}
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
          open={naming === "rename"}
          onOpenChange={closeNaming}
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
