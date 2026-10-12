import { CampaignName } from "@shared/campaign-management/schemas";
import { Button } from "@ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from "@ui/components/ui/primitives";
import { SyncProvider } from "@ui/sync/SyncProvider";
import { useSync } from "@ui/sync/store";
import { useEffect } from "react";
import { toast } from "sonner";
import { LoginScreen } from "./features/campaign-management/LoginScreen";
import { NameDialog } from "./features/campaign-management/NameDialog";
import { api, dmCall, useDmSession } from "./features/campaign-management/session";
import { DmPlayPage } from "./features/play-shell/DmPlayPage";

export function App() {
  const secret = useDmSession((s) => s.secret);
  if (!secret) return <LoginScreen />;
  return <DmHome secret={secret} />;
}

function Loading() {
  return (
    <div className="flex flex-col gap-3 p-6" data-testid="ui-loading">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

function DmHome({ secret }: { secret: string }) {
  const campaigns = useDmSession((s) => s.campaigns);
  const loadCampaigns = useDmSession((s) => s.loadCampaigns);
  useEffect(() => {
    loadCampaigns().catch(() => toast.error("Could not load campaigns"));
  }, [loadCampaigns]);

  if (campaigns === null) return <Loading />;
  const active = campaigns.find((c) => c.active);
  if (!active) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-sm" data-testid="camp-empty">
          <CardHeader>
            <CardTitle>Create your first campaign</CardTitle>
          </CardHeader>
          <CardContent>
            <NameDialog
              title="New campaign"
              label="Name"
              schema={CampaignName}
              testId="camp-empty-create"
              submitLabel="Create"
              trigger={<Button>New campaign</Button>}
              onSubmit={async (name) => {
                await dmCall(api.api.campaigns.$post({ json: { name } }));
                await loadCampaigns();
              }}
            />
          </CardContent>
        </Card>
      </main>
    );
  }
  // The DM opens its WS only once a campaign is active (CON-10).
  return (
    <SyncProvider credential={{ role: "dm", secret }}>
      <DmShell />
    </SyncProvider>
  );
}

function DmShell() {
  const campaigns = useDmSession((s) => s.campaigns) ?? [];
  const loadCampaigns = useDmSession((s) => s.loadCampaigns);
  const setSecret = useDmSession((s) => s.setSecret);
  const state = useSync((s) => s.state);
  const everLive = useSync((s) => s.everLive);
  const campaignId = useSync((s) => s.store.you?.campaignId);

  // Another tab may have switched campaigns: refresh the list whenever our campaign changes.
  useEffect(() => {
    if (campaignId) void loadCampaigns().catch(() => {});
  }, [campaignId, loadCampaigns]);

  // 4401: secret changed or throttled → back to login (FR-CAMP-04, live-sync §7).
  useEffect(() => {
    if (state === "rejected") setSecret(null);
  }, [state, setSecret]);

  // Play shell (FR-SHELL-01/03): skeleton until the first snapshot, then the play page.
  return (
    <DmPlayPage
      screen={!everLive || (state !== "live" && campaignId === undefined) ? <Loading /> : null}
      campaigns={campaigns}
      onLogout={() => setSecret(null)}
    />
  );
}
